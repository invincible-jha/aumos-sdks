# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
Basic governance example.

Demonstrates creating a GovernanceEngine and running it through the
trust, budget, and consent checks for a simple agent action.

Run with:
    python examples/basic_governance.py
"""
from __future__ import annotations

import asyncio

from aumos_governance import (
    AuditFilter,
    GovernanceAction,
    GovernanceConfig,
    GovernanceEngine,
    GovernanceOutcome,
    TrustLevel,
    aggregate_outcomes,
)
from aumos_governance.config import AuditConfig, BudgetConfig, ConsentConfig, TrustConfig


async def main() -> None:
    # ------------------------------------------------------------------ #
    # 1. Configure and build the engine
    # ------------------------------------------------------------------ #
    config = GovernanceConfig(
        trust=TrustConfig(default_level=1, enable_decay=False),
        budget=BudgetConfig(allow_overdraft=False, rollover_on_reset=False),
        consent=ConsentConfig(default_deny=True),
        audit=AuditConfig(max_records=500, include_context=True),
    )
    engine = GovernanceEngine(config=config)

    # ------------------------------------------------------------------ #
    # 2. Set up trust, budget, and consent records
    # ------------------------------------------------------------------ #
    engine.trust.set_level("agent-alpha", TrustLevel.L3_ACT_APPROVE)
    engine.trust.set_level("agent-beta", TrustLevel.L1_MONITOR)

    engine.budget.create_budget("llm-calls", limit=100.0, period="monthly")
    engine.budget.create_budget("tool-executions", limit=50.0, period="daily")

    engine.consent.record_consent(
        agent_id="agent-alpha",
        data_type="user_profile",
        purpose="personalisation",
        granted_by="admin@example.com",
    )

    # ------------------------------------------------------------------ #
    # 3. Evaluate actions
    # ------------------------------------------------------------------ #
    print("=== Example 1: Approved action ===")
    decision = await engine.evaluate(
        GovernanceAction(
            agent_id="agent-alpha",
            required_trust_level=TrustLevel.L2_SUGGEST,
            budget_category="llm-calls",
            budget_amount=2.5,
            data_type="user_profile",
            purpose="personalisation",
            action_type="llm_completion",
            resource="gpt-4o",
        )
    )
    print(f"  allowed: {decision.allowed}")
    print(f"  outcome: {decision.outcome}")
    for reason in decision.reasons:
        print(f"  - {reason}")

    print()
    print("=== Example 2: Denied — trust too low ===")
    decision2 = await engine.evaluate(
        GovernanceAction(
            agent_id="agent-beta",
            required_trust_level=TrustLevel.L3_ACT_APPROVE,
            action_type="file_write",
            resource="/etc/config",
        )
    )
    print(f"  allowed: {decision2.allowed}")
    print(f"  outcome: {decision2.outcome}")
    for reason in decision2.reasons:
        print(f"  - {reason}")

    print()
    print("=== Example 3: Denied — consent not granted ===")
    decision3 = await engine.evaluate(
        GovernanceAction(
            agent_id="agent-alpha",
            data_type="financial_records",
            purpose="reporting",
            action_type="data_read",
        )
    )
    print(f"  allowed: {decision3.allowed}")
    print(f"  outcome: {decision3.outcome}")
    for reason in decision3.reasons:
        print(f"  - {reason}")

    # ------------------------------------------------------------------ #
    # 4. Query the audit log
    # ------------------------------------------------------------------ #
    print()
    print("=== Audit log summary ===")
    all_results = engine.audit.query()
    stats = aggregate_outcomes(all_results.records)
    print(f"  total: {stats['total']}")
    print(f"  allow: {stats['allow']}")
    print(f"  deny:  {stats['deny']}")
    print(f"  denial_rate: {stats['denial_rate']:.0%}")

    denied_results = engine.audit.query(AuditFilter(outcome=GovernanceOutcome.DENY))
    print(f"\n  Denied records ({denied_results.total_matched}):")
    for record in denied_results.records:
        agent = record.context.agent_id if record.context else "unknown"
        print(f"    [{record.record_id[:8]}] agent={agent} — {record.decision}")

    # ------------------------------------------------------------------ #
    # 5. Demonstrate evaluate_sync
    # ------------------------------------------------------------------ #
    print()
    print("=== Example 4: Synchronous evaluation ===")
    sync_decision = engine.evaluate_sync(
        GovernanceAction(
            agent_id="agent-alpha",
            required_trust_level=TrustLevel.L2_SUGGEST,
            action_type="health_check",
        )
    )
    print(f"  allowed: {sync_decision.allowed}")
    print(f"  audit_record_id: {sync_decision.audit_record_id}")


if __name__ == "__main__":
    asyncio.run(main())
