// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package governance

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance/storage"
)

// newTrustManager is a test helper that constructs a TrustManager with a
// fresh in-memory store and the supplied config.
func newTrustManager(cfg TrustConfig) *TrustManager {
	return NewTrustManager(storage.NewMemoryStorage(), cfg)
}

// defaultTrustManager returns a TrustManager with all-zero (default) config.
func defaultTrustManager() *TrustManager {
	return newTrustManager(TrustConfig{DefaultLevel: TrustObserver})
}

// --- TrustLevelName ----------------------------------------------------------

func TestTrustLevelName_KnownLevels(t *testing.T) {
	cases := []struct {
		level TrustLevel
		want  string
	}{
		{TrustObserver, "Observer"},
		{TrustMonitor, "Monitor"},
		{TrustSuggest, "Suggest"},
		{TrustActWithApproval, "Act-with-Approval"},
		{TrustActAndReport, "Act-and-Report"},
		{TrustAutonomous, "Autonomous"},
	}
	for _, tc := range cases {
		got := TrustLevelName(tc.level)
		if got != tc.want {
			t.Errorf("TrustLevelName(%d) = %q, want %q", tc.level, got, tc.want)
		}
	}
}

func TestTrustLevelName_Unknown(t *testing.T) {
	got := TrustLevelName(TrustLevel(99))
	if got != "Unknown" {
		t.Errorf("TrustLevelName(99) = %q, want %q", got, "Unknown")
	}
}

// --- TrustManager.SetLevel ---------------------------------------------------

func TestTrustManager_SetLevel_StoresAssignment(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	assignment, err := m.SetLevel(ctx, "agent-1", TrustSuggest, "production")
	if err != nil {
		t.Fatalf("SetLevel returned unexpected error: %v", err)
	}
	if assignment == nil {
		t.Fatal("SetLevel returned nil assignment")
	}
	if assignment.AgentID != "agent-1" {
		t.Errorf("assignment.AgentID = %q, want %q", assignment.AgentID, "agent-1")
	}
	if assignment.Level != TrustSuggest {
		t.Errorf("assignment.Level = %d, want %d", assignment.Level, TrustSuggest)
	}
	if assignment.Scope != "production" {
		t.Errorf("assignment.Scope = %q, want %q", assignment.Scope, "production")
	}
	if assignment.AssignedAt.IsZero() {
		t.Error("assignment.AssignedAt must not be zero")
	}
	if assignment.AssignedBy != "owner" {
		t.Errorf("assignment.AssignedBy = %q, want %q (default)", assignment.AssignedBy, "owner")
	}
}

func TestTrustManager_SetLevel_EmptyAgentID_ReturnsError(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	_, err := m.SetLevel(ctx, "", TrustSuggest, "default")
	if err == nil {
		t.Fatal("expected an error for empty agentID, got nil")
	}
}

func TestTrustManager_SetLevel_InvalidLevel_ReturnsError(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	_, err := m.SetLevel(ctx, "agent-1", TrustLevel(99), "default")
	if err == nil {
		t.Fatal("expected an error for invalid trust level, got nil")
	}
	if !errors.Is(err, ErrInvalidTrustLevel) {
		t.Errorf("expected ErrInvalidTrustLevel, got %v", err)
	}
}

func TestTrustManager_SetLevel_EmptyScope_DefaultsToDefault(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	assignment, err := m.SetLevel(ctx, "agent-1", TrustMonitor, "")
	if err != nil {
		t.Fatalf("SetLevel returned unexpected error: %v", err)
	}
	if assignment.Scope != "default" {
		t.Errorf("assignment.Scope = %q, want %q", assignment.Scope, "default")
	}
}

func TestTrustManager_SetLevel_WithAssignedBy(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	assignment, err := m.SetLevel(ctx, "agent-1", TrustAutonomous, "ops", WithAssignedBy("admin"))
	if err != nil {
		t.Fatalf("SetLevel returned unexpected error: %v", err)
	}
	if assignment.AssignedBy != "admin" {
		t.Errorf("assignment.AssignedBy = %q, want %q", assignment.AssignedBy, "admin")
	}
}

func TestTrustManager_SetLevel_WithExpiry(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()
	expiry := time.Now().Add(24 * time.Hour)

	assignment, err := m.SetLevel(ctx, "agent-1", TrustSuggest, "default", WithExpiry(expiry))
	if err != nil {
		t.Fatalf("SetLevel returned unexpected error: %v", err)
	}
	if assignment.ExpiresAt == nil {
		t.Fatal("expected non-nil ExpiresAt")
	}
}

func TestTrustManager_SetLevel_CanOverwriteExistingAssignment(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	_, err := m.SetLevel(ctx, "agent-1", TrustMonitor, "default")
	if err != nil {
		t.Fatalf("first SetLevel error: %v", err)
	}
	_, err = m.SetLevel(ctx, "agent-1", TrustAutonomous, "default")
	if err != nil {
		t.Fatalf("second SetLevel error: %v", err)
	}

	level := m.GetLevel(ctx, "agent-1", "default")
	if level != TrustAutonomous {
		t.Errorf("GetLevel = %d, want %d (TrustAutonomous)", level, TrustAutonomous)
	}
}

