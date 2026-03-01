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

// newBudgetManager is a test helper that constructs a BudgetManager with a
// fresh in-memory store and the supplied config.
func newBudgetManager(cfg BudgetConfig) *BudgetManager {
	return NewBudgetManager(storage.NewMemoryStorage(), cfg)
}

// defaultBudgetManager returns a BudgetManager with strict-mode config.
func defaultBudgetManager() *BudgetManager {
	return newBudgetManager(BudgetConfig{
		AllowOverspend: false,
		DefaultPeriod:  30 * 24 * time.Hour,
	})
}

// --- BudgetManager.CreateEnvelope --------------------------------------------

func TestBudgetManager_CreateEnvelope_ReturnsEnvelope(t *testing.T) {
	m := defaultBudgetManager()
	ctx := context.Background()

	env, err := m.CreateEnvelope(ctx, "llm", 100.0, 30*24*time.Hour)
	if err != nil {
		t.Fatalf("CreateEnvelope returned unexpected error: %v", err)
	}
	if env == nil {
		t.Fatal("CreateEnvelope returned nil envelope")
	}
	if env.Category != "llm" {
		t.Errorf("env.Category = %q, want %q", env.Category, "llm")
	}
	if env.Limit != 100.0 {
		t.Errorf("env.Limit = %f, want 100.0", env.Limit)
	}
	if env.Spent != 0 {
		t.Errorf("env.Spent = %f, want 0 (new envelope)", env.Spent)
	}
	if env.StartsAt.IsZero() {
		t.Error("env.StartsAt must not be zero")
	}
}

func TestBudgetManager_CreateEnvelope_EmptyCategory_ReturnsError(t *testing.T) {
	m := defaultBudgetManager()
	ctx := context.Background()

	_, err := m.CreateEnvelope(ctx, "", 100.0, 0)
	if err == nil {
		t.Fatal("expected error for empty category, got nil")
	}
}

func TestBudgetManager_CreateEnvelope_NegativeLimit_ReturnsError(t *testing.T) {
	m := defaultBudgetManager()
	ctx := context.Background()

	_, err := m.CreateEnvelope(ctx, "llm", -1.0, 0)
	if err == nil {
		t.Fatal("expected error for negative limit, got nil")
	}
	if !errors.Is(err, ErrInvalidAmount) {
		t.Errorf("expected ErrInvalidAmount, got %v", err)
	}
}

func TestBudgetManager_CreateEnvelope_DuplicateCategory_ReturnsError(t *testing.T) {
	m := defaultBudgetManager()
	ctx := context.Background()

	_, err := m.CreateEnvelope(ctx, "llm", 100.0, 0)
	if err != nil {
		t.Fatalf("first CreateEnvelope error: %v", err)
	}
	_, err = m.CreateEnvelope(ctx, "llm", 200.0, 0)
	if err == nil {
		t.Fatal("expected ErrEnvelopeExists for duplicate category, got nil")
	}
	if !errors.Is(err, ErrEnvelopeExists) {
		t.Errorf("expected ErrEnvelopeExists, got %v", err)
	}
}

func TestBudgetManager_CreateEnvelope_ZeroPeriod_UsesDefaultPeriod(t *testing.T) {
	defaultPeriod := 7 * 24 * time.Hour
	m := newBudgetManager(BudgetConfig{DefaultPeriod: defaultPeriod})
	ctx := context.Background()

	env, err := m.CreateEnvelope(ctx, "llm", 100.0, 0)
	if err != nil {
		t.Fatalf("CreateEnvelope error: %v", err)
	}
	if env.Period != defaultPeriod {
		t.Errorf("env.Period = %v, want %v (default period)", env.Period, defaultPeriod)
	}
}

// --- BudgetManager.Check -----------------------------------------------------

func TestBudgetManager_Check_NoEnvelope_Denied(t *testing.T) {
	m := defaultBudgetManager()
	ctx := context.Background()

	result := m.Check(ctx, "nonexistent", 10.0)
	if result == nil {
		t.Fatal("Check must never return nil")
	}
	if result.Permitted {
		t.Error("expected Permitted=false when no envelope exists")
	}
	if result.Category != "nonexistent" {
		t.Errorf("result.Category = %q, want %q", result.Category, "nonexistent")
	}
}

func TestBudgetManager_Check_SufficientFunds_Permitted(t *testing.T) {
	m := defaultBudgetManager()
	ctx := context.Background()

	_, err := m.CreateEnvelope(ctx, "llm", 100.0, 0)
	if err != nil {
		t.Fatalf("CreateEnvelope error: %v", err)
	}

	result := m.Check(ctx, "llm", 50.0)
	if !result.Permitted {
		t.Errorf("expected Permitted=true (50.0 <= 100.0), got false. Reason: %s", result.Reason)
	}
	if result.Requested != 50.0 {
		t.Errorf("result.Requested = %f, want 50.0", result.Requested)
	}
}

func TestBudgetManager_Check_ExactlyAtLimit_Permitted(t *testing.T) {
	m := defaultBudgetManager()
	ctx := context.Background()

	_, err := m.CreateEnvelope(ctx, "llm", 100.0, 0)
	if err != nil {
		t.Fatalf("CreateEnvelope error: %v", err)
	}

	result := m.Check(ctx, "llm", 100.0)
	if !result.Permitted {
		t.Errorf("expected Permitted=true (exact limit), got false. Reason: %s", result.Reason)
	}
}

