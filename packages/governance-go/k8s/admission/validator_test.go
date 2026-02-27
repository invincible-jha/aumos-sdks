// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package admission_test

import (
	"strings"
	"testing"

	"github.com/aumos-ai/aumos-sdks/go/governance/k8s/admission"
)

// validAnnotations returns a fully populated annotation map that passes all
// four governance checks. Individual tests override specific keys to exercise
// failure paths.
func validAnnotations() map[string]string {
	return map[string]string{
		admission.AnnotationTrustLevel:    "2",
		admission.AnnotationBudgetLimit:   "500USD",
		admission.AnnotationConsentPolicy: "explicit",
		admission.AnnotationAuditEnabled:  "true",
	}
}

// defaultConfig returns a WebhookConfig with all four required annotations
// (equivalent to leaving RequiredAnnotations empty, but explicit for tests).
func defaultConfig() admission.WebhookConfig {
	return admission.WebhookConfig{
		RequiredAnnotations: []string{
			admission.AnnotationTrustLevel,
			admission.AnnotationBudgetLimit,
			admission.AnnotationConsentPolicy,
			admission.AnnotationAuditEnabled,
		},
	}
}

func TestValidateGovernanceAnnotations_AllValid(t *testing.T) {
	result := admission.ValidateGovernanceAnnotations(validAnnotations(), defaultConfig())
	if !result.Allowed {
		t.Fatalf("expected allowed=true, got reason: %s", result.Reason)
	}
}

func TestValidateGovernanceAnnotations_MissingAnnotations(t *testing.T) {
	tests := []struct {
		name       string
		removeKey  string
		wantSubstr string
	}{
		{
			name:       "missing trust-level",
			removeKey:  admission.AnnotationTrustLevel,
			wantSubstr: admission.AnnotationTrustLevel,
		},
		{
			name:       "missing budget-limit",
			removeKey:  admission.AnnotationBudgetLimit,
			wantSubstr: admission.AnnotationBudgetLimit,
		},
		{
			name:       "missing consent-policy",
			removeKey:  admission.AnnotationConsentPolicy,
			wantSubstr: admission.AnnotationConsentPolicy,
		},
		{
			name:       "missing audit-enabled",
			removeKey:  admission.AnnotationAuditEnabled,
			wantSubstr: admission.AnnotationAuditEnabled,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			annotations := validAnnotations()
			delete(annotations, tc.removeKey)

			result := admission.ValidateGovernanceAnnotations(annotations, defaultConfig())
			if result.Allowed {
				t.Fatal("expected allowed=false for missing annotation")
			}
			if !strings.Contains(result.Reason, tc.wantSubstr) {
				t.Errorf("expected reason to contain %q, got: %s", tc.wantSubstr, result.Reason)
			}
		})
	}
}

func TestValidateGovernanceAnnotations_TrustLevel(t *testing.T) {
	tests := []struct {
		name        string
		value       string
		wantAllowed bool
	}{
		{name: "level 0 (Observer)", value: "0", wantAllowed: true},
		{name: "level 1 (Monitor)", value: "1", wantAllowed: true},
		{name: "level 2 (Suggest)", value: "2", wantAllowed: true},
		{name: "level 3 (ActWithApproval)", value: "3", wantAllowed: true},
		{name: "level 4 (ActAndReport)", value: "4", wantAllowed: true},
		{name: "level 5 (Autonomous)", value: "5", wantAllowed: true},
		{name: "negative value", value: "-1", wantAllowed: false},
		{name: "value above max", value: "6", wantAllowed: false},
		{name: "non-integer", value: "high", wantAllowed: false},
		{name: "float string", value: "2.5", wantAllowed: false},
		{name: "empty string", value: "", wantAllowed: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			annotations := validAnnotations()
			annotations[admission.AnnotationTrustLevel] = tc.value

			result := admission.ValidateGovernanceAnnotations(annotations, defaultConfig())
			if result.Allowed != tc.wantAllowed {
				t.Errorf("trust-level=%q: expected allowed=%v, got allowed=%v, reason: %s",
					tc.value, tc.wantAllowed, result.Allowed, result.Reason)
			}
		})
	}
}

