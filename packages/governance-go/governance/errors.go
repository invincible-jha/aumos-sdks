// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package governance

import (
	"errors"
	"fmt"
)

// Sentinel errors that callers can test with errors.Is.
var (
	// ErrAgentNotFound is returned when an operation references an agent ID
	// that has no record in the store.
	ErrAgentNotFound = errors.New("governance: agent not found")

	// ErrEnvelopeNotFound is returned when a budget operation references a
	// category that has no envelope in the store.
	ErrEnvelopeNotFound = errors.New("governance: envelope not found")

	// ErrEnvelopeExists is returned when CreateEnvelope is called for a
	// category that already has an envelope.
	ErrEnvelopeExists = errors.New("governance: envelope already exists")

	// ErrConsentNotFound is returned when a consent operation references an
	// (agentID, action) pair that has no recorded consent.
	ErrConsentNotFound = errors.New("governance: consent record not found")

	// ErrAssignmentExpired is returned when a trust assignment is found but
	// its ExpiresAt timestamp has passed.
	ErrAssignmentExpired = errors.New("governance: trust assignment has expired")

	// ErrInvalidTrustLevel is returned when a TrustLevel value is outside
	// the valid range [TrustObserver, TrustAutonomous].
	ErrInvalidTrustLevel = errors.New("governance: invalid trust level")

	// ErrInvalidAmount is returned when a budget amount is negative or
	// otherwise invalid.
	ErrInvalidAmount = errors.New("governance: invalid budget amount")
)

// TrustDeniedError is returned (wrapped inside a Decision) when a trust check
// fails. It carries structured context about the failure.
type TrustDeniedError struct {
	AgentID       string
	CurrentLevel  TrustLevel
	RequiredLevel TrustLevel
}

func (e *TrustDeniedError) Error() string {
	return fmt.Sprintf(
		"governance: trust denied for agent %q: current=%s required=%s",
		e.AgentID,
		TrustLevelName(e.CurrentLevel),
		TrustLevelName(e.RequiredLevel),
	)
}

// BudgetDeniedError is returned (wrapped inside a Decision) when a budget
// check fails because the envelope has insufficient funds.
type BudgetDeniedError struct {
	Category  string
	Available float64
	Requested float64
}

func (e *BudgetDeniedError) Error() string {
	return fmt.Sprintf(
		"governance: budget denied for category %q: available=%.4f requested=%.4f",
		e.Category,
		e.Available,
		e.Requested,
	)
}

// ConsentDeniedError is returned (wrapped inside a Decision) when a consent
// check fails because no active consent record was found.
type ConsentDeniedError struct {
	AgentID string
	Action  string
}

func (e *ConsentDeniedError) Error() string {
	return fmt.Sprintf(
		"governance: consent denied for agent %q action %q",
		e.AgentID,
		e.Action,
	)
}

// ConfigError is returned by NewEngine when the supplied Config is invalid.
type ConfigError struct {
	Field   string
	Message string
}

func (e *ConfigError) Error() string {
	return fmt.Sprintf("governance: config error for field %q: %s", e.Field, e.Message)
}