// --- TrustManager.GetLevel ---------------------------------------------------

func TestTrustManager_GetLevel_NoAssignment_ReturnsDefault(t *testing.T) {
	m := newTrustManager(TrustConfig{DefaultLevel: TrustMonitor})
	ctx := context.Background()

	level := m.GetLevel(ctx, "unknown-agent", "default")
	if level != TrustMonitor {
		t.Errorf("GetLevel = %d, want %d (TrustMonitor, the configured default)", level, TrustMonitor)
	}
}

func TestTrustManager_GetLevel_AfterSetLevel_ReturnsAssignedLevel(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	_, err := m.SetLevel(ctx, "agent-1", TrustActAndReport, "ops")
	if err != nil {
		t.Fatalf("SetLevel error: %v", err)
	}

	level := m.GetLevel(ctx, "agent-1", "ops")
	if level != TrustActAndReport {
		t.Errorf("GetLevel = %d, want %d (TrustActAndReport)", level, TrustActAndReport)
	}
}

func TestTrustManager_GetLevel_ExpiredAssignment_ReturnsDefault(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	// Set an assignment that expired in the past.
	expiry := time.Now().Add(-1 * time.Hour)
	_, err := m.SetLevel(ctx, "agent-1", TrustAutonomous, "default", WithExpiry(expiry))
	if err != nil {
		t.Fatalf("SetLevel error: %v", err)
	}

	level := m.GetLevel(ctx, "agent-1", "default")
	// Default is TrustObserver (0).
	if level != TrustObserver {
		t.Errorf("GetLevel after expiry = %d, want %d (TrustObserver, the default)", level, TrustObserver)
	}
}

func TestTrustManager_GetLevel_ScopeIsolation(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	_, err := m.SetLevel(ctx, "agent-1", TrustAutonomous, "scope-a")
	if err != nil {
		t.Fatalf("SetLevel error: %v", err)
	}

	levelA := m.GetLevel(ctx, "agent-1", "scope-a")
	levelB := m.GetLevel(ctx, "agent-1", "scope-b")

	if levelA != TrustAutonomous {
		t.Errorf("scope-a level = %d, want TrustAutonomous", levelA)
	}
	if levelB != TrustObserver {
		t.Errorf("scope-b level = %d, want TrustObserver (no assignment in this scope)", levelB)
	}
}

// --- TrustManager.CheckLevel -------------------------------------------------

func TestTrustManager_CheckLevel_MeetsRequired_Permitted(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	_, err := m.SetLevel(ctx, "agent-1", TrustActWithApproval, "default")
	if err != nil {
		t.Fatalf("SetLevel error: %v", err)
	}

	result := m.CheckLevel(ctx, "agent-1", TrustSuggest, "default")
	if !result.Permitted {
		t.Errorf("expected Permitted=true (TrustActWithApproval >= TrustSuggest), got false. Reason: %s", result.Reason)
	}
}

func TestTrustManager_CheckLevel_ExactlyMeetsRequired_Permitted(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	_, err := m.SetLevel(ctx, "agent-1", TrustSuggest, "default")
	if err != nil {
		t.Fatalf("SetLevel error: %v", err)
	}

	result := m.CheckLevel(ctx, "agent-1", TrustSuggest, "default")
	if !result.Permitted {
		t.Errorf("expected Permitted=true (exact match), got false. Reason: %s", result.Reason)
	}
}

func TestTrustManager_CheckLevel_BelowRequired_Denied(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	_, err := m.SetLevel(ctx, "agent-1", TrustObserver, "default")
	if err != nil {
		t.Fatalf("SetLevel error: %v", err)
	}

	result := m.CheckLevel(ctx, "agent-1", TrustAutonomous, "default")
	if result.Permitted {
		t.Errorf("expected Permitted=false (TrustObserver < TrustAutonomous), got true")
	}
	if result.CurrentLevel != TrustObserver {
		t.Errorf("result.CurrentLevel = %d, want TrustObserver", result.CurrentLevel)
	}
	if result.RequiredLevel != TrustAutonomous {
		t.Errorf("result.RequiredLevel = %d, want TrustAutonomous", result.RequiredLevel)
	}
}

func TestTrustManager_CheckLevel_NoAssignment_UsesDefault(t *testing.T) {
	// Default level is TrustSuggest; requiring TrustAutonomous should deny.
	m := newTrustManager(TrustConfig{DefaultLevel: TrustSuggest})
	ctx := context.Background()

	result := m.CheckLevel(ctx, "never-configured", TrustAutonomous, "default")
	if result.Permitted {
		t.Error("expected Permitted=false, got true")
	}
}

func TestTrustManager_CheckLevel_ResultNeverNil(t *testing.T) {
	m := defaultTrustManager()
	ctx := context.Background()

	result := m.CheckLevel(ctx, "agent-1", TrustObserver, "default")
	if result == nil {
		t.Fatal("CheckLevel must never return nil")
	}
}
