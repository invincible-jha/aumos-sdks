// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package governance

import (
	"context"
	"testing"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance/storage"
)

// newAuditLogger is a test helper that constructs an AuditLogger with a
// fresh in-memory store and the supplied config.
func newAuditLogger(cfg AuditConfig) *AuditLogger {
	return NewAuditLogger(storage.NewMemoryStorage(), cfg)
}

// makeDecision builds a minimal governance Decision for test use.
func makeDecision(action string, permitted bool) *Decision {
	return &Decision{
		Permitted: permitted,
		AgentID:   "agent-1",
		Action:    action,
		Timestamp: time.Now().UTC(),
		Reason:    "test reason",
	}
}

// --- AuditLogger.Log ---------------------------------------------------------

func TestAuditLogger_Log_NilDecision_ReturnsError(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	err := logger.Log(ctx, nil)
	if err == nil {
		t.Fatal("expected error for nil decision, got nil")
	}
}

func TestAuditLogger_Log_Succeeds(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	err := logger.Log(ctx, makeDecision("send_email", true))
	if err != nil {
		t.Fatalf("Log returned unexpected error: %v", err)
	}
}

func TestAuditLogger_Log_RecordsAreQueryable(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	if err := logger.Log(ctx, makeDecision("send_email", true)); err != nil {
		t.Fatalf("Log error: %v", err)
	}

	records, err := logger.Query(ctx)
	if err != nil {
		t.Fatalf("Query error: %v", err)
	}
	if len(records) != 1 {
		t.Errorf("expected 1 record, got %d", len(records))
	}
}

func TestAuditLogger_Log_HashChainLinks(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	for i := range 3 {
		action := "action-" + string(rune('a'+i))
		if err := logger.Log(ctx, makeDecision(action, true)); err != nil {
			t.Fatalf("Log error at %d: %v", i, err)
		}
	}

	records, err := logger.Query(ctx)
	if err != nil {
		t.Fatalf("Query error: %v", err)
	}
	if len(records) != 3 {
		t.Fatalf("expected 3 records, got %d", len(records))
	}

	// The first record's PrevHash must be the genesis hash.
	if records[0].PrevHash != genesisHash {
		t.Errorf("first record PrevHash = %q, want genesis hash", records[0].PrevHash)
	}
	// Each subsequent record's PrevHash must equal the previous record's Hash.
	for i := 1; i < len(records); i++ {
		if records[i].PrevHash != records[i-1].Hash {
			t.Errorf("records[%d].PrevHash = %q, want records[%d].Hash = %q", i, records[i].PrevHash, i-1, records[i-1].Hash)
		}
	}
}

func TestAuditLogger_Log_UniqueIDsPerRecord(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	if err := logger.Log(ctx, makeDecision("action-a", true)); err != nil {
		t.Fatalf("Log error: %v", err)
	}
	if err := logger.Log(ctx, makeDecision("action-b", false)); err != nil {
		t.Fatalf("Log error: %v", err)
	}

	records, _ := logger.Query(ctx)
	if records[0].ID == records[1].ID {
		t.Errorf("IDs must be unique; both records have ID %q", records[0].ID)
	}
}

func TestAuditLogger_Log_IDNeverEmpty(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	if err := logger.Log(ctx, makeDecision("op", true)); err != nil {
		t.Fatalf("Log error: %v", err)
	}

	records, _ := logger.Query(ctx)
	if records[0].ID == "" {
		t.Error("audit record ID must never be empty")
	}
}

func TestAuditLogger_Log_HashNeverEmpty(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	if err := logger.Log(ctx, makeDecision("op", true)); err != nil {
		t.Fatalf("Log error: %v", err)
	}

	records, _ := logger.Query(ctx)
	if records[0].Hash == "" {
		t.Error("audit record Hash must never be empty")
	}
}

// --- AuditLogger.Query -------------------------------------------------------

func TestAuditLogger_Query_EmptyLog_ReturnsEmptySlice(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	records, err := logger.Query(ctx)
	if err != nil {
		t.Fatalf("Query error: %v", err)
	}
	if records == nil {
		t.Error("Query must return a non-nil slice, even when empty")
	}
	if len(records) != 0 {
		t.Errorf("expected 0 records, got %d", len(records))
	}
}

func TestAuditLogger_Query_WithAgentFilter(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	d1 := &Decision{Permitted: true, AgentID: "agent-a", Action: "act", Timestamp: time.Now().UTC()}
	d2 := &Decision{Permitted: true, AgentID: "agent-b", Action: "act", Timestamp: time.Now().UTC()}

	_ = logger.Log(ctx, d1)
	_ = logger.Log(ctx, d2)

	records, err := logger.Query(ctx, WithAgentFilter("agent-a"))
	if err != nil {
		t.Fatalf("Query error: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 record for agent-a, got %d", len(records))
	}
	if records[0].Decision.AgentID != "agent-a" {
		t.Errorf("record.Decision.AgentID = %q, want %q", records[0].Decision.AgentID, "agent-a")
	}
}

func TestAuditLogger_Query_WithPermittedOnly(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	_ = logger.Log(ctx, makeDecision("allowed-op", true))
	_ = logger.Log(ctx, makeDecision("denied-op", false))

	records, err := logger.Query(ctx, WithPermittedOnly())
	if err != nil {
		t.Fatalf("Query error: %v", err)
	}
	for _, r := range records {
		if !r.Decision.Permitted {
			t.Errorf("WithPermittedOnly returned a denied record: %+v", r)
		}
	}
	if len(records) != 1 {
		t.Errorf("expected 1 permitted record, got %d", len(records))
	}
}

func TestAuditLogger_Query_WithDeniedOnly(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	_ = logger.Log(ctx, makeDecision("allowed-op", true))
	_ = logger.Log(ctx, makeDecision("denied-op", false))

	records, err := logger.Query(ctx, WithDeniedOnly())
	if err != nil {
		t.Fatalf("Query error: %v", err)
	}
	if len(records) != 1 {
		t.Errorf("expected 1 denied record, got %d", len(records))
	}
	if records[0].Decision.Permitted {
		t.Error("WithDeniedOnly returned a permitted record")
	}
}

func TestAuditLogger_Query_WithQueryLimit(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	for range 5 {
		_ = logger.Log(ctx, makeDecision("op", true))
	}

	records, err := logger.Query(ctx, WithQueryLimit(3))
	if err != nil {
		t.Fatalf("Query error: %v", err)
	}
	if len(records) != 3 {
		t.Errorf("expected 3 records with limit=3, got %d", len(records))
	}
}

func TestAuditLogger_Query_WithActionFilter(t *testing.T) {
	logger := newAuditLogger(AuditConfig{})
	ctx := context.Background()

	_ = logger.Log(ctx, makeDecision("send_email", true))
	_ = logger.Log(ctx, makeDecision("delete_file", true))
	_ = logger.Log(ctx, makeDecision("send_email", false))

	records, err := logger.Query(ctx, WithActionFilter("send_email"))
	if err != nil {
		t.Fatalf("Query error: %v", err)
	}
	if len(records) != 2 {
		t.Errorf("expected 2 records for action send_email, got %d", len(records))
	}
	for _, r := range records {
		if r.Decision.Action != "send_email" {
			t.Errorf("unexpected action in filtered record: %q", r.Decision.Action)
		}
	}
}
