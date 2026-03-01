// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LoadConfig reads a GovernanceConfig from a JSON or YAML file.
//
// The file format is determined by the file extension:
//   - .json     — parsed with encoding/json
//   - .yaml, .yml — parsed with a pure-stdlib YAML subset (see parseYAML)
//
// Any other extension defaults to JSON.
//
// Missing fields default to the values returned by [DefaultConfig].
//
// Returns a non-nil error when the file cannot be read or when the content
// cannot be decoded into a [GovernanceConfig].
func LoadConfig(path string) (*GovernanceConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("governance/config: read file %q: %w", path, err)
	}

	cfg := DefaultConfig()

	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".yaml", ".yml":
		if err := parseYAMLInto(data, cfg); err != nil {
			return nil, fmt.Errorf("governance/config: parse YAML %q: %w", path, err)
		}
	default:
		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("governance/config: parse JSON %q: %w", path, err)
		}
	}

	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("governance/config: invalid config in %q: %w", path, err)
	}

	return cfg, nil
}

// validate checks that the loaded config values are within permitted ranges.
func (c *GovernanceConfig) validate() error {
	if c.TrustThreshold < 0 || c.TrustThreshold > 5 {
		return fmt.Errorf(
			"trust_threshold %d out of range [0, 5]", c.TrustThreshold,
		)
	}
	if c.BudgetLimit < 0 {
		return fmt.Errorf("budget_limit %.2f must be >= 0", c.BudgetLimit)
	}
	switch c.AuditLevel {
	case AuditLevelMinimal, AuditLevelStandard, AuditLevelDetailed:
		// valid
	case "":
		c.AuditLevel = AuditLevelStandard
	default:
		return fmt.Errorf(
			"audit_level %q invalid; must be one of: minimal, standard, detailed",
			c.AuditLevel,
		)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Minimal YAML parser
//
// The governance module only depends on the Go standard library.  Rather than
// import gopkg.in/yaml.v3, we provide a minimal line-by-line parser that
// handles the flat key: value structure of GovernanceConfig YAML files.
//
// Supported syntax (subset of YAML 1.2):
//   - Scalar key: value pairs, one per line.
//   - Lines beginning with '#' are comments (ignored).
//   - Values are unquoted scalars, single-quoted, or double-quoted strings.
// ---------------------------------------------------------------------------

func parseYAMLInto(data []byte, cfg *GovernanceConfig) error {
	lines := strings.Split(string(data), "\n")
	for lineNum, line := range lines {
		// Strip comments and surrounding whitespace.
		if idx := strings.Index(line, "#"); idx >= 0 {
			line = line[:idx]
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		colonIdx := strings.Index(line, ":")
		if colonIdx < 0 {
			return fmt.Errorf("line %d: expected key: value, got %q", lineNum+1, line)
		}

		key := strings.TrimSpace(line[:colonIdx])
		rawValue := strings.TrimSpace(line[colonIdx+1:])
		value := stripQuotes(rawValue)

		if err := applyYAMLField(cfg, key, value); err != nil {
			return fmt.Errorf("line %d: key %q: %w", lineNum+1, key, err)
		}
	}
	return nil
}

// stripQuotes removes surrounding single or double quotes from a YAML scalar.
func stripQuotes(s string) string {
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') ||
			(s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	return s
}

// applyYAMLField maps a parsed YAML key/value pair to a GovernanceConfig field.
func applyYAMLField(cfg *GovernanceConfig, key, value string) error {
	switch key {
	case "trust_threshold":
		var n int
		if _, err := fmt.Sscanf(value, "%d", &n); err != nil {
			return fmt.Errorf("cannot parse %q as integer: %w", value, err)
		}
		cfg.TrustThreshold = n
	case "budget_limit":
		var f float64
		if _, err := fmt.Sscanf(value, "%g", &f); err != nil {
			return fmt.Errorf("cannot parse %q as float: %w", value, err)
		}
		cfg.BudgetLimit = f
	case "audit_level":
		cfg.AuditLevel = AuditLevel(value)
	case "consent_required":
		switch strings.ToLower(value) {
		case "true", "yes", "1", "on":
			cfg.ConsentRequired = true
		case "false", "no", "0", "off":
			cfg.ConsentRequired = false
		default:
			return fmt.Errorf("cannot parse %q as boolean", value)
		}
	default:
		// Unknown keys are silently ignored for forward compatibility.
	}
	return nil
}
