// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

// Package config provides a serialisation-friendly GovernanceConfig struct and
// loaders for reading configuration from JSON/YAML files or AUMOS_-prefixed
// environment variables.
//
// # Typical Usage
//
//	cfg, err := config.LoadConfig("/etc/aumos/governance.yaml")
//	if err != nil {
//	    log.Fatal(err)
//	}
//	fmt.Printf("TrustThreshold: %d, BudgetLimit: %.2f\n",
//	    cfg.TrustThreshold, cfg.BudgetLimit)
//
// # Config Fields
//
// See [GovernanceConfig] for field documentation.
package config

// AuditLevel controls the verbosity of governance audit records.
type AuditLevel string

const (
	// AuditLevelMinimal records only the final decision outcome.
	AuditLevelMinimal AuditLevel = "minimal"
	// AuditLevelStandard records the outcome, agent, action, and key gate results.
	AuditLevelStandard AuditLevel = "standard"
	// AuditLevelDetailed records all gate inputs, outputs, and full context.
	AuditLevelDetailed AuditLevel = "detailed"
)

// GovernanceConfig is the flat, serialisation-friendly configuration struct
// for a GovernanceEngine instance.
//
// Tags:
//   - json:"..." — used by encoding/json (JSON files).
//   - yaml:"..." — used by gopkg.in/yaml.v3 (YAML files).
type GovernanceConfig struct {
	// TrustThreshold is the minimum trust level (0–5) required for actions
	// not covered by an explicit governance rule. Corresponds to the
	// TrustLevel constants in the governance package.
	// Default: 2 (TrustSuggest).
	TrustThreshold int `json:"trust_threshold" yaml:"trust_threshold"`

	// BudgetLimit is the default per-agent budget cap in the engine's
	// configured cost unit.
	// Default: 1000.0.
	BudgetLimit float64 `json:"budget_limit" yaml:"budget_limit"`

	// AuditLevel controls how much detail is recorded in each audit entry.
	// Valid values: "minimal", "standard" (default), "detailed".
	AuditLevel AuditLevel `json:"audit_level" yaml:"audit_level"`

	// ConsentRequired, when true, enforces the consent gate for all actions
	// regardless of whether an explicit consent check option is provided.
	// Default: false.
	ConsentRequired bool `json:"consent_required" yaml:"consent_required"`
}

// DefaultConfig returns a GovernanceConfig populated with sensible defaults.
func DefaultConfig() *GovernanceConfig {
	return &GovernanceConfig{
		TrustThreshold:  2,
		BudgetLimit:     1000.0,
		AuditLevel:      AuditLevelStandard,
		ConsentRequired: false,
	}
}
