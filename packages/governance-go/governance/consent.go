// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package governance

import (
	"context"
	"fmt"

	"github.com/aumos-ai/aumos-sdks/go/governance/storage"
)

// ConsentManagerIface is the interface for recording and checking consent
// grants. Consent is always operator-granted; there is no proactive or
// automatic consent suggestion.
//
// All methods are safe for concurrent use.
type ConsentManagerIface interface {
	// Record grants consent for agentID to perform action. The grant is
	// associated with grantedBy for auditability.
	Record(ctx context.Context, agentID, action, grantedBy string) error

	// Check reports whether active consent exists for agentID to perform
	// action. It never returns an error — all outcomes are in ConsentResult.
	Check(ctx context.Context, action, agentID string) *ConsentResult

	// Revoke withdraws a previously recorded consent grant.
	// Returns ErrConsentNotFound if no grant exists for the pair.
	Revoke(ctx context.Context, agentID, action string) error
}

// ConsentManager is the default implementation of ConsentManagerIface.
type ConsentManager struct {
	store storage.Storage
}

// NewConsentManager constructs a ConsentManager backed by the given storage.
func NewConsentManager(store storage.Storage) *ConsentManager {
	return &ConsentManager{store: store}
}

// Record grants consent for agentID to perform action.
//
// If consent was previously revoked, Record reinstates it. The grantedBy
// parameter identifies who or what authorised the grant (e.g. "admin",
// "policy", "user:alice").
func (m *ConsentManager) Record(ctx context.Context, agentID, action, grantedBy string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if agentID == "" {
		return fmt.Errorf("governance: agentID must not be empty")
	}
	if action == "" {
		return fmt.Errorf("governance: action must not be empty")
	}
	if grantedBy == "" {
		return fmt.Errorf("governance: grantedBy must not be empty")
	}

	m.store.SetConsent(agentID, action, true)
	return nil
}

// Check reports whether active consent exists for agentID to perform action.
//
// Consent is considered absent when no record exists or when it was revoked.
// The result is always non-nil.
func (m *ConsentManager) Check(ctx context.Context, action, agentID string) *ConsentResult {
	granted, err := m.store.GetConsent(agentID, action)
	if err != nil || !granted {
		return &ConsentResult{
			Permitted: false,
			Reason:    fmt.Sprintf("no active consent for agent %q to perform %q", agentID, action),
		}
	}
	return &ConsentResult{
		Permitted: true,
		Reason:    fmt.Sprintf("consent granted for agent %q to perform %q", agentID, action),
	}
}

// Revoke withdraws consent for agentID to perform action.
//
// Returns ErrConsentNotFound if no grant exists for the (agentID, action)
// pair. A second call to Revoke for the same pair also returns
// ErrConsentNotFound.
func (m *ConsentManager) Revoke(ctx context.Context, agentID, action string) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	granted, err := m.store.GetConsent(agentID, action)
	if err != nil || !granted {
		return fmt.Errorf("%w: agent %q action %q", ErrConsentNotFound, agentID, action)
	}

	m.store.SetConsent(agentID, action, false)
	return nil
}
