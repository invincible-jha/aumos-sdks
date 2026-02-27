// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package admission

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// budgetLimitPattern validates the budget-limit annotation format.
// Accepted form: one or more digits, followed by exactly three uppercase
// ASCII letters (ISO 4217 currency code), e.g. "100USD", "2500EUR".
var budgetLimitPattern = regexp.MustCompile(`^\d+[A-Z]{3}$`)

// defaultRequiredAnnotations is the full set of governance annotation keys
// that must be present when WebhookConfig.RequiredAnnotations is empty.
var defaultRequiredAnnotations = []string{
	AnnotationTrustLevel,
	AnnotationBudgetLimit,
	AnnotationConsentPolicy,
	AnnotationAuditEnabled,
}

// ValidateGovernanceAnnotations inspects the raw annotation map from a Pod's
// ObjectMeta and returns a ValidationResult indicating whether the Pod meets
// AumOS governance requirements.
//
// Validation is purely static:
//   - Required annotation keys are present (determined by config.RequiredAnnotations).
//   - aumos.ai/trust-level is a decimal integer in the range [0, 5].
//   - aumos.ai/budget-limit matches the pattern <digits><3-letter-currency>.
//   - aumos.ai/consent-policy is one of the ValidConsentPolicies values.
//   - aumos.ai/audit-enabled is the string "true" or "false".
//
// When all checks pass, Allowed is true and Warnings contains any advisory
// messages (currently none — reserved for future use). When any check fails,
// Allowed is false and Reason identifies the first failing annotation.
func ValidateGovernanceAnnotations(
	annotations map[string]string,
	config WebhookConfig,
) ValidationResult {
	required := config.RequiredAnnotations
	if len(required) == 0 {
		required = defaultRequiredAnnotations
	}

	// Phase 1: presence check — fail fast on missing required keys.
	for _, key := range required {
		if _, present := annotations[key]; !present {
			return ValidationResult{
				Allowed: false,
				Reason:  fmt.Sprintf("missing required governance annotation: %q", key),
			}
		}
	}

	// Phase 2: format/value checks for each annotation that is present.
	// We only validate keys that are actually present; if a key was not in
	// required and is absent, it is simply skipped.

	if raw, present := annotations[AnnotationTrustLevel]; present {
		if result := validateTrustLevel(raw); !result.Allowed {
			return result
		}
	}

	if raw, present := annotations[AnnotationBudgetLimit]; present {
		if result := validateBudgetLimit(raw); !result.Allowed {
			return result
		}
	}

	if raw, present := annotations[AnnotationConsentPolicy]; present {
		if result := validateConsentPolicy(raw); !result.Allowed {
			return result
		}
	}

	if raw, present := annotations[AnnotationAuditEnabled]; present {
		if result := validateAuditEnabled(raw); !result.Allowed {
			return result
		}
	}

	return ValidationResult{
		Allowed: true,
		Reason:  "all governance annotations are present and valid",
	}
}

// validateTrustLevel checks that the raw annotation value is a decimal
// integer in the closed range [0, 5]. Trust levels map to the six-level
// AumOS trust hierarchy (Observer=0 through Autonomous=5).
func validateTrustLevel(raw string) ValidationResult {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ValidationResult{
			Allowed: false,
			Reason:  fmt.Sprintf("annotation %q must not be empty", AnnotationTrustLevel),
		}
	}

	level, err := strconv.Atoi(raw)
	if err != nil {
		return ValidationResult{
			Allowed: false,
			Reason: fmt.Sprintf(
				"annotation %q value %q is not a valid integer: %s",
				AnnotationTrustLevel, raw, err.Error(),
			),
		}
	}

	if level < 0 || level > 5 {
		return ValidationResult{
			Allowed: false,
			Reason: fmt.Sprintf(
				"annotation %q value %d is out of range: must be 0-5 (Observer through Autonomous)",
				AnnotationTrustLevel, level,
			),
		}
	}

	return ValidationResult{Allowed: true}
}

// validateBudgetLimit checks that the raw annotation value matches the
// pattern <positive-integer><3-uppercase-letters>, e.g. "100USD".
func validateBudgetLimit(raw string) ValidationResult {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ValidationResult{
			Allowed: false,
			Reason:  fmt.Sprintf("annotation %q must not be empty", AnnotationBudgetLimit),
		}
	}

	if !budgetLimitPattern.MatchString(raw) {
		return ValidationResult{
			Allowed: false,
			Reason: fmt.Sprintf(
				"annotation %q value %q has invalid format: expected <amount><CURRENCY> e.g. \"100USD\"",
				AnnotationBudgetLimit, raw,
			),
		}
	}

	// Extract the numeric prefix and verify it is a positive integer.
	currencyOffset := len(raw) - 3
	amountStr := raw[:currencyOffset]
	amount, err := strconv.ParseUint(amountStr, 10, 64)
	if err != nil || amount == 0 {
		return ValidationResult{
			Allowed: false,
			Reason: fmt.Sprintf(
				"annotation %q value %q: amount %q must be a positive integer",
				AnnotationBudgetLimit, raw, amountStr,
			),
		}
	}

	return ValidationResult{Allowed: true}
}

// validateConsentPolicy checks that the raw annotation value is one of the
// closed set defined in ValidConsentPolicies.
func validateConsentPolicy(raw string) ValidationResult {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ValidationResult{
			Allowed: false,
			Reason:  fmt.Sprintf("annotation %q must not be empty", AnnotationConsentPolicy),
		}
	}

	for _, valid := range ValidConsentPolicies {
		if raw == valid {
			return ValidationResult{Allowed: true}
		}
	}

	return ValidationResult{
		Allowed: false,
		Reason: fmt.Sprintf(
			"annotation %q value %q is not a recognized consent policy: must be one of [%s]",
			AnnotationConsentPolicy, raw, strings.Join(ValidConsentPolicies, ", "),
		),
	}
}

// validateAuditEnabled checks that the raw annotation value is exactly
// "true" or "false" (case-sensitive). Kubernetes itself represents booleans
// as lowercase string annotations.
func validateAuditEnabled(raw string) ValidationResult {
	raw = strings.TrimSpace(raw)
	if raw == "true" || raw == "false" {
		return ValidationResult{Allowed: true}
	}

	return ValidationResult{
		Allowed: false,
		Reason: fmt.Sprintf(
			"annotation %q value %q is invalid: must be \"true\" or \"false\"",
			AnnotationAuditEnabled, raw,
		),
	}
}
