// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package governance

import (
	"context"
	"testing"
	"time"
)

// newTestEngine returns a GovernanceEngine created with the supplied Config.
// It fatals the test if NewEngine returns an error.
func newTestEngine(t *testing.T, cfg Config) *GovernanceEngine {
	t.Helper()
	engine, err := NewEngine(cfg)
	if err != nil {
		t.Fatalf("NewEngine returned unexpected error: %v", err)
	}
	return engine
}

// defaultTestEngine returns a GovernanceEngine with all default configuration.
func defaultTestEngine(t *testing.T) *GovernanceEngine {
	t.Helper()
	return newTestEngine(t, Config{})
}

// --- NewEngine ---------------------------------------------------------------

func TestNewEngine_DefaultConfig_Succeeds(t *testing.T) {
	engine, err := NewEngine(Config{})
	if err != nil {
		t.Fatalf("NewEngine(Config{}) returned unexpected error: %v", err)
	}
	if engine == nil {
		t.Fatal("NewEngine returned nil engine")
	}
	if engine.Trust == nil {
		t.Error("engine.Trust must not be nil")
	}
	if engine.Budget == nil {
		t.Error("engine.Budget must not be nil")
	}
	if engine.Consent == nil {
		t.Error("engine.Consent must not be nil")
	}
	if engine.Audit == nil {
		t.Error("engine.Audit must not be nil")
	}
}

func TestNewEngine_InvalidDefaultScope_StillSucceeds(t *testing.T) {
	// An empty DefaultScope is valid — the engine fills it in with "default".
	engine, err := NewEngine(Config{DefaultScope: ""})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if engine == nil {
		t.Fatal("expected non-nil engine")
	}
}

func TestNewEngine_InvalidTrustLevel_ReturnsError(t *testing.T) {
	_, err := NewEngine(Config{
		TrustConfig: TrustConfig{DefaultLevel: TrustLevel(99)},
	})
	if err == nil {
		t.Fatal("expected error for invalid DefaultTrustLevel, got nil")
	}
}

func TestNewEngine_NegativeAuditMaxRecords_ReturnsError(t *testing.T) {
	_, err := NewEngine(Config{
		AuditConfig: AuditConfig{MaxRecords: -1},
	})
	if err == nil {
		t.Fatal("expected error for negative MaxRecords, got nil")
	}
}

// --- GovernanceEngine.Check — no opts ----------------------------------------

func TestEngine_Check_NoOpts_PermittedByDefault(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	decision, err := engine.Check(ctx, "any_action")
	if err != nil {
		t.Fatalf("Check returned unexpected error: %v", err)
	}
	if decision == nil {
		t.Fatal("Check must never return nil decision on nil error")
	}
	if !decision.Permitted {
		t.Errorf("expected Permitted=true with no opts, got false. Reason: %s", decision.Reason)
	}
}

func TestEngine_Check_ActionStoredInDecision(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	decision, err := engine.Check(ctx, "send_email")
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}
	if decision.Action != "send_email" {
		t.Errorf("decision.Action = %q, want %q", decision.Action, "send_email")
	}
}

func TestEngine_Check_TimestampIsPopulated(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	before := time.Now().UTC().Add(-time.Second)
	decision, _ := engine.Check(ctx, "op")
	after := time.Now().UTC().Add(time.Second)

	if decision.Timestamp.Before(before) || decision.Timestamp.After(after) {
		t.Errorf("decision.Timestamp = %v is outside expected range [%v, %v]", decision.Timestamp, before, after)
	}
}

func TestEngine_Check_AlwaysWritesAuditRecord(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	_, err := engine.Check(ctx, "op-1")
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}
	_, err = engine.Check(ctx, "op-2")
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}

	records, err := engine.Audit.Query(ctx)
	if err != nil {
		t.Fatalf("Audit.Query error: %v", err)
	}
	if len(records) != 2 {
		t.Errorf("expected 2 audit records, got %d", len(records))
	}
}

// --- GovernanceEngine.Check — WithAgentID ------------------------------------

func TestEngine_Check_WithAgentID_StoredInDecision(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	decision, err := engine.Check(ctx, "op", WithAgentID("agent-42"))
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}
	if decision.AgentID != "agent-42" {
		t.Errorf("decision.AgentID = %q, want %q", decision.AgentID, "agent-42")
	}
}

// --- GovernanceEngine.Check — WithRequiredTrust ------------------------------

