// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// LoadConfigFromEnv builds a GovernanceConfig from AUMOS_-prefixed environment
// variables. Unset variables fall back to the values returned by
// [DefaultConfig].
//
// # Environment Variables
//
//	AUMOS_TRUST_THRESHOLD   integer 0–5  (default 2)
//	AUMOS_BUDGET_LIMIT      float ≥ 0    (default 1000.0)
//	AUMOS_AUDIT_LEVEL       string       (default "standard")
//	AUMOS_CONSENT_REQUIRED  boolean      (default false)
//
// Boolean values accept: true/false, 1/0, yes/no, on/off (case-insensitive).
//
// Returns a non-nil error when any variable is present but cannot be parsed,
// or when a value is outside the permitted range.
func LoadConfigFromEnv() (*GovernanceConfig, error) {
	cfg := DefaultConfig()

	if raw, ok := lookupEnv("AUMOS_TRUST_THRESHOLD"); ok {
		n, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil {
			return nil, fmt.Errorf(
				"governance/config: AUMOS_TRUST_THRESHOLD %q is not an integer: %w", raw, err,
			)
		}
		if n < 0 || n > 5 {
			return nil, fmt.Errorf(
				"governance/config: AUMOS_TRUST_THRESHOLD %d out of range [0, 5]", n,
			)
		}
		cfg.TrustThreshold = n
	}

	if raw, ok := lookupEnv("AUMOS_BUDGET_LIMIT"); ok {
		f, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
		if err != nil {
			return nil, fmt.Errorf(
				"governance/config: AUMOS_BUDGET_LIMIT %q is not a float: %w", raw, err,
			)
		}
		if f < 0 {
			return nil, fmt.Errorf(
				"governance/config: AUMOS_BUDGET_LIMIT %.2f must be >= 0", f,
			)
		}
		cfg.BudgetLimit = f
	}

	if raw, ok := lookupEnv("AUMOS_AUDIT_LEVEL"); ok {
		level := AuditLevel(strings.ToLower(strings.TrimSpace(raw)))
		switch level {
		case AuditLevelMinimal, AuditLevelStandard, AuditLevelDetailed:
			cfg.AuditLevel = level
		default:
			return nil, fmt.Errorf(
				"governance/config: AUMOS_AUDIT_LEVEL %q invalid; must be one of: minimal, standard, detailed",
				raw,
			)
		}
	}

	if raw, ok := lookupEnv("AUMOS_CONSENT_REQUIRED"); ok {
		b, err := parseBool(raw)
		if err != nil {
			return nil, fmt.Errorf(
				"governance/config: AUMOS_CONSENT_REQUIRED %q: %w", raw, err,
			)
		}
		cfg.ConsentRequired = b
	}

	return cfg, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// lookupEnv returns (value, true) when the variable is set and non-empty,
// or ("", false) otherwise.
func lookupEnv(key string) (string, bool) {
	value, set := os.LookupEnv(key)
	if !set || strings.TrimSpace(value) == "" {
		return "", false
	}
	return value, true
}

// parseBool parses common boolean representations used in environment
// variables: true/false, 1/0, yes/no, on/off (case-insensitive).
func parseBool(s string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "true", "1", "yes", "on":
		return true, nil
	case "false", "0", "no", "off":
		return false, nil
	default:
		return false, fmt.Errorf(
			"cannot parse %q as boolean; expected one of: true/false, 1/0, yes/no, on/off", s,
		)
	}
}
