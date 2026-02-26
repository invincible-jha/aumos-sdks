// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package storage

import (
	"sync"
	"time"
)

// MemoryStorage is a thread-safe, in-memory implementation of Storage. It is
// the default backend for the governance SDK.
//
// All data is lost when the process exits. MemoryStorage is intended for
// testing, local development, and single-process deployments.
//
// MemoryStorage is safe for concurrent use. A single sync.RWMutex guards all
// state to prevent data races across the four independent data stores.
type MemoryStorage struct {
	mu       sync.RWMutex
	trust    map[trustKey]TrustAssignment
	envelopes map[string]Envelope
	consent  map[consentKey]bool
	audit    []AuditRecord
}

// trustKey uniquely identifies a trust assignment by (agentID, scope).
type trustKey struct {
	agentID string
	scope   string
}

// consentKey uniquely identifies a consent record by (agentID, action).
type consentKey struct {
	agentID string
	action  string
}

// NewMemoryStorage constructs an empty MemoryStorage.
func NewMemoryStorage() *MemoryStorage {
	return &MemoryStorage{
		trust:     make(map[trustKey]TrustAssignment),
		envelopes: make(map[string]Envelope),
		consent:   make(map[consentKey]bool),
		audit:     make([]AuditRecord, 0),
	}
}

// GetTrust returns the TrustAssignment for (agentID, scope), or (nil, false)
// when no assignment has been stored.
func (s *MemoryStorage) GetTrust(agentID, scope string) (*TrustAssignment, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	a, ok := s.trust[trustKey{agentID: agentID, scope: scope}]
	if !ok {
		return nil, false
	}
	// Return a copy to prevent callers from mutating stored state.
	copy := a
	return &copy, true
}

// SetTrust stores or replaces the TrustAssignment for (agentID, scope).
func (s *MemoryStorage) SetTrust(agentID, scope string, assignment TrustAssignment) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.trust[trustKey{agentID: agentID, scope: scope}] = assignment
}

// GetEnvelope returns the Envelope for category, or (zero, false) when no
// envelope has been created for that category.
func (s *MemoryStorage) GetEnvelope(category string) (Envelope, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	env, ok := s.envelopes[category]
	return env, ok
}

// SetEnvelope stores or replaces the Envelope for category.
func (s *MemoryStorage) SetEnvelope(category string, envelope Envelope) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.envelopes[category] = envelope
}

// GetConsent returns whether consent is active for (agentID, action).
// A missing record returns (false, nil).
func (s *MemoryStorage) GetConsent(agentID, action string) (bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	granted, ok := s.consent[consentKey{agentID: agentID, action: action}]
	if !ok {
		return false, nil
	}
	return granted, nil
}

// SetConsent records the consent state for (agentID, action).
func (s *MemoryStorage) SetConsent(agentID, action string, granted bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.consent[consentKey{agentID: agentID, action: action}] = granted
}

// AppendAudit appends record to the in-memory audit log.
// AppendAudit never returns an error for MemoryStorage.
func (s *MemoryStorage) AppendAudit(record AuditRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.audit = append(s.audit, record)
	return nil
}

// QueryAudit returns audit records matching filter, in append order.
//
// Filtering is applied in this order: time range, agent, action, permit
// status, then limit.
func (s *MemoryStorage) QueryAudit(filter AuditFilter) ([]AuditRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	results := make([]AuditRecord, 0, len(s.audit))
	for _, record := range s.audit {
		if !matchesFilter(record, filter) {
			continue
		}
		results = append(results, record)
		if filter.Limit > 0 && len(results) >= filter.Limit {
			break
		}
	}
	return results, nil
}

// matchesFilter returns true when record satisfies all non-zero filter criteria.
func matchesFilter(record AuditRecord, filter AuditFilter) bool {
	if !filter.Since.IsZero() && record.Timestamp.Before(filter.Since) {
		return false
	}
	if !filter.Until.IsZero() && record.Timestamp.After(filter.Until) {
		return false
	}
	if filter.AgentID != "" && record.Decision.AgentID != filter.AgentID {
		return false
	}
	if filter.Action != "" && record.Decision.Action != filter.Action {
		return false
	}
	if filter.PermittedOnly && !record.Decision.Permitted {
		return false
	}
	if filter.DeniedOnly && record.Decision.Permitted {
		return false
	}
	return true
}

// TrustCount returns the number of trust assignments currently stored.
// This is primarily useful for observability and testing.
func (s *MemoryStorage) TrustCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.trust)
}

// AuditCount returns the total number of audit records stored.
func (s *MemoryStorage) AuditCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.audit)
}

// Snapshot returns a point-in-time copy of all audit records. Useful for
// chain verification in tests.
func (s *MemoryStorage) Snapshot() []AuditRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	snapshot := make([]AuditRecord, len(s.audit))
	copy(snapshot, s.audit)
	return snapshot
}

// PurgeOlderThan removes audit records whose Timestamp is before the cutoff.
// This is provided for operational housekeeping and does not affect chain
// integrity verification (verification of purged records is impossible by
// design).
func (s *MemoryStorage) PurgeOlderThan(cutoff time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()

	remaining := s.audit[:0]
	purged := 0
	for _, r := range s.audit {
		if r.Timestamp.Before(cutoff) {
			purged++
		} else {
			remaining = append(remaining, r)
		}
	}
	s.audit = remaining
	return purged
}
