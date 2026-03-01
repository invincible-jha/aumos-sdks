// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package governance

import (
	"context"
	"errors"
	"testing"

	"github.com/aumos-ai/aumos-sdks/go/governance/storage"
)

// newConsentManager is a test helper that constructs a ConsentManager with a
// fresh in-memory store.
func newConsentManager() *ConsentManager {
	return NewConsentManager(storage.NewMemoryStorage())
}

// --- ConsentManager.Record ---------------------------------------------------

func TestConsentManager_Record_EmptyAgentID_ReturnsError(t *testing.T) {
	m := newConsentManager()
	ctx := context.Background()

	err := m.Record(ctx, "", "send_email", "admin")
	if err == nil {
		t.Fatal("expected error for empty agentID, got nil")
	}
}

func TestConsentManager_Record_EmptyAction_ReturnsError(t *testing.T) {
	m := newConsentManager()
	ctx := context.Background()

	err := m.Record(ctx, "agent-1", "", "admin")
	if err == nil {
		t.Fatal("expected error for empty action, got nil")
	}
}

func TestConsentManager_Record_EmptyGrantedBy_ReturnsError(t *testing.T) {
	m := newConsentManager()
	ctx := context.Background()

	err := m.Record(ctx, "agent-1", "send_email", "")
	if err == nil {
		t.Fatal("expected error for empty grantedBy, got nil")
	}
}

func TestConsentManager_Record_ValidArgs_Succeeds(t *testing.T) {
	m := newConsentManager()
	ctx := context.Background()

	err := m.Record(ctx, "agent-1", "send_email", "admin")
	if err != nil {
		t.Fatalf("Record returned unexpected error: %v", err)
	}
}

func TestConsentManager_Record_ReinstatesRevokedConsent(t *testing.T) {
	m := newConsentManager()
	ctx := context.Background()

	if err := m.Record(ctx, "agent-1", "send_email", "admin"); err != nil {
		t.Fatalf("first Record error: %v", err)
	}
	if err := m.Revoke(ctx, "agent-1", "send_email"); err != nil {
		t.Fatalf("Revoke error: %v", err)
	}
	if err := m.Record(ctx, "agent-1", "send_email", "admin"); err != nil {
		t.Fatalf("second Record (reinstate) error: %v", err)
	}

	result := m.Check(ctx, "send_email", "agent-1")
	if !result.Permitted {
		t.Errorf("expected Permitted=true after reinstatement, got false. Reason: %s", result.Reason)
	}
}

// --- ConsentManager.Check ----------------------------------------------------

func TestConsentManager_Check_NoConsent_Denied(t *testing.T) {
	m := newConsentManager()
	ctx := context.Background()

	result := m.Check(ctx, "send_email", "agent-1")
	if result == nil {
		t.Fatal("Check must never return nil")
	}
	if result.Permitted {
		t.Error("expected Permitted=false when no consent exists")
	}
}

func TestConsentManager_Check_AfterRecord_Permitted(t *testing.T) {
	m := newConsentManager()
	ctx := context.Background()

	if err := m.Record(ctx, "agent-1", "send_email", "admin"); err != nil {
		t.Fatalf("Record error: %v", err)
	}

	result := m.Check(ctx, "send_email", "agent-1")
	if !result.Permitted {
		t.Errorf("expected Permitted=true after Record, got false. Reason: %s", result.Reason)
	}
}

func TestConsentManager_Check_AgentIsolation(t *testing.T) {
	m := newConsentManager()
	ctx := context.Background()

	// Grant consent to agent-1 only.
	if err := m.Record(ctx, "agent-1", "send_email", "admin"); err != nil {
		t.Fatalf("Record error: %v", err)
	}

	r1 := m.Check(ctx, "send_email", "agent-1")
	r2 := m.Check(ctx, "send_email", "agent-2")

	if !r1.Permitted {
		t.Error("agent-1 should have consent, got denied")
	}
	if r2.Permitted {
		t.Error("agent-2 should not have consent, got permitted")
	}
}

func TestConsentManager_Check_ActionIsolation(t *testing.T) {
	m := newConsentManager()
	ctx := context.Background()

	// Grant consent for "send_email" only.
	if err := m.Record(ctx, "agent-1", "send_email", "admin"); err != nil {
		t.Fatalf("Record error: %v", err)
	}

	r1 := m.Check(ctx, "send_email", "agent-1")
	r2 := m.Check(ctx, "delete_file", "agent-1")

	if !r1.Permitted {
		t.Error("send_email consent should be granted")
	}
	if r2.Permitted {
		t.Error("delete_file consent was not granted, should be denied")
	}
}

// --- ConsentManager.Revoke ---------------------------------------------------

func TestConsentManager_Revoke_AfterRecord_DeniesSubsequentCheck(t *testing.T) {
	m := newConsentManager()
	ctx := context.Background()

	if err := m.Record(ctx, "agent-1", "send_email", "admin"); err != nil {
		t.Fatalf("Record error: %v", err)
	}
	if err := m.Revoke(ctx, "agent-1", "send_email"); err != nil {
		t.Fatalf("Revoke error: %v", err)
	}

	result := m.Check(ctx, "send_email", "agent-1")
	if result.Permitted {
		t.Error("expected Permitted=false after Revoke, got true")
	}
}

func TestConsentManager_Revoke_NoConsent_ReturnsError(t *testing.T) {
	m := newConsentManager()
	ctx := context.Background()

	err := m.Revoke(ctx, "agent-1", "send_email")
	if err == nil {
		t.Fatal("expected ErrConsentNotFound, got nil")
	}
	if !errors.Is(err, ErrConsentNotFound) {
		t.Errorf("expected ErrConsentNotFound, got %v", err)
	}
}

func TestConsentManager_Revoke_SecondRevoke_ReturnsError(t *testing.T) {
	m := newConsentManager()
	ctx := context.Background()

	if err := m.Record(ctx, "agent-1", "send_email", "admin"); err != nil {
		t.Fatalf("Record error: %v", err)
	}
	if err := m.Revoke(ctx, "agent-1", "send_email"); err != nil {
		t.Fatalf("first Revoke error: %v", err)
	}

	err := m.Revoke(ctx, "agent-1", "send_email")
	if err == nil {
		t.Fatal("expected ErrConsentNotFound on second Revoke, got nil")
	}
	if !errors.Is(err, ErrConsentNotFound) {
		t.Errorf("expected ErrConsentNotFound, got %v", err)
	}
}