func TestEngine_Check_WithRequiredTrust_Passes(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	_, err := engine.Trust.SetLevel(ctx, "agent-1", TrustActWithApproval, "default")
	if err != nil {
		t.Fatalf("Trust.SetLevel error: %v", err)
	}

	decision, err := engine.Check(ctx, "op",
		WithAgentID("agent-1"),
		WithRequiredTrust(TrustSuggest),
	)
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}
	if !decision.Permitted {
		t.Errorf("expected Permitted=true, got false. Reason: %s", decision.Reason)
	}
	if !decision.Trust.Permitted {
		t.Errorf("expected Trust.Permitted=true, got false")
	}
}

func TestEngine_Check_WithRequiredTrust_Fails(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	// Default trust level is TrustObserver (0). Require TrustAutonomous (5).
	decision, err := engine.Check(ctx, "op",
		WithAgentID("agent-low"),
		WithRequiredTrust(TrustAutonomous),
	)
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}
	if decision.Permitted {
		t.Error("expected Permitted=false (trust too low), got true")
	}
	if decision.Trust.Permitted {
		t.Error("expected Trust.Permitted=false")
	}
}

// --- GovernanceEngine.Check — WithBudgetCheck --------------------------------

func TestEngine_Check_WithBudgetCheck_Passes(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	_, err := engine.Budget.CreateEnvelope(ctx, "llm", 100.0, 30*24*time.Hour)
	if err != nil {
		t.Fatalf("Budget.CreateEnvelope error: %v", err)
	}

	decision, err := engine.Check(ctx, "op",
		WithBudgetCheck("llm", 10.0),
	)
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}
	if !decision.Permitted {
		t.Errorf("expected Permitted=true (budget sufficient), got false. Reason: %s", decision.Reason)
	}
	if !decision.Budget.Permitted {
		t.Errorf("expected Budget.Permitted=true")
	}
}

func TestEngine_Check_WithBudgetCheck_Fails(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	_, err := engine.Budget.CreateEnvelope(ctx, "llm", 5.0, 30*24*time.Hour)
	if err != nil {
		t.Fatalf("Budget.CreateEnvelope error: %v", err)
	}

	decision, err := engine.Check(ctx, "op",
		WithBudgetCheck("llm", 10.0),
	)
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}
	if decision.Permitted {
		t.Error("expected Permitted=false (insufficient budget), got true")
	}
	if decision.Budget.Permitted {
		t.Error("expected Budget.Permitted=false")
	}
}

// --- GovernanceEngine.Check — WithConsentCheck -------------------------------

func TestEngine_Check_WithConsentCheck_Passes(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	if err := engine.Consent.Record(ctx, "agent-1", "send_email", "admin"); err != nil {
		t.Fatalf("Consent.Record error: %v", err)
	}

	decision, err := engine.Check(ctx, "send_email",
		WithConsentCheck("agent-1", "send_email"),
	)
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}
	if !decision.Permitted {
		t.Errorf("expected Permitted=true (consent granted), got false. Reason: %s", decision.Reason)
	}
	if !decision.Consent.Permitted {
		t.Errorf("expected Consent.Permitted=true")
	}
}

func TestEngine_Check_WithConsentCheck_Fails(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	decision, err := engine.Check(ctx, "send_email",
		WithConsentCheck("agent-1", "send_email"),
	)
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}
	if decision.Permitted {
		t.Error("expected Permitted=false (no consent), got true")
	}
	if decision.Consent.Permitted {
		t.Error("expected Consent.Permitted=false")
	}
}

// --- GovernanceEngine.Check — sequential evaluation order --------------------

func TestEngine_Check_TrustFailsFirst_BudgetNotChecked(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	// Create a budget envelope but do not grant trust.
	_, err := engine.Budget.CreateEnvelope(ctx, "llm", 100.0, 0)
	if err != nil {
		t.Fatalf("Budget.CreateEnvelope error: %v", err)
	}

	decision, err := engine.Check(ctx, "op",
		WithAgentID("low-trust-agent"),
		WithRequiredTrust(TrustAutonomous),
		WithBudgetCheck("llm", 10.0),
	)
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}
	if decision.Permitted {
		t.Error("expected Permitted=false (trust failed), got true")
	}
	// Budget check must not have run — BudgetResult should be zero value.
	if decision.Budget.Permitted {
		t.Error("budget check should not have run when trust fails first")
	}
	if decision.Budget.Category != "" {
		t.Errorf("budget should be zero value, got category=%q", decision.Budget.Category)
	}
}