func TestValidateGovernanceAnnotations_BudgetLimit(t *testing.T) {
	tests := []struct {
		name        string
		value       string
		wantAllowed bool
	}{
		{name: "valid USD", value: "100USD", wantAllowed: true},
		{name: "valid EUR large amount", value: "9999EUR", wantAllowed: true},
		{name: "valid GBP single digit", value: "1GBP", wantAllowed: true},
		{name: "lowercase currency", value: "100usd", wantAllowed: false},
		{name: "mixed case currency", value: "100Usd", wantAllowed: false},
		{name: "zero amount", value: "0USD", wantAllowed: false},
		{name: "no amount", value: "USD", wantAllowed: false},
		{name: "no currency", value: "100", wantAllowed: false},
		{name: "four letter currency", value: "100USDD", wantAllowed: false},
		{name: "two letter currency", value: "100US", wantAllowed: false},
		{name: "decimal amount", value: "10.5USD", wantAllowed: false},
		{name: "empty string", value: "", wantAllowed: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			annotations := validAnnotations()
			annotations[admission.AnnotationBudgetLimit] = tc.value

			result := admission.ValidateGovernanceAnnotations(annotations, defaultConfig())
			if result.Allowed != tc.wantAllowed {
				t.Errorf("budget-limit=%q: expected allowed=%v, got allowed=%v, reason: %s",
					tc.value, tc.wantAllowed, result.Allowed, result.Reason)
			}
		})
	}
}

func TestValidateGovernanceAnnotations_ConsentPolicy(t *testing.T) {
	tests := []struct {
		name        string
		value       string
		wantAllowed bool
	}{
		{name: "explicit", value: "explicit", wantAllowed: true},
		{name: "implicit", value: "implicit", wantAllowed: true},
		{name: "delegated", value: "delegated", wantAllowed: true},
		{name: "none", value: "none", wantAllowed: true},
		{name: "uppercase explicit", value: "EXPLICIT", wantAllowed: false},
		{name: "unknown policy", value: "inferred", wantAllowed: false},
		{name: "empty string", value: "", wantAllowed: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			annotations := validAnnotations()
			annotations[admission.AnnotationConsentPolicy] = tc.value

			result := admission.ValidateGovernanceAnnotations(annotations, defaultConfig())
			if result.Allowed != tc.wantAllowed {
				t.Errorf("consent-policy=%q: expected allowed=%v, got allowed=%v, reason: %s",
					tc.value, tc.wantAllowed, result.Allowed, result.Reason)
			}
		})
	}
}

func TestValidateGovernanceAnnotations_AuditEnabled(t *testing.T) {
	tests := []struct {
		name        string
		value       string
		wantAllowed bool
	}{
		{name: "true", value: "true", wantAllowed: true},
		{name: "false", value: "false", wantAllowed: true},
		{name: "True (uppercase)", value: "True", wantAllowed: false},
		{name: "FALSE (uppercase)", value: "FALSE", wantAllowed: false},
		{name: "1", value: "1", wantAllowed: false},
		{name: "0", value: "0", wantAllowed: false},
		{name: "yes", value: "yes", wantAllowed: false},
		{name: "empty string", value: "", wantAllowed: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			annotations := validAnnotations()
			annotations[admission.AnnotationAuditEnabled] = tc.value

			result := admission.ValidateGovernanceAnnotations(annotations, defaultConfig())
			if result.Allowed != tc.wantAllowed {
				t.Errorf("audit-enabled=%q: expected allowed=%v, got allowed=%v, reason: %s",
					tc.value, tc.wantAllowed, result.Allowed, result.Reason)
			}
		})
	}
}

func TestValidateGovernanceAnnotations_PartialRequiredAnnotations(t *testing.T) {
	// When RequiredAnnotations lists only a subset, the others are not checked
	// for presence (but are still format-validated if present).
	config := admission.WebhookConfig{
		RequiredAnnotations: []string{
			admission.AnnotationTrustLevel,
			admission.AnnotationAuditEnabled,
		},
	}

	// Only trust-level and audit-enabled present; no budget-limit or consent-policy.
	annotations := map[string]string{
		admission.AnnotationTrustLevel:   "3",
		admission.AnnotationAuditEnabled: "true",
	}

	result := admission.ValidateGovernanceAnnotations(annotations, config)
	if !result.Allowed {
		t.Fatalf("expected allowed=true with partial required annotations, got reason: %s", result.Reason)
	}
}

func TestValidateGovernanceAnnotations_EmptyAnnotationMap(t *testing.T) {
	result := admission.ValidateGovernanceAnnotations(map[string]string{}, defaultConfig())
	if result.Allowed {
		t.Fatal("expected allowed=false for empty annotation map")
	}
	if result.Reason == "" {
		t.Fatal("expected non-empty reason for empty annotation map")
	}
}

func TestValidateGovernanceAnnotations_NilAnnotationMap(t *testing.T) {
	result := admission.ValidateGovernanceAnnotations(nil, defaultConfig())
	if result.Allowed {
		t.Fatal("expected allowed=false for nil annotation map")
	}
}

func BenchmarkValidateGovernanceAnnotations(b *testing.B) {
	annotations := validAnnotations()
	config := defaultConfig()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_ = admission.ValidateGovernanceAnnotations(annotations, config)
	}
}
