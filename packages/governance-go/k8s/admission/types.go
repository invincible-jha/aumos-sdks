// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

// Package admission provides type definitions and validation logic for the
// AumOS Kubernetes ValidatingWebhook. It enforces that every AI agent Pod
// declares the required governance annotations before the Kubernetes API
// server admits it to the cluster.
//
// All validation is static — no adaptive decisions, no behavioral scoring.
// The webhook either allows or denies based solely on the presence and format
// of declared annotations.
package admission

// Required annotation keys that AumOS governance checks on every Pod.
const (
	// AnnotationTrustLevel is the annotation key for declaring the static
	// trust level of the AI agent running in the Pod. Valid values: 0-5.
	AnnotationTrustLevel = "aumos.ai/trust-level"

	// AnnotationBudgetLimit is the annotation key for declaring the budget
	// limit envelope assigned to this Pod. Format: "<amount><currency>"
	// e.g. "100USD", "50EUR". The currency code must be three uppercase letters.
	AnnotationBudgetLimit = "aumos.ai/budget-limit"

	// AnnotationConsentPolicy is the annotation key for declaring which
	// consent policy governs this Pod's actions. Must be one of the
	// registered ValidConsentPolicies.
	AnnotationConsentPolicy = "aumos.ai/consent-policy"

	// AnnotationAuditEnabled is the annotation key for declaring whether
	// audit logging is active for this Pod. Must be "true" or "false".
	AnnotationAuditEnabled = "aumos.ai/audit-enabled"
)

// ValidConsentPolicies is the closed set of accepted consent policy values.
// Any annotation value not in this set causes validation to fail.
var ValidConsentPolicies = []string{
	"explicit",
	"implicit",
	"delegated",
	"none",
}

// GovernanceAnnotations holds the parsed, typed representation of the four
// required AumOS governance annotations after they have been extracted from
// a Pod's metadata.
//
// This struct is used only for documentation and testing convenience. The
// validator reads raw annotation maps directly to avoid the extra unmarshalling
// step inside the hot admission path.
type GovernanceAnnotations struct {
	// TrustLevel is the declared static trust level for the agent. Valid
	// range is 0 (Observer) through 5 (Autonomous).
	TrustLevel int `json:"aumos.ai/trust-level"`

	// BudgetLimit is the declared budget envelope string, e.g. "100USD".
	BudgetLimit string `json:"aumos.ai/budget-limit"`

	// ConsentPolicy is the declared consent policy name, e.g. "explicit".
	ConsentPolicy string `json:"aumos.ai/consent-policy"`

	// AuditEnabled declares whether governance audit logging is active.
	AuditEnabled bool `json:"aumos.ai/audit-enabled"`
}

// ValidationResult holds the outcome of a single governance annotation
// validation run. It is embedded in the AdmissionResponse returned to the
// Kubernetes API server.
type ValidationResult struct {
	// Allowed is true when all required annotations are present and valid.
	Allowed bool `json:"allowed"`

	// Reason is a human-readable explanation of why the admission was denied.
	// Empty when Allowed is true.
	Reason string `json:"reason,omitempty"`

	// Warnings is a list of non-fatal advisory messages that are forwarded
	// to the kubectl client even when the admission is allowed.
	Warnings []string `json:"warnings,omitempty"`
}

// WebhookConfig holds the runtime configuration for the admission webhook
// server. All fields are populated from command-line flags at startup.
type WebhookConfig struct {
	// Port is the TCP port the HTTPS server listens on.
	Port int `json:"port"`

	// CertFile is the path to the TLS certificate PEM file.
	CertFile string `json:"certFile"`

	// KeyFile is the path to the TLS private key PEM file.
	KeyFile string `json:"keyFile"`

	// RequiredAnnotations lists the annotation keys that must be present on
	// every admitted Pod. Any key from the Annotation* constants may appear
	// here. When empty, all four standard annotations are required.
	RequiredAnnotations []string `json:"requiredAnnotations"`
}

// AdmissionReview mirrors the top-level wrapper of the
// admission.k8s.io/v1 AdmissionReview API object. We define our own
// lightweight types to avoid importing all of k8s.io/api/admission/v1 and
// the transitive dependency tree it carries.
type AdmissionReview struct {
	APIVersion string             `json:"apiVersion"`
	Kind       string             `json:"kind"`
	Request    *AdmissionRequest  `json:"request,omitempty"`
	Response   *AdmissionResponse `json:"response,omitempty"`
}

// AdmissionRequest mirrors admission.k8s.io/v1.AdmissionRequest with only
// the fields the governance webhook consumes.
type AdmissionRequest struct {
	// UID is echoed back unchanged in the AdmissionResponse.
	UID string `json:"uid"`

	// Operation is one of CREATE, UPDATE, DELETE, CONNECT.
	Operation string `json:"operation"`

	// Object holds the raw JSON of the object being admitted (the Pod).
	Object RawExtension `json:"object"`

	// Resource identifies the GroupVersionResource of the object.
	Resource GroupVersionResource `json:"resource"`
}

// AdmissionResponse mirrors admission.k8s.io/v1.AdmissionResponse.
type AdmissionResponse struct {
	// UID must match the UID from the corresponding AdmissionRequest.
	UID string `json:"uid"`

	// Allowed reports whether the admission request is permitted.
	Allowed bool `json:"allowed"`

	// Result carries denial details when Allowed is false.
	Result *StatusResult `json:"status,omitempty"`

	// Warnings is forwarded to the kubectl client as advisory messages.
	Warnings []string `json:"warnings,omitempty"`
}

// StatusResult mirrors metav1.Status for denial reasons.
type StatusResult struct {
	// Message is the human-readable denial reason shown to the operator.
	Message string `json:"message"`

	// Code is the HTTP-style status code (403 for governance denial).
	Code int32 `json:"code"`
}

// RawExtension mirrors k8s.io/apimachinery/pkg/runtime.RawExtension.
// We only need the raw JSON bytes to extract Pod metadata.
type RawExtension struct {
	Raw []byte `json:"raw,omitempty"`
}

// GroupVersionResource mirrors k8s.io/apimachinery GroupVersionResource.
type GroupVersionResource struct {
	Group    string `json:"group"`
	Version  string `json:"version"`
	Resource string `json:"resource"`
}

// PodMeta is a minimal representation of a Pod's ObjectMeta, holding only
// the fields the admission validator needs to inspect.
type PodMeta struct {
	Metadata struct {
		Name        string            `json:"name"`
		Namespace   string            `json:"namespace"`
		Annotations map[string]string `json:"annotations"`
	} `json:"metadata"`
}
