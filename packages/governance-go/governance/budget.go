// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package governance

import (
	"context"
	"fmt"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance/storage"
)

// BudgetManagerIface is the interface for managing static spending envelopes.
// All allocations are set once at creation time and do not change automatically.
//
// All methods are safe for concurrent use.
type BudgetManagerIface interface {
	// CreateEnvelope creates a new bounded spending envelope for a category.
	// Returns ErrEnvelopeExists if the category is already registered.
	CreateEnvelope(ctx context.Context, category string, limit float64, period time.Duration) (*Envelope, error)

	// Check reports whether amount can be spent from the category's envelope
	// without exceeding its limit. It does not modify any state.
	Check(ctx context.Context, category string, amount float64) *BudgetResult

	// Record records a spend of amount against the category's envelope.
	// Returns ErrEnvelopeNotFound if the category has no envelope.
	// Returns ErrInvalidAmount if amount is negative.
	Record(ctx context.Context, category string, amount float64) error
}

// BudgetManager is the default implementation of BudgetManagerIface.
type BudgetManager struct {
	store  storage.Storage
	config BudgetConfig
}

// NewBudgetManager constructs a BudgetManager backed by the given storage.
func NewBudgetManager(store storage.Storage, cfg BudgetConfig) *BudgetManager {
	return &BudgetManager{store: store, config: cfg}
}

// CreateEnvelope creates a new bounded spending envelope for a category.
//
// The period determines how long the Limit applies before it resets. Calling
// CreateEnvelope for a category that already exists returns ErrEnvelopeExists.
func (m *BudgetManager) CreateEnvelope(
	ctx context.Context,
	category string,
	limit float64,
	period time.Duration,
) (*Envelope, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if category == "" {
		return nil, fmt.Errorf("governance: category must not be empty")
	}
	if limit < 0 {
		return nil, fmt.Errorf("%w: limit must be >= 0", ErrInvalidAmount)
	}
	if period == 0 {
		period = m.config.DefaultPeriod
	}

	if _, exists := m.store.GetEnvelope(category); exists {
		return nil, fmt.Errorf("%w: category %q", ErrEnvelopeExists, category)
	}

	now := time.Now().UTC()
	env := storage.Envelope{
		Category: category,
		Limit:    limit,
		Spent:    0,
		Period:   period,
		StartsAt: now,
	}
	m.store.SetEnvelope(category, env)

	return &Envelope{
		Category: env.Category,
		Limit:    env.Limit,
		Spent:    env.Spent,
		Period:   env.Period,
		StartsAt: env.StartsAt,
	}, nil
}

// Check reports whether amount can be spent from the category's envelope.
//
// It never mutates state — it is safe to call multiple times speculatively.
// If the category has no envelope, Permitted is false.
func (m *BudgetManager) Check(ctx context.Context, category string, amount float64) *BudgetResult {
	raw, ok := m.store.GetEnvelope(category)
	if !ok {
		return &BudgetResult{
			Permitted: false,
			Available: 0,
			Requested: amount,
			Category:  category,
			Reason:    fmt.Sprintf("no budget envelope found for category %q", category),
		}
	}

	// Reset envelope if its period has elapsed.
	raw = m.resetIfExpired(category, raw)

	available := raw.Limit - raw.Spent
	if available < 0 {
		available = 0
	}

	if amount <= available {
		return &BudgetResult{
			Permitted: true,
			Available: available,
			Requested: amount,
			Category:  category,
			Reason: fmt.Sprintf(
				"budget check passed for %q: requested=%.4f available=%.4f",
				category, amount, available,
			),
		}
	}

	return &BudgetResult{
		Permitted: false,
		Available: available,
		Requested: amount,
		Category:  category,
		Reason: fmt.Sprintf(
			"budget check failed for %q: requested=%.4f exceeds available=%.4f",
			category, amount, available,
		),
	}
}

// Record records a spend of amount against the category's envelope.
//
// In strict mode (AllowOverspend=false), Record returns an error if the spend
// would push Spent above Limit. In permissive mode it records the overspend
// and returns nil.
func (m *BudgetManager) Record(ctx context.Context, category string, amount float64) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if amount < 0 {
		return fmt.Errorf("%w: amount must be >= 0, got %.4f", ErrInvalidAmount, amount)
	}

	raw, ok := m.store.GetEnvelope(category)
	if !ok {
		return fmt.Errorf("%w: category %q", ErrEnvelopeNotFound, category)
	}

	raw = m.resetIfExpired(category, raw)

	if !m.config.AllowOverspend {
		available := raw.Limit - raw.Spent
		if amount > available {
			return &BudgetDeniedError{
				Category:  category,
				Available: available,
				Requested: amount,
			}
		}
	}

	raw.Spent += amount
	m.store.SetEnvelope(category, raw)
	return nil
}

// resetIfExpired checks whether the envelope's period has elapsed and, if so,
// resets Spent to zero and advances StartsAt. It writes the updated envelope
// back to storage and returns the refreshed value.
func (m *BudgetManager) resetIfExpired(category string, raw storage.Envelope) storage.Envelope {
	if raw.Period == 0 {
		return raw
	}
	periodEnd := raw.StartsAt.Add(raw.Period)
	if time.Now().UTC().After(periodEnd) {
		raw.Spent = 0
		raw.StartsAt = time.Now().UTC()
		m.store.SetEnvelope(category, raw)
	}
	return raw
}
