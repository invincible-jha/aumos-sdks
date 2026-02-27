// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

package admission_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aumos-ai/aumos-sdks/go/governance/k8s/admission"
)

// buildAdmissionReview constructs a minimal AdmissionReview JSON payload
// embedding a Pod with the supplied annotations.
func buildAdmissionReview(t *testing.T, uid string, annotations map[string]string) []byte {
	t.Helper()

	podMeta := map[string]interface{}{
		"metadata": map[string]interface{}{
			"name":        "test-agent-pod",
			"namespace":   "aumos-agents",
			"annotations": annotations,
		},
	}
	rawPod, err := json.Marshal(podMeta)
	if err != nil {
		t.Fatalf("marshal pod: %v", err)
	}

	review := map[string]interface{}{
		"apiVersion": "admission.k8s.io/v1",
		"kind":       "AdmissionReview",
		"request": map[string]interface{}{
			"uid":       uid,
			"operation": "CREATE",
			"resource": map[string]string{
				"group":    "",
				"version":  "v1",
				"resource": "pods",
			},
			"object": map[string]interface{}{
				"raw": rawPod,
			},
		},
	}

	body, err := json.Marshal(review)
	if err != nil {
		t.Fatalf("marshal review: %v", err)
	}
	return body
}

// decodeReviewResponse decodes the response body as an AdmissionReview.
func decodeReviewResponse(t *testing.T, body []byte) admission.AdmissionReview {
	t.Helper()
	var review admission.AdmissionReview
	if err := json.Unmarshal(body, &review); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return review
}

func newTestHandler() *admission.Handler {
	return admission.NewHandler(admission.WebhookConfig{}, nil)
}

func TestHandleAdmit_ValidPod(t *testing.T) {
	body := buildAdmissionReview(t, "uid-valid-001", validAnnotations())

	req := httptest.NewRequest(http.MethodPost, "/validate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	newTestHandler().HandleAdmit(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	review := decodeReviewResponse(t, rec.Body.Bytes())
	if review.Response == nil {
		t.Fatal("expected non-nil response")
	}
	if !review.Response.Allowed {
		t.Errorf("expected allowed=true, got reason: %s", review.Response.Result.Message)
	}
	if review.Response.UID != "uid-valid-001" {
		t.Errorf("expected UID echo uid-valid-001, got %s", review.Response.UID)
	}
}

func TestHandleAdmit_MissingAnnotation(t *testing.T) {
	annotations := validAnnotations()
	delete(annotations, admission.AnnotationTrustLevel)

	body := buildAdmissionReview(t, "uid-missing-001", annotations)

	req := httptest.NewRequest(http.MethodPost, "/validate", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	newTestHandler().HandleAdmit(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (AdmissionReview response), got %d", rec.Code)
	}

	review := decodeReviewResponse(t, rec.Body.Bytes())
	if review.Response == nil {
		t.Fatal("expected non-nil response")
	}
	if review.Response.Allowed {
		t.Fatal("expected allowed=false for missing trust-level annotation")
	}
	if !strings.Contains(review.Response.Result.Message, admission.AnnotationTrustLevel) {
		t.Errorf("expected denial message to mention %q, got: %s",
			admission.AnnotationTrustLevel, review.Response.Result.Message)
	}
}

func TestHandleAdmit_InvalidTrustLevel(t *testing.T) {
	annotations := validAnnotations()
	annotations[admission.AnnotationTrustLevel] = "99"

	body := buildAdmissionReview(t, "uid-bad-trust", annotations)
	req := httptest.NewRequest(http.MethodPost, "/validate", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	newTestHandler().HandleAdmit(rec, req)

	review := decodeReviewResponse(t, rec.Body.Bytes())
	if review.Response.Allowed {
		t.Fatal("expected allowed=false for out-of-range trust level")
	}
}

func TestHandleAdmit_WrongHTTPMethod(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/validate", nil)
	rec := httptest.NewRecorder()

	newTestHandler().HandleAdmit(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rec.Code)
	}
}

func TestHandleAdmit_MalformedJSON(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/validate", strings.NewReader("{not valid json"))
	rec := httptest.NewRecorder()

	newTestHandler().HandleAdmit(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleAdmit_MissingRequest(t *testing.T) {
	// AdmissionReview without a Request field.
	body, _ := json.Marshal(map[string]string{
		"apiVersion": "admission.k8s.io/v1",
		"kind":       "AdmissionReview",
	})
	req := httptest.NewRequest(http.MethodPost, "/validate", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	newTestHandler().HandleAdmit(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
}

func TestHandleAdmit_EmptyObjectRaw(t *testing.T) {
	// Request where object.raw is absent — no pod metadata to inspect.
	review := map[string]interface{}{
		"apiVersion": "admission.k8s.io/v1",
		"kind":       "AdmissionReview",
		"request": map[string]interface{}{
			"uid":       "uid-no-raw",
			"operation": "CREATE",
			"resource":  map[string]string{"group": "", "version": "v1", "resource": "pods"},
			"object":    map[string]interface{}{},
		},
	}
	body, _ := json.Marshal(review)
	req := httptest.NewRequest(http.MethodPost, "/validate", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	newTestHandler().HandleAdmit(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 AdmissionReview response, got %d", rec.Code)
	}

	resp := decodeReviewResponse(t, rec.Body.Bytes())
	if resp.Response.Allowed {
		t.Fatal("expected allowed=false when object.raw is empty")
	}
}

func TestHandleHealthz(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	newTestHandler().HandleHealthz(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "ok") {
		t.Errorf("expected body to contain \"ok\", got: %s", rec.Body.String())
	}
}

func TestHandleAdmit_UIDIsEchoedBack(t *testing.T) {
	const wantUID = "echo-me-back-123"
	body := buildAdmissionReview(t, wantUID, validAnnotations())

	req := httptest.NewRequest(http.MethodPost, "/validate", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	newTestHandler().HandleAdmit(rec, req)

	review := decodeReviewResponse(t, rec.Body.Bytes())
	if review.Response.UID != wantUID {
		t.Errorf("expected UID %q echoed in response, got %q", wantUID, review.Response.UID)
	}
}
