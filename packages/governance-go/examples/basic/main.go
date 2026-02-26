// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

// Command basic demonstrates the core governance SDK workflow:
//   - Constructing a GovernanceEngine with default in-memory storage.
//   - Manually assigning trust levels to agents.
//   - Creating budget envelopes.
//   - Recording consent grants.
//   - Evaluating governance decisions via engine.Check.
//   - Querying the audit log.
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aumos-ai/aumos-sdks/go/governance"
)

func main() {
	ctx := context.Background()

	// -------------------------------------------------------------------
	// 1. Construct the engine.
	// -------------------------------------------------------------------
	engine, err := governance.NewEngine(governance.Config{
		DefaultScope: "production",
		TrustConfig: governance.TrustConfig{
			DefaultLevel: governance.TrustObserver,
		},
		BudgetConfig: governance.BudgetConfig{
			DefaultPeriod: 30 * 24 * time.Hour,
		},
	})
	if err != nil {
		log.Fatalf("failed to create engine: %v", err)
	}

	// -------------------------------------------------------------------
	// 2. Assign trust levels. Trust is always set manually.
	// -------------------------------------------------------------------
	_, err = engine.Trust.SetLevel(ctx, "agent-writer", governance.TrustSuggest, "production",
		governance.WithAssignedBy("admin"),
	)
	if err != nil {
		log.Fatalf("set trust: %v", err)
	}

	_, err = engine.Trust.SetLevel(ctx, "agent-autonomous", governance.TrustAutonomous, "production",
		governance.WithAssignedBy("owner"),
	)
	if err != nil {
		log.Fatalf("set trust: %v", err)
	}

	fmt.Printf("agent-writer trust level:    %s\n",
		governance.TrustLevelName(engine.Trust.GetLevel(ctx, "agent-writer", "production")))
	fmt.Printf("agent-autonomous trust level: %s\n",
		governance.TrustLevelName(engine.Trust.GetLevel(ctx, "agent-autonomous", "production")))

	// -------------------------------------------------------------------
	// 3. Create spending envelopes. Budgets are static.
	// -------------------------------------------------------------------
	_, err = engine.Budget.CreateEnvelope(ctx, "llm-tokens", 50.0, 30*24*time.Hour)
	if err != nil {
		log.Fatalf("create envelope: %v", err)
	}

	_, err = engine.Budget.CreateEnvelope(ctx, "email-send", 5.0, 24*time.Hour)
	if err != nil {
		log.Fatalf("create envelope: %v", err)
	}

	// -------------------------------------------------------------------
	// 4. Record consent grants.
	// -------------------------------------------------------------------
	if err := engine.Consent.Record(ctx, "agent-writer", "send_email", "admin"); err != nil {
		log.Fatalf("record consent: %v", err)
	}

	// -------------------------------------------------------------------
	// 5. Evaluate governance decisions.
	// -------------------------------------------------------------------

	// Case A: agent-writer attempts to send email — should pass all checks.
	decision, err := engine.Check(ctx, "send_email",
		governance.WithAgentID("agent-writer"),
		governance.WithRequiredTrust(governance.TrustSuggest),
		governance.WithBudgetCheck("email-send", 0.01),
		governance.WithConsentCheck("agent-writer", "send_email"),
		governance.WithBudgetRecord(),
	)
	if err != nil {
		log.Fatalf("check error: %v", err)
	}
	printDecision("Case A (agent-writer send_email)", decision)

	// Case B: agent with no trust tries an action requiring TrustActWithApproval.
	decision, err = engine.Check(ctx, "modify_database",
		governance.WithAgentID("agent-writer"),
		governance.WithRequiredTrust(governance.TrustActWithApproval),
	)
	if err != nil {
		log.Fatalf("check error: %v", err)
	}
	printDecision("Case B (agent-writer modify_database — insufficient trust)", decision)

	// Case C: agent-autonomous acts without consent on a guarded resource.
	decision, err = engine.Check(ctx, "read_pii",
		governance.WithAgentID("agent-autonomous"),
		governance.WithRequiredTrust(governance.TrustActAndReport),
		governance.WithConsentCheck("agent-autonomous", "read_pii"),
	)
	if err != nil {
		log.Fatalf("check error: %v", err)
	}
	printDecision("Case C (agent-autonomous read_pii — no consent)", decision)

	// Case D: exhaust the email budget, then retry.
	_ = engine.Budget.Record(ctx, "email-send", 4.99) // consume nearly all budget
	decision, err = engine.Check(ctx, "send_email",
		governance.WithAgentID("agent-writer"),
		governance.WithRequiredTrust(governance.TrustSuggest),
		governance.WithBudgetCheck("email-send", 0.02), // 0.02 > 0.01 remaining
	)
	if err != nil {
		log.Fatalf("check error: %v", err)
	}
	printDecision("Case D (agent-writer send_email — budget exhausted)", decision)

	// -------------------------------------------------------------------
	// 6. Query the audit log.
	// -------------------------------------------------------------------
	records, err := engine.Audit.Query(ctx)
	if err != nil {
		log.Fatalf("audit query: %v", err)
	}
	fmt.Printf("\nAudit log (%d records):\n", len(records))
	for i, r := range records {
		status := "PERMITTED"
		if !r.Decision.Permitted {
			status = "DENIED   "
		}
		fmt.Printf("  [%d] %s action=%-25s reason=%s\n",
			i+1, status, r.Decision.Action, r.Decision.Reason)
	}

	// Query only denied decisions.
	denied, err := engine.Audit.Query(ctx, governance.WithDeniedOnly())
	if err != nil {
		log.Fatalf("audit query denied: %v", err)
	}
	fmt.Printf("\nDenied decisions: %d\n", len(denied))
}

func printDecision(label string, d *governance.Decision) {
	status := "PERMITTED"
	if !d.Permitted {
		status = "DENIED"
	}
	fmt.Printf("\n%s:\n  status=%s\n  reason=%s\n", label, status, d.Reason)
}
