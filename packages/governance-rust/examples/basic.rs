// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! # Basic Governance Engine Example
//!
//! Demonstrates the full sequential evaluation pipeline using the in-memory
//! storage backend.  Run with:
//!
//! ```bash
//! cargo run --example basic
//! ```

use aumos_governance_core::{
    config::Config,
    engine::GovernanceEngine,
    storage::InMemoryStorage,
    types::{AuditFilter, Context, TrustLevel},
};

fn main() {
    println!("AumOS Governance SDK — Basic Example\n");

    // -----------------------------------------------------------------------
    // 1. Construct the engine
    // -----------------------------------------------------------------------
    let storage = InMemoryStorage::new();
    let config = Config::default();
    let mut engine = GovernanceEngine::new(config, storage);

    // -----------------------------------------------------------------------
    // 2. Assign trust levels (always manual — by the owner)
    // -----------------------------------------------------------------------
    engine
        .trust
        .set_level("agent-finance-001", "finance", TrustLevel::ActAndReport, "owner");
    engine
        .trust
        .set_level("agent-ops-001", "ops", TrustLevel::Monitor, "owner");

    println!("Trust levels assigned:");
    if let Some(assignment) = engine.trust.get_level("agent-finance-001", "finance") {
        println!(
            "  agent-finance-001 @ finance: {} (assigned by: {})",
            assignment.level.display_name(),
            assignment.assigned_by
        );
    }
    if let Some(assignment) = engine.trust.get_level("agent-ops-001", "ops") {
        println!(
            "  agent-ops-001 @ ops: {} (assigned by: {})",
            assignment.level.display_name(),
            assignment.assigned_by
        );
    }
    println!();

    // -----------------------------------------------------------------------
    // 3. Create a spending envelope (static allocation — no adaptive logic)
    // -----------------------------------------------------------------------
    engine.budget.create_envelope("financial", 1_000.0, 86_400_000, 0);
    println!("Budget envelope created: financial @ $1,000.00 / day\n");

    // -----------------------------------------------------------------------
    // 4. Record consent
    // -----------------------------------------------------------------------
    engine.consent.record("agent-finance-001", "process_pii");
    println!("Consent recorded: agent-finance-001 → process_pii\n");

    // -----------------------------------------------------------------------
    // 5. Evaluate actions through the sequential pipeline
    // -----------------------------------------------------------------------

    // Action A — should PERMIT (trust ok, budget ok, consent ok)
    let ctx_a = Context {
        agent_id:       "agent-finance-001".into(),
        scope:          "finance".into(),
        required_trust: TrustLevel::Suggest,
        cost:           Some(250.0),
        category:       "financial".into(),
        data_type:      Some("process_pii".into()),
        purpose:        Some("invoice processing".into()),
    };
    let decision_a = engine.check("send_invoice", &ctx_a);
    print_decision("send_invoice (agent-finance-001)", &decision_a);

    // Action B — should DENY at trust gate (ops agent lacks Autonomous level)
    let ctx_b = Context {
        agent_id:       "agent-ops-001".into(),
        scope:          "ops".into(),
        required_trust: TrustLevel::Autonomous,
        cost:           None,
        category:       "ops".into(),
        data_type:      None,
        purpose:        None,
    };
    let decision_b = engine.check("delete_cluster", &ctx_b);
    print_decision("delete_cluster (agent-ops-001)", &decision_b);

    // Action C — should DENY at budget gate (only $750 remains after A)
    let ctx_c = Context {
        agent_id:       "agent-finance-001".into(),
        scope:          "finance".into(),
        required_trust: TrustLevel::Suggest,
        cost:           Some(800.0),
        category:       "financial".into(),
        data_type:      None,
        purpose:        None,
    };
    let decision_c = engine.check("bulk_transfer", &ctx_c);
    print_decision("bulk_transfer (agent-finance-001, exceeds budget)", &decision_c);

    // Action D — should DENY at consent gate (no consent for "delete_records")
    let ctx_d = Context {
        agent_id:       "agent-finance-001".into(),
        scope:          "finance".into(),
        required_trust: TrustLevel::Suggest,
        cost:           Some(5.0),
        category:       "financial".into(),
        data_type:      Some("delete_records".into()),
        purpose:        None,
    };
    let decision_d = engine.check("purge_old_invoices", &ctx_d);
    print_decision("purge_old_invoices (no consent for delete_records)", &decision_d);

    // -----------------------------------------------------------------------
    // 6. Query the audit log
    // -----------------------------------------------------------------------
    println!("\nAudit log (all records):");
    let all_records = engine.query_audit(&AuditFilter::default());
    println!("  Total records: {}", all_records.len());
    for record in &all_records {
        println!(
            "  [{}] action={} permitted={} reason={}",
            &record.id,
            record.decision.action,
            record.decision.permitted,
            record.decision.reason
        );
    }

    println!("\nAudit log (permitted only, simulated by action filter):");
    let filter = AuditFilter {
        action: Some("send_invoice".into()),
        limit: Some(5),
        ..AuditFilter::default()
    };
    let filtered = engine.query_audit(&filter);
    println!("  Records matching 'send_invoice': {}", filtered.len());
    for record in &filtered {
        println!("    hash={} prev={}", &record.hash[..8], &record.prev_hash[..8]);
    }

    // -----------------------------------------------------------------------
    // 7. Revoke consent and verify
    // -----------------------------------------------------------------------
    println!("\nRevoking consent for agent-finance-001 → process_pii...");
    engine.consent.revoke("agent-finance-001", "process_pii");

    let ctx_e = Context {
        agent_id:       "agent-finance-001".into(),
        scope:          "finance".into(),
        required_trust: TrustLevel::Suggest,
        cost:           Some(1.0),
        category:       "financial".into(),
        data_type:      Some("process_pii".into()),
        purpose:        None,
    };
    let decision_e = engine.check("read_invoice_pii", &ctx_e);
    print_decision("read_invoice_pii (after consent revoked)", &decision_e);

    println!("\nDone.");
}

fn print_decision(label: &str, decision: &aumos_governance_core::types::Decision) {
    println!(
        "[{}] permitted={} | reason={}",
        label, decision.permitted, decision.reason
    );
    println!(
        "  trust:   {} (need {}, have {})",
        if decision.trust.permitted { "ok" } else { "DENIED" },
        decision.trust.required_level.display_name(),
        decision.trust.current_level.display_name()
    );
    println!(
        "  budget:  {} (requested={:.2}, available={:.2})",
        if decision.budget.permitted { "ok" } else { "DENIED" },
        decision.budget.requested,
        decision.budget.available
    );
    println!(
        "  consent: {}",
        if decision.consent.permitted { "ok" } else { "DENIED" }
    );
    println!();
}