func TestEngine_Check_BudgetFailsSecond_ConsentNotChecked(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	// Grant trust, create under-funded budget, grant consent.
	_, err := engine.Trust.SetLevel(ctx, "agent-1", TrustAutonomous, "default")
	if err != nil {
		t.Fatalf("Trust.SetLevel error: %v", err)
	}
	_, err = engine.Budget.CreateEnvelope(ctx, "llm", 1.0, 0)
	if err != nil {
		t.Fatalf("Budget.CreateEnvelope error: %v", err)
	}
	if err := engine.Consent.Record(ctx, "agent-1", "op", "admin"); err != nil {
		t.Fatalf("Consent.Record error: %v", err)
	}

	decision, err := engine.Check(ctx, "op",
		WithAgentID("agent-1"),
		WithRequiredTrust(TrustSuggest),
		WithBudgetCheck("llm", 100.0), // exceeds limit
		WithConsentCheck("agent-1", "op"),
	)
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}
	if decision.Permitted {
		t.Error("expected Permitted=false (budget failed), got true")
	}
	// Trust must have passed.
	if !decision.Trust.Permitted {
		t.Error("expected Trust.Permitted=true")
	}
	// Budget must have failed.
	if decision.Budget.Permitted {
		t.Error("expected Budget.Permitted=false")
	}
	// Consent must not have run — ConsentResult should be zero value.
	if decision.Consent.Permitted {
		t.Error("consent check should not have run when budget fails")
	}
}

func TestEngine_Check_AllChecksPass_ReturnsPermitted(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	_, err := engine.Trust.SetLevel(ctx, "agent-1", TrustActWithApproval, "default")
	if err != nil {
		t.Fatalf("Trust.SetLevel error: %v", err)
	}
	_, err = engine.Budget.CreateEnvelope(ctx, "llm", 100.0, 30*24*time.Hour)
	if err != nil {
		t.Fatalf("Budget.CreateEnvelope error: %v", err)
	}
	if err := engine.Consent.Record(ctx, "agent-1", "send_email", "admin"); err != nil {
		t.Fatalf("Consent.Record error: %v", err)
	}

	decision, err := engine.Check(ctx, "send_email",
		WithAgentID("agent-1"),
		WithRequiredTrust(TrustSuggest),
		WithBudgetCheck("llm", 5.0),
		WithConsentCheck("agent-1", "send_email"),
	)
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}
	if !decision.Permitted {
		t.Errorf("expected Permitted=true (all checks pass), got false. Reason: %s", decision.Reason)
	}
	if !decision.Trust.Permitted {
		t.Error("expected Trust.Permitted=true")
	}
	if !decision.Budget.Permitted {
		t.Error("expected Budget.Permitted=true")
	}
	if !decision.Consent.Permitted {
		t.Error("expected Consent.Permitted=true")
	}
}

// --- GovernanceEngine.Check — WithBudgetRecord -------------------------------

func TestEngine_Check_WithBudgetRecord_RecordsSpendOnPermit(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx := context.Background()

	_, err := engine.Budget.CreateEnvelope(ctx, "llm", 100.0, 30*24*time.Hour)
	if err != nil {
		t.Fatalf("Budget.CreateEnvelope error: %v", err)
	}

	_, err = engine.Check(ctx, "op",
		WithBudgetCheck("llm", 20.0),
		WithBudgetRecord(),
	)
	if err != nil {
		t.Fatalf("Check error: %v", err)
	}

	// After recording 20.0, only 80.0 should remain — 90.0 should be denied.
	result := engine.Budget.Check(ctx, "llm", 90.0)
	if result.Permitted {
		t.Errorf("expected budget check for 90.0 to fail after recording 20.0 spend")
	}
}

// --- GovernanceEngine.Check — context cancellation --------------------------

func TestEngine_Check_CancelledContext_ReturnsError(t *testing.T) {
	engine := defaultTestEngine(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	decision, err := engine.Check(ctx, "op")
	if err == nil {
		t.Fatal("expected error for cancelled context, got nil")
	}
	if decision != nil {
		t.Error("expected nil decision for cancelled context")
	}
}

// --- Config.validate / Config.applyDefaults ----------------------------------

func TestConfig_ApplyDefaults_FillsDefaultScope(t *testing.T) {
	cfg := Config{}
	cfg.applyDefaults()
	if cfg.DefaultScope != "default" {
		t.Errorf("DefaultScope = %q, want %q", cfg.DefaultScope, "default")
	}
}

func TestConfig_ApplyDefaults_FillsDefaultPeriod(t *testing.T) {
	cfg := Config{}
	cfg.applyDefaults()
	expected := 30 * 24 * time.Hour
	if cfg.BudgetConfig.DefaultPeriod != expected {
		t.Errorf("BudgetConfig.DefaultPeriod = %v, want %v", cfg.BudgetConfig.DefaultPeriod, expected)
	}
}

func TestConfig_Validate_ValidConfig_NoError(t *testing.T) {
	cfg := Config{}
	cfg.applyDefaults()
	if err := cfg.validate(); err != nil {
		t.Errorf("validate() returned unexpected error for valid config: %v", err)
	}
}
