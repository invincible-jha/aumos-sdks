// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

// Command http-middleware demonstrates wrapping a standard net/http ServeMux
// with GovernanceMiddleware. All incoming requests are checked for:
//   - A minimum trust level of TrustSuggest (carried in X-Agent-ID header).
//   - Budget availability in the "api-requests" envelope.
//
// Run:
//
//	go run ./examples/http-middleware/main.go
//
// Then test with curl:
//
//	# Permitted (agent-writer has TrustSuggest, budget available)
//	curl -H "X-Agent-ID: agent-writer" http://localhost:8080/api/hello
//
//	# Denied (unknown agent has TrustObserver < TrustSuggest)
//	curl -H "X-Agent-ID: unknown-agent" http://localhost:8080/api/hello
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance"
	govmw "github.com/aumos-ai/aumos-sdks/go/governance/middleware"
)

func main() {
	ctx := context.Background()

	// Build the engine.
	engine, err := governance.NewEngine(governance.Config{
		DefaultScope: "api",
	})
	if err != nil {
		log.Fatalf("create engine: %v", err)
	}

	// Assign trust to known agents.
	_, _ = engine.Trust.SetLevel(ctx, "agent-writer", governance.TrustSuggest, "api",
		governance.WithAssignedBy("admin"))
	_, _ = engine.Trust.SetLevel(ctx, "agent-admin", governance.TrustActWithApproval, "api",
		governance.WithAssignedBy("owner"))

	// Create a budget envelope — 1 000 API requests per day.
	_, _ = engine.Budget.CreateEnvelope(ctx, "api-requests", 1000.0, 24*time.Hour)

	// Register application handlers.
	mux := http.NewServeMux()

	mux.HandleFunc("/api/hello", func(w http.ResponseWriter, r *http.Request) {
		decision := govmw.DecisionFromContext(r)
		agentID := r.Header.Get("X-Agent-ID")
		fmt.Fprintf(w, "Hello, %s! Governance permitted: %v\n", agentID, decision != nil && decision.Permitted)
	})

	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, `{"status":"ok"}`)
	})

	// Wrap with governance middleware.
	handler := govmw.GovernanceMiddleware(engine,
		govmw.WithHTTPAgentHeader("X-Agent-ID"),
		govmw.WithHTTPRequiredTrust(governance.TrustSuggest),
		govmw.WithHTTPBudgetCheck("api-requests", 1.0),
		govmw.WithHTTPActionFunc(func(r *http.Request) string {
			return r.Method + ":" + r.URL.Path
		}),
	)(mux)

	addr := ":8080"
	fmt.Printf("Listening on %s\n", addr)
	fmt.Println("Send requests with -H 'X-Agent-ID: agent-writer' to test governance.")
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("server: %v", err)
	}
}