func TestBudgetManager_Check_ExceedsLimit_Denied(t *testing.T) {
	m := defaultBudgetManager()
	ctx := context.Background()

	_, err := m.CreateEnvelope(ctx, "llm", 100.0, 0)
	if err != nil {
		t.Fatalf("CreateEnvelope error: %v", err)
	}

	result := m.Check(ctx, "llm", 100.01)
	if result.Permitted {
		t.Error("expected Permitted=false (100.01 > 100.0), got true")
	}
}

func TestBudgetManager_Check_DoesNotMutateState(t *testing.T) {
	m := defaultBudgetManager()
	ctx := context.Background()

	_, err := m.CreateEnvelope(ctx, "llm", 100.0, 0)
	if err != nil {
		t.Fatalf("CreateEnvelope error: %v", err)
	}

	// Call Check twice — both should see the same available balance.
	r1 := m.Check(ctx, "llm", 80.0)
	r2 := m.Check(ctx, "llm", 80.0)

	if !r1.Permitted || !r2.Permitted {
		t.Error("both Check calls should be permitted since Record was not called")
	}
	if r1.Available != r2.Available {
		t.Errorf("Available changed between calls: %f vs %f — Check must be read-only", r1.Available, r2.Available)
	}
}

// --- BudgetManager.Record ----------------------------------------------------

func TestBudgetManager_Record_ReducesAvailableBalance(t *testing.T) {
	m := defaultBudgetManager()
	ctx := context.Background()

	_, err := m.CreateEnvelope(ctx, "llm", 100.0, 0)
	if err != nil {
		t.Fatalf("CreateEnvelope error: %v", err)
	}

	if err := m.Record(ctx, "llm", 30.0); err != nil {
		t.Fatalf("Record error: %v", err)
	}

	result := m.Check(ctx, "llm", 71.0)
	if result.Permitted {
		t.Errorf("expected Permitted=false after recording 30.0 (only 70.0 remains), Reason: %s", result.Reason)
	}

	result = m.Check(ctx, "llm", 70.0)
	if !result.Permitted {
		t.Errorf("expected Permitted=true (exactly 70.0 remains), Reason: %s", result.Reason)
	}
}

func TestBudgetManager_Record_NegativeAmount_ReturnsError(t *testing.T) {
	m := defaultBudgetManager()
	ctx := context.Background()

	_, err := m.CreateEnvelope(ctx, "llm", 100.0, 0)
	if err != nil {
		t.Fatalf("CreateEnvelope error: %v", err)
	}

	err = m.Record(ctx, "llm", -1.0)
	if err == nil {
		t.Fatal("expected error for negative amount, got nil")
	}
	if !errors.Is(err, ErrInvalidAmount) {
		t.Errorf("expected ErrInvalidAmount, got %v", err)
	}
}

func TestBudgetManager_Record_NoEnvelope_ReturnsError(t *testing.T) {
	m := defaultBudgetManager()
	ctx := context.Background()

	err := m.Record(ctx, "nonexistent", 10.0)
	if err == nil {
		t.Fatal("expected error for missing envelope, got nil")
	}
	if !errors.Is(err, ErrEnvelopeNotFound) {
		t.Errorf("expected ErrEnvelopeNotFound, got %v", err)
	}
}

func TestBudgetManager_Record_StrictMode_OverspendReturnsError(t *testing.T) {
	m := newBudgetManager(BudgetConfig{AllowOverspend: false})
	ctx := context.Background()

	_, err := m.CreateEnvelope(ctx, "llm", 50.0, 0)
	if err != nil {
		t.Fatalf("CreateEnvelope error: %v", err)
	}

	err = m.Record(ctx, "llm", 60.0)
	if err == nil {
		t.Fatal("expected error for overspend in strict mode, got nil")
	}
}

func TestBudgetManager_Record_PermissiveMode_OverspendSucceeds(t *testing.T) {
	m := newBudgetManager(BudgetConfig{AllowOverspend: true, DefaultPeriod: 30 * 24 * time.Hour})
	ctx := context.Background()

	_, err := m.CreateEnvelope(ctx, "llm", 50.0, 0)
	if err != nil {
		t.Fatalf("CreateEnvelope error: %v", err)
	}

	err = m.Record(ctx, "llm", 60.0)
	if err != nil {
		t.Fatalf("Record should succeed in permissive mode, got: %v", err)
	}
}

// --- Envelope.Available ------------------------------------------------------

func TestEnvelope_Available_ReturnsRemainder(t *testing.T) {
	env := Envelope{Limit: 100.0, Spent: 40.0}
	if got := env.Available(); got != 60.0 {
		t.Errorf("Available() = %f, want 60.0", got)
	}
}

func TestEnvelope_Available_ClampedAtZero(t *testing.T) {
	env := Envelope{Limit: 50.0, Spent: 75.0}
	if got := env.Available(); got != 0 {
		t.Errorf("Available() = %f, want 0 (overspent envelope should not go negative)", got)
	}
}
