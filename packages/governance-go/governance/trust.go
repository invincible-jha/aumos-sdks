// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package governance

import (
	"context"
	"fmt"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance/storage"
)

// TrustManagerIface is the interface for managing agent trust levels.
// Trust changes are manual only — there is no automatic progression.
//
// All methods are safe for concurrent use.
type TrustManagerIface interface {
	// SetLevel manually assigns a trust level to an agent within a scope.
	// The assignment is durable for the lifetime of the storage backend.
	SetLevel(ctx context.Context, agentID string, level TrustLevel, scope string, opts ...AssignOption) (*TrustAssignment, error)

	// GetLevel returns the current trust level for an agent in a scope.
	// When no assignment exists, the configured default level is returned.
	GetLevel(ctx context.Context, agentID, scope string) TrustLevel

	// CheckLevel reports whether agentID meets the required trust level in
	// the given scope. It never returns an error — all failure modes are
	// expressed through TrustResult.Permitted being false.
	CheckLevel(ctx context.Context, agentID string, required TrustLevel, scope string) *TrustResult
}

// AssignOption is a functional option for TrustManager.SetLevel.
type AssignOption func(*assignOptions)

type assignOptions struct {
	assignedBy string
	expiresAt  *time.Time
}

// WithAssignedBy records the identity of the caller that made the assignment
// (e.g. "owner", "policy", "admin"). Defaults to "owner".
func WithAssignedBy(assignedBy string) AssignOption {
	return func(o *assignOptions) {
		o.assignedBy = assignedBy
	}
}

// WithExpiry sets an expiry time for the trust assignment. After this time,
// GetLevel and CheckLevel will fall back to the configured default level.
func WithExpiry(expiresAt time.Time) AssignOption {
	return func(o *assignOptions) {
		o.expiresAt = &expiresAt
	}
}

// TrustManager is the default implementation of TrustManagerIface.
// It stores assignments in the provided storage.Storage backend.
type TrustManager struct {
	store  storage.Storage
	config TrustConfig
}

// NewTrustManager constructs a TrustManager backed by the given storage.
func NewTrustManager(store storage.Storage, cfg TrustConfig) *TrustManager {
	return &TrustManager{store: store, config: cfg}
}

// SetLevel manually assigns a trust level to an agent within a scope.
//
// The assignment is stored immediately and takes effect on the next call to
// GetLevel or CheckLevel. Trust changes are always operator-initiated.
func (m *TrustManager) SetLevel(
	ctx context.Context,
	agentID string,
	level TrustLevel,
	scope string,
	opts ...AssignOption,
) (*TrustAssignment, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if level < TrustObserver || level > TrustAutonomous {
		return nil, fmt.Errorf("%w: value %d", ErrInvalidTrustLevel, level)
	}
	if agentID == "" {
		return nil, fmt.Errorf("governance: agentID must not be empty")
	}
	if scope == "" {
		scope = "default"
	}

	options := &assignOptions{assignedBy: "owner"}
	for _, opt := range opts {
		opt(options)
	}

	assignment := TrustAssignment{
		AgentID:    agentID,
		Level:      level,
		Scope:      scope,
		AssignedAt: time.Now().UTC(),
		ExpiresAt:  options.expiresAt,
		AssignedBy: options.assignedBy,
	}

	m.store.SetTrust(agentID, scope, storage.TrustAssignment{
		AgentID:    assignment.AgentID,
		Level:      int(assignment.Level),
		Scope:      assignment.Scope,
		AssignedAt: assignment.AssignedAt,
		ExpiresAt:  assignment.ExpiresAt,
		AssignedBy: assignment.AssignedBy,
	})

	return &assignment, nil
}

// GetLevel returns the trust level for agentID in scope. If no assignment
// exists, or the existing assignment has expired, the configured default level
// is returned.
func (m *TrustManager) GetLevel(ctx context.Context, agentID, scope string) TrustLevel {
	if scope == "" {
		scope = "default"
	}
	raw, ok := m.store.GetTrust(agentID, scope)
	if !ok {
		return m.config.DefaultLevel
	}
	if raw.ExpiresAt != nil && time.Now().UTC().After(*raw.ExpiresAt) {
		return m.config.DefaultLevel
	}
	return TrustLevel(raw.Level)
}

// CheckLevel reports whether agentID meets required trust in scope.
// The result is always non-nil; errors are expressed via Permitted=false.
func (m *TrustManager) CheckLevel(
	ctx context.Context,
	agentID string,
	required TrustLevel,
	scope string,
) *TrustResult {
	current := m.GetLevel(ctx, agentID, scope)

	if current >= required {
		return &TrustResult{
			Permitted:     true,
			CurrentLevel:  current,
			RequiredLevel: required,
			Reason: fmt.Sprintf(
				"agent %q has trust %s which meets required %s in scope %q",
				agentID,
				TrustLevelName(current),
				TrustLevelName(required),
				scope,
			),
		}
	}

	return &TrustResult{
		Permitted:     false,
		CurrentLevel:  current,
		RequiredLevel: required,
		Reason: fmt.Sprintf(
			"agent %q has trust %s which is below required %s in scope %q",
			agentID,
			TrustLevelName(current),
			TrustLevelName(required),
			scope,
		),
	}
}
