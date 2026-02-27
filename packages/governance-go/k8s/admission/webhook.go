// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package admission

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
)

// Handler is the HTTP handler for the AumOS governance ValidatingWebhook.
// It implements the admission.k8s.io/v1 AdmissionReview protocol:
//
//  1. Decode the incoming AdmissionReview JSON from the Kubernetes API server.
//  2. Extract the Pod's annotation map from the object under review.
//  3. Run ValidateGovernanceAnnotations against the annotations.
//  4. Return an AdmissionReview JSON response with an AdmissionResponse.
//
// Handler is safe for concurrent use. All mutable state is confined to the
// request lifecycle; there are no shared fields that mutate after construction.
type Handler struct {
	config WebhookConfig
	logger *slog.Logger
}

// NewHandler constructs an admission Handler with the supplied configuration
// and structured logger.
//
// When logger is nil, slog.Default() is used.
func NewHandler(config WebhookConfig, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{config: config, logger: logger}
}

// RegisterRoutes registers the webhook's HTTP handlers on mux.
//
// Two paths are registered:
//   - POST /validate — the admission review endpoint called by the k8s API server.
//   - GET  /healthz  — a liveness probe endpoint that always returns 200 OK.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/validate", h.HandleAdmit)
	mux.HandleFunc("/healthz", h.HandleHealthz)
}

// HandleAdmit is the HTTP handler for POST /validate.
//
// It decodes the AdmissionReview, validates governance annotations on the Pod
// object, and writes an AdmissionReview response. Every decision — allowed or
// denied — is recorded in the structured log at INFO level so that operators
// can audit webhook activity.
//
// Error paths:
//   - Method not POST     → 405 Method Not Allowed (no AdmissionReview response).
//   - Body read error     → 400 Bad Request (no AdmissionReview response).
//   - JSON decode error   → 400 Bad Request (no AdmissionReview response).
//   - Missing Request     → 400 Bad Request (no AdmissionReview response).
//   - Pod JSON parse fail → deny with structured reason (AdmissionReview response).
//   - Governance fail     → deny with structured reason (AdmissionReview response).
func (h *Handler) HandleAdmit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.logger.Warn("admission: unexpected HTTP method",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
		)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		h.logger.Error("admission: failed to read request body", slog.String("error", err.Error()))
		http.Error(w, "failed to read request body", http.StatusBadRequest)
		return
	}

	var review AdmissionReview
	if err := json.Unmarshal(body, &review); err != nil {
		h.logger.Error("admission: failed to decode AdmissionReview JSON",
			slog.String("error", err.Error()),
		)
		http.Error(w, "invalid AdmissionReview JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	if review.Request == nil {
		h.logger.Error("admission: AdmissionReview has no Request field")
		http.Error(w, "AdmissionReview.request must not be null", http.StatusBadRequest)
		return
	}

	response := h.admit(review.Request)

	out := AdmissionReview{
		APIVersion: "admission.k8s.io/v1",
		Kind:       "AdmissionReview",
		Response:   response,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(out); err != nil {
		// The response header has already been written; all we can do is log.
		h.logger.Error("admission: failed to encode AdmissionReview response",
			slog.String("uid", review.Request.UID),
			slog.String("error", err.Error()),
		)
	}
}

// HandleHealthz is the HTTP handler for GET /healthz.
// It responds 200 OK with the body "ok\n". Kubernetes uses this endpoint for
// liveness and readiness probes on the webhook Deployment.
func (h *Handler) HandleHealthz(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	fmt.Fprintln(w, "ok")
}

// admit contains the core admission decision logic. It is broken out from
// HandleAdmit to keep the HTTP plumbing separate from the validation logic
// and to make the decision path straightforward to unit-test.
func (h *Handler) admit(req *AdmissionRequest) *AdmissionResponse {
	// Extract Pod annotations from the raw object JSON.
	annotations, podName, podNamespace, err := extractPodAnnotations(req.Object.Raw)
	if err != nil {
		h.logger.Error("admission: failed to extract Pod annotations",
			slog.String("uid", req.UID),
			slog.String("operation", req.Operation),
			slog.String("error", err.Error()),
		)
		return denyResponse(req.UID,
			fmt.Sprintf("governance webhook: could not parse Pod object: %s", err.Error()),
		)
	}

	result := ValidateGovernanceAnnotations(annotations, h.config)

	h.logger.Info("admission: decision",
		slog.String("uid", req.UID),
		slog.String("operation", req.Operation),
		slog.String("pod_name", podName),
		slog.String("pod_namespace", podNamespace),
		slog.Bool("allowed", result.Allowed),
		slog.String("reason", result.Reason),
	)

	if !result.Allowed {
		return denyResponse(req.UID, result.Reason)
	}

	resp := &AdmissionResponse{
		UID:     req.UID,
		Allowed: true,
	}
	if len(result.Warnings) > 0 {
		resp.Warnings = result.Warnings
	}
	return resp
}

// extractPodAnnotations parses the raw Pod JSON and returns its annotation
// map, name, and namespace. It returns an error when the raw bytes cannot be
// unmarshalled into a PodMeta.
func extractPodAnnotations(raw []byte) (annotations map[string]string, name, namespace string, err error) {
	if len(raw) == 0 {
		return nil, "", "", fmt.Errorf("admission: object.raw is empty")
	}

	var pod PodMeta
	if err := json.Unmarshal(raw, &pod); err != nil {
		return nil, "", "", fmt.Errorf("admission: unmarshal Pod metadata: %w", err)
	}

	name = pod.Metadata.Name
	namespace = pod.Metadata.Namespace

	annotations = pod.Metadata.Annotations
	if annotations == nil {
		annotations = map[string]string{}
	}

	return annotations, name, namespace, nil
}

// denyResponse constructs an AdmissionResponse that denies the request with
// a 403 status code and the supplied human-readable message.
func denyResponse(uid, message string) *AdmissionResponse {
	return &AdmissionResponse{
		UID:     uid,
		Allowed: false,
		Result: &StatusResult{
			Message: message,
			Code:    http.StatusForbidden,
		},
	}
}
