// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package governance

import "time"

// Config holds all configuration for a GovernanceEngine instance.
// All fields are optional; zero values produce sensible defaults.
type Config struct {
	// DefaultScope is used for trust checks when no explicit scope is
	// provided via CheckOption. Defaults to "default".
	DefaultScope string

	// DefaultAgentID is used for trust and consent checks when no explicit
	// agent ID is provided via CheckOption. An empty string disables the
	// default, requiring callers to always supply an agent ID.
	DefaultAgentID string

	// TrustConfig holds trust-manager-specific configuration.
	TrustConfig TrustConfig

	// BudgetConfig holds budget-manager-specific configuration.
	BudgetConfig BudgetConfig

	// AuditConfig holds audit-logger-specific configuration.
	AuditConfig AuditConfig
}

// TrustConfig holds configuration for the TrustManager.
type TrustConfig struct {
	// DefaultLevel is the trust level assigned to agents that have no
	// explicit assignment. Defaults to TrustObserver.
	DefaultLevel TrustLevel
}

// BudgetConfig holds configuration for the BudgetManager.
type BudgetConfig struct {
	// AllowOverspend, if true, permits budget.Record calls that would push
	// Spent above Limit. The Check result still returns Permitted=false, but
	// Record does not return an error. Defaults to false (strict mode).
	AllowOverspend bool

	// DefaultPeriod is used by CreateEnvelope when no period is specified.
	// Defaults to 30 days.
	DefaultPeriod time.Duration
}

// AuditConfig holds configuration for the AuditLogger.
type AuditConfig struct {
	// MaxRecords caps the number of records held in the in-memory store.
	// When the cap is reached the oldest records are evicted. Zero means
	// no cap (unbounded).
	MaxRecords int
}

// validate returns a non-nil error when the Config contains invalid values.
func (c *Config) validate() error {
	if c.TrustConfig.DefaultLevel < TrustObserver || c.TrustConfig.DefaultLevel > TrustAutonomous {
		return &ConfigError{
			Field:   "TrustConfig.DefaultLevel",
			Message: "must be in range [0, 5]",
		}
	}
	if c.AuditConfig.MaxRecords < 0 {
		return &ConfigError{
			Field:   "AuditConfig.MaxRecords",
			Message: "must be >= 0",
		}
	}
	return nil
}

// applyDefaults fills in zero values with their defaults.
func (c *Config) applyDefaults() {
	if c.DefaultScope == "" {
		c.DefaultScope = "default"
	}
	if c.BudgetConfig.DefaultPeriod == 0 {
		c.BudgetConfig.DefaultPeriod = 30 * 24 * time.Hour
	}
}
