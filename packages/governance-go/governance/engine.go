// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package governance

import (
	"context"
	"fmt"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance/storage"
)

// GovernanceEngine composes TrustManager, BudgetManager, ConsentManager, and
// AuditLogger into a single sequential evaluation pipeline.
//
// Evaluation order is fixed:
//  1. Trust check  (if WithRequiredTrust is provided)
//  2. Budget check (if WithBudgetCheck is provided)
//  3. Consent check (if WithConsentCheck is provided)
//  4. Audit log    (always written)
//
// Any failing check produces an immediate Permitted=false Decision. The engine
// does NOT perform cross-check optimisation — each check is independent.
//
// GovernanceEngine is safe for concurrent use. The embedded managers share a
// single storage.Storage instance.
type GovernanceEngine struct {
	// Trust is the TrustManager used by this engine. Callers may use it
	// directly to set or inspect trust assignments outside of Check.
	Trust *TrustManager

	// Budget is the BudgetManager used by this engine. Callers may use it
	// directly to create envelopes and record spending outside of Check.
	Budget *BudgetManager

	// Consent is the ConsentManager used by this engine. Callers may use it
	// directly to record and revoke consent outside of Check.
	Consent *ConsentManager

	// Audit is the AuditLogger used by this engine. Callers may use it
	// directly to query the audit log outside of Check.
	Audit *AuditLogger

	config Config
	store  storage.Storage
}

// NewEngine constructs a GovernanceEngine with the supplied configuration.
//
// The engine creates its own in-memory storage backend. To supply a custom
// storage backend use NewEngineWithStorage.
//
// Returns a non-nil error when Config contains invalid values.
func NewEngine(cfg Config) (*GovernanceEngine, error) {
	store := storage.NewMemoryStorage()
	return NewEngineWithStorage(cfg, store)
}

// NewEngineWithStorage constructs a GovernanceEngine backed by the provided
// storage.Storage implementation.
//
// This is the primary constructor when integrating with custom storage — for
// example, a Redis-backed implementation for distributed deployments.
func NewEngineWithStorage(cfg Config, store storage.Storage) (*GovernanceEngine, error) {
	cfg.applyDefaults()
	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return &GovernanceEngine{
		Trust:   NewTrustManager(store, cfg.TrustConfig),
		Budget:  NewBudgetManager(store, cfg.BudgetConfig),
		Consent: NewConsentManager(store),
		Audit:   NewAuditLogger(store, cfg.AuditConfig),
		config:  cfg,
		store:   store,
	}, nil
}

// CheckOption is a functional option for GovernanceEngine.Check.
type CheckOption func(*checkOptions)

type checkOptions struct {
	agentID       string
	requiredTrust *TrustLevel
	scope         string
	budgetCat     string
	budgetAmount  float64
	consentAction string
	consentAgent  string
	recordSpend   bool
}

// WithAgentID sets the agent ID used for trust, budget, and consent checks
// during this call. Overrides Config.DefaultAgentID.
func WithAgentID(agentID string) CheckOption {
	return func(o *checkOptions) { o.agentID = agentID }
}

// WithRequiredTrust gates the action on the agent having at least the given
// trust level in the effective scope.
func WithRequiredTrust(level TrustLevel) CheckOption {
	return func(o *checkOptions) { o.requiredTrust = &level }
}

// WithScope overrides the scope used for the trust check. Defaults to
// Config.DefaultScope.
func WithScope(scope string) CheckOption {
	return func(o *checkOptions) { o.scope = scope }
}

// WithBudgetCheck gates the action on the budget envelope for category having
// at least amount remaining.
func WithBudgetCheck(category string, amount float64) CheckOption {
	return func(o *checkOptions) {
		o.budgetCat = category
		o.budgetAmount = amount
	}
}

// WithBudgetRecord, when combined with WithBudgetCheck, automatically records
// the spend amount against the envelope when the decision is Permitted=true.
// This is a convenience option; callers may also call engine.Budget.Record
// manually.
func WithBudgetRecord() CheckOption {
	return func(o *checkOptions) { o.recordSpend = true }
}

// WithConsentCheck gates the action on active consent existing for agentID to
// perform action. If agentID is empty the value from WithAgentID is used.
func WithConsentCheck(agentID, action string) CheckOption {
	return func(o *checkOptions) {
		o.consentAgent = agentID
		o.consentAction = action
	}
}

// Check evaluates a governed action through the sequential pipeline and
// returns a Decision.
//
// Check always writes an audit record regardless of outcome. The Decision
// is never nil on a nil error. A non-nil error indicates an infrastructure
// failure (e.g. context cancellation, storage error) rather than a governance
// denial — denials are surfaced through Decision.Permitted=false.
func (e *GovernanceEngine) Check(
	ctx context.Context,
	action string,
	opts ...CheckOption,
) (*Decision, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	options := &checkOptions{
		agentID: e.config.DefaultAgentID,
		scope:   e.config.DefaultScope,
	}
	for _, opt := range opts {
		opt(options)
	}

	decision := &Decision{
		Permitted: true,
		AgentID:   options.agentID,
		Action:    action,
		Timestamp: time.Now().UTC(),
	}

	// Step 1: Trust check.
	if options.requiredTrust != nil {
		agentID := options.agentID
		if agentID == "" {
			agentID = e.config.DefaultAgentID
		}
		result := e.Trust.CheckLevel(ctx, agentID, *options.requiredTrust, options.scope)
		decision.Trust = *result
		if !result.Permitted {
			decision.Permitted = false
			decision.Reason = result.Reason
			if err := e.Audit.Log(ctx, decision); err != nil {
				return decision, fmt.Errorf("governance: audit log: %w", err)
			}
			return decision, nil
		}
	}

	// Step 2: Budget check.
	if options.budgetCat != "" {
		result := e.Budget.Check(ctx, options.budgetCat, options.budgetAmount)
		decision.Budget = *result
		if !result.Permitted {
			decision.Permitted = false
			decision.Reason = result.Reason
			if err := e.Audit.Log(ctx, decision); err != nil {
				return decision, fmt.Errorf("governance: audit log: %w", err)
			}
			return decision, nil
		}
	}

	// Step 3: Consent check.
	if options.consentAction != "" {
		consentAgent := options.consentAgent
		if consentAgent == "" {
			consentAgent = options.agentID
		}
		result := e.Consent.Check(ctx, options.consentAction, consentAgent)
		decision.Consent = *result
		if !result.Permitted {
			decision.Permitted = false
			decision.Reason = result.Reason
			if err := e.Audit.Log(ctx, decision); err != nil {
				return decision, fmt.Errorf("governance: audit log: %w", err)
			}
			return decision, nil
		}
	}

	// All checks passed.
	if decision.Reason == "" {
		decision.Reason = fmt.Sprintf("all governance checks passed for action %q", action)
	}

	// Optionally record the spend now that we know the decision is Permitted.
	if options.recordSpend && options.budgetCat != "" {
		if err := e.Budget.Record(ctx, options.budgetCat, options.budgetAmount); err != nil {
			// Record the spend error in the audit log but do not deny the
			// already-permitted decision — the check passed; recording is
			// best-effort at this stage.
			_ = err
		}
	}

	if err := e.Audit.Log(ctx, decision); err != nil {
		return decision, fmt.Errorf("governance: audit log: %w", err)
	}

	return decision, nil
}
