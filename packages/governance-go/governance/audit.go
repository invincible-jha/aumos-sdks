// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package governance

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance/storage"
)

// genesisHash is the hash value that precedes the very first record in a new
// audit chain, making the genesis condition explicit and detectable.
const genesisHash = "0000000000000000000000000000000000000000000000000000000000000000"

// AuditLoggerIface is the interface for the tamper-evident audit logger.
// Each record is linked to its predecessor via a SHA-256 hash chain, making
// retrospective tampering detectable.
//
// All methods are safe for concurrent use.
type AuditLoggerIface interface {
	// Log appends a Decision to the audit chain and returns the resulting
	// AuditRecord. The record is persisted to the storage backend.
	Log(ctx context.Context, decision *Decision) error

	// Query returns AuditRecords matching the supplied filter options.
	Query(ctx context.Context, opts ...QueryOption) ([]AuditRecord, error)
}

// QueryOption is a functional option for AuditLogger.Query.
type QueryOption func(*AuditFilter)

// WithAgentFilter restricts Query results to records for a specific agent.
func WithAgentFilter(agentID string) QueryOption {
	return func(f *AuditFilter) { f.AgentID = agentID }
}

// WithActionFilter restricts Query results to records for a specific action.
func WithActionFilter(action string) QueryOption {
	return func(f *AuditFilter) { f.Action = action }
}

// WithSinceFilter restricts Query results to records on or after the given time.
func WithSinceFilter(since time.Time) QueryOption {
	return func(f *AuditFilter) { f.Since = since }
}

// WithUntilFilter restricts Query results to records on or before the given time.
func WithUntilFilter(until time.Time) QueryOption {
	return func(f *AuditFilter) { f.Until = until }
}

// WithPermittedOnly restricts Query results to records where the decision
// permitted the action.
func WithPermittedOnly() QueryOption {
	return func(f *AuditFilter) { f.PermittedOnly = true }
}

// WithDeniedOnly restricts Query results to records where the decision denied
// the action.
func WithDeniedOnly() QueryOption {
	return func(f *AuditFilter) { f.DeniedOnly = true }
}

// WithQueryLimit caps the number of records returned by Query. Zero means no
// limit.
func WithQueryLimit(limit int) QueryOption {
	return func(f *AuditFilter) { f.Limit = limit }
}

// AuditLogger is the default implementation of AuditLoggerIface.
// It maintains a running SHA-256 hash chain over all appended records.
type AuditLogger struct {
	mu       sync.Mutex
	store    storage.Storage
	lastHash string
	counter  uint64
	config   AuditConfig
}

// NewAuditLogger constructs an AuditLogger backed by the given storage.
func NewAuditLogger(store storage.Storage, cfg AuditConfig) *AuditLogger {
	return &AuditLogger{
		store:    store,
		lastHash: genesisHash,
		config:   cfg,
	}
}

// Log appends a Decision to the audit chain.
//
// The method is serialised internally so concurrent callers safely produce a
// well-formed chain with no gaps. The Decision pointer must not be nil.
func (l *AuditLogger) Log(ctx context.Context, decision *Decision) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if decision == nil {
		return fmt.Errorf("governance: decision must not be nil")
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	l.counter++
	id := fmt.Sprintf("%016x", l.counter)
	prevHash := l.lastHash
	now := time.Now().UTC()

	record := storage.AuditRecord{
		ID:        id,
		Decision:  decisionToStorage(decision),
		PrevHash:  prevHash,
		Timestamp: now,
	}

	hash := computeAuditHash(record, prevHash)
	record.Hash = hash
	l.lastHash = hash

	return l.store.AppendAudit(record)
}

// Query returns audit records matching the supplied filter options.
//
// Records are returned in append order (oldest first). The results honour
// AuditConfig.MaxRecords if set — when the cap has been reached and old
// records evicted, evicted records are not returned.
func (l *AuditLogger) Query(ctx context.Context, opts ...QueryOption) ([]AuditRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	filter := &AuditFilter{}
	for _, opt := range opts {
		opt(filter)
	}

	raw, err := l.store.QueryAudit(storage.AuditFilter{
		AgentID:       filter.AgentID,
		Action:        filter.Action,
		Since:         filter.Since,
		Until:         filter.Until,
		PermittedOnly: filter.PermittedOnly,
		DeniedOnly:    filter.DeniedOnly,
		Limit:         filter.Limit,
	})
	if err != nil {
		return nil, fmt.Errorf("governance: query audit: %w", err)
	}

	records := make([]AuditRecord, 0, len(raw))
	for _, r := range raw {
		records = append(records, auditRecordFromStorage(r))
	}
	return records, nil
}

// auditPayload is the canonical representation of an AuditRecord used for
// hashing. Only stable fields are included; Hash itself is excluded.
type auditPayload struct {
	ID        string `json:"id"`
	Action    string `json:"action"`
	Permitted bool   `json:"permitted"`
	Reason    string `json:"reason"`
	Timestamp string `json:"timestamp"`
	PrevHash  string `json:"prev_hash"`
}

// computeAuditHash produces a SHA-256 digest over the record's canonical JSON
// combined with prevHash.  The input is:
//
//	<canonicalJSON>\n<prevHash>
//
// The newline separator ensures the two fields cannot accidentally merge.
func computeAuditHash(record storage.AuditRecord, prevHash string) string {
	payload := auditPayload{
		ID:        record.ID,
		Action:    record.Decision.Action,
		Permitted: record.Decision.Permitted,
		Reason:    record.Decision.Reason,
		Timestamp: record.Timestamp.Format(time.RFC3339Nano),
		PrevHash:  prevHash,
	}

	// json.Marshal emits struct fields in declaration order, which is
	// deterministic. Field order is part of this package's public contract —
	// do not reorder the auditPayload struct fields.
	data, _ := json.Marshal(payload)
	input := string(data) + "\n" + prevHash

	sum := sha256.Sum256([]byte(input))
	return hex.EncodeToString(sum[:])
}

// decisionToStorage converts a governance Decision to the storage-layer type.
func decisionToStorage(d *Decision) storage.Decision {
	return storage.Decision{
		Permitted: d.Permitted,
		Action:    d.Action,
		Timestamp: d.Timestamp,
		Reason:    d.Reason,
		AgentID:   d.AgentID,
	}
}

// auditRecordFromStorage converts a storage-layer AuditRecord to the public type.
func auditRecordFromStorage(r storage.AuditRecord) AuditRecord {
	return AuditRecord{
		ID: r.ID,
		Decision: Decision{
			Permitted: r.Decision.Permitted,
			AgentID:   r.Decision.AgentID,
			Action:    r.Decision.Action,
			Timestamp: r.Decision.Timestamp,
			Reason:    r.Decision.Reason,
		},
		Hash:      r.Hash,
		PrevHash:  r.PrevHash,
		Timestamp: r.Timestamp,
	}
}
