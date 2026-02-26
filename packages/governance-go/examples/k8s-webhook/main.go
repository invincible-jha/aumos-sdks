// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

// Command k8s-webhook demonstrates embedding the governance engine inside a
// Kubernetes admission webhook that controls whether a Pod is allowed to run
// based on governance policy.
//
// The webhook reads the requesting user's identity from the
// AdmissionRequest.UserInfo and maps it to an agent ID. A governance check
// then gates the admission based on trust level and (optionally) budget.
//
// To use in a real cluster:
//  1. Build and push this image.
//  2. Create a ValidatingWebhookConfiguration pointing to this service.
//  3. Ensure TLS termination (cert-manager or your own certificates).
//
// Run locally for testing:
//
//	go run ./examples/k8s-webhook/main.go
//
// Then POST an AdmissionReview JSON to http://localhost:8443/validate.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance"
)

// AdmissionRequest mirrors the relevant fields of k8s.io/api/admission/v1.AdmissionRequest
// without importing the Kubernetes API machinery.
type AdmissionRequest struct {
	UID       string   `json:"uid"`
	Operation string   `json:"operation"`
	UserInfo  UserInfo `json:"userInfo"`
	Resource  Resource `json:"resource"`
}

// UserInfo carries the requesting user's identity.
type UserInfo struct {
	Username string   `json:"username"`
	Groups   []string `json:"groups"`
}

// Resource identifies the Kubernetes resource kind being acted upon.
type Resource struct {
	Group    string `json:"group"`
	Version  string `json:"version"`
	Resource string `json:"resource"`
}

// AdmissionReview wraps the request/response for admission webhook calls.
type AdmissionReview struct {
	APIVersion string             `json:"apiVersion"`
	Kind       string             `json:"kind"`
	Request    *AdmissionRequest  `json:"request,omitempty"`
	Response   *AdmissionResponse `json:"response,omitempty"`
}

// AdmissionResponse mirrors k8s.io/api/admission/v1.AdmissionResponse.
type AdmissionResponse struct {
	UID     string `json:"uid"`
	Allowed bool   `json:"allowed"`
	Result  *Status `json:"status,omitempty"`
}

// Status carries the denial reason to the Kubernetes API server.
type Status struct {
	Message string `json:"message"`
	Code    int32  `json:"code"`
}

func main() {
	ctx := context.Background()

	// Build the governance engine.
	engine, err := governance.NewEngine(governance.Config{
		DefaultScope: "k8s",
		TrustConfig: governance.TrustConfig{
			DefaultLevel: governance.TrustObserver,
		},
		BudgetConfig: governance.BudgetConfig{
			DefaultPeriod: 24 * time.Hour,
		},
	})
	if err != nil {
		log.Fatalf("create engine: %v", err)
	}

	// Grant trust to known CI/CD service accounts.
	_, _ = engine.Trust.SetLevel(ctx, "system:serviceaccount:ci:deployer",
		governance.TrustActWithApproval, "k8s", governance.WithAssignedBy("owner"))
	_, _ = engine.Trust.SetLevel(ctx, "system:serviceaccount:prod:operator",
		governance.TrustActAndReport, "k8s", governance.WithAssignedBy("owner"))

	// Create a compute budget envelope (1 000 Pod creations per day).
	_, _ = engine.Budget.CreateEnvelope(ctx, "pod-create", 1000.0, 24*time.Hour)

	http.HandleFunc("/validate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var review AdmissionReview
		if err := json.NewDecoder(r.Body).Decode(&review); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if review.Request == nil {
			http.Error(w, "missing request", http.StatusBadRequest)
			return
		}

		req := review.Request
		agentID := req.UserInfo.Username
		action := req.Operation + ":" + req.Resource.Resource

		var checkOpts []governance.CheckOption
		checkOpts = append(checkOpts, governance.WithAgentID(agentID))
		checkOpts = append(checkOpts, governance.WithScope("k8s"))
		checkOpts = append(checkOpts, governance.WithRequiredTrust(governance.TrustActWithApproval))

		// Only gate Pod creations against the compute budget.
		if req.Operation == "CREATE" && req.Resource.Resource == "pods" {
			checkOpts = append(checkOpts, governance.WithBudgetCheck("pod-create", 1.0))
			checkOpts = append(checkOpts, governance.WithBudgetRecord())
		}

		decision, err := engine.Check(r.Context(), action, checkOpts...)
		if err != nil {
			http.Error(w, "governance error: "+err.Error(), http.StatusInternalServerError)
			return
		}

		resp := &AdmissionReview{
			APIVersion: "admission.k8s.io/v1",
			Kind:       "AdmissionReview",
			Response: &AdmissionResponse{
				UID:     req.UID,
				Allowed: decision.Permitted,
			},
		}
		if !decision.Permitted {
			resp.Response.Result = &Status{
				Message: decision.Reason,
				Code:    403,
			}
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Printf("encode response: %v", err)
		}
	})

	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "ok")
	})

	addr := ":8443"
	fmt.Printf("Admission webhook listening on %s\n", addr)
	fmt.Println("POST AdmissionReview JSON to /validate")
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("server: %v", err)
	}
}
