# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
Multi-agent governance example.

Demonstrates how a shared GovernanceEngine instance manages trust levels,
budgets, and consent for multiple agents operating simultaneously, and how
scoped trust assignments allow different permissions in different contexts.

Run with:
    python examples/multi_agent.py
"""
from __future__ import annotations

import asyncio

from aumos_governance import (
    AuditFilter,
    GovernanceAction,
    GovernanceEngine,
    TrustLevel,
)
from aumos_governance.config import BudgetConfig, ConsentConfig, GovernanceConfig
from aumos_governance.trust.manager import SetLevelOptions


async def demonstrate_scoped_trust(engine: GovernanceEngine) -> None:
    """Show how scoped trust assignments work."""
    print("=== Scoped Trust ===")

    # agent-scope has L2 globally but L4 within the 'reports' scope.
    engine.trust.set_level(
        "agent-scope",
        TrustLevel.L2_SUGGEST,
        options=SetLevelOptions(assigned_by="admin"),
    )
    engine.trust.set_level(
        "agent-scope",
        TrustLevel.L4_ACT_REPORT,
        scope="reports",
        options=SetLevelOptions(assigned_by="reports-admin"),
    )

    global_level = engine.trust.get_level("agent-scope")
    scoped_level = engine.trust.get_level("agent-scope", scope="reports")
    print(f"  Global level:  {global_level.label()} ({int(global_level)})")
    print(f"  Reports scope: {scoped_level.label()} ({int(scoped_level)})")

    # Action requiring L4 in 'reports' scope — should pass.
    decision = await engine.evaluate(
        GovernanceAction(
            agent_id="agent-scope",
            required_trust_level=TrustLevel.L4_ACT_REPORT,
            scope="reports",
            action_type="report_generation",
        )
    )
    print(f"  L4 action in reports scope: {'ALLOWED' if decision.allowed else 'DENIED'}")

    # Same action without scope — should fail (only L2 globally).
    decision2 = await engine.evaluate(
        GovernanceAction(
            agent_id="agent-scope",
            required_trust_level=TrustLevel.L4_ACT_REPORT,
            action_type="report_generation",
        )
    )
    print(f"  L4 action globally:         {'ALLOWED' if decision2.allowed else 'DENIED'}")


async def demonstrate_budget_sharing(engine: GovernanceEngine) -> None:
    """Show multiple agents drawing from a shared budget."""
    print("\n=== Shared Budget ===")

    engine.budget.create_budget("shared-pool", limit=10.0, period="monthly")

    agents = ["agent-1", "agent-2", "agent-3"]
    for agent_id in agents:
        engine.trust.set_level(agent_id, TrustLevel.L3_ACT_APPROVE)

    results = []
    for agent_id in agents:
        decision = await engine.evaluate(
            GovernanceAction(
                agent_id=agent_id,
                budget_category="shared-pool",
                budget_amount=3.0,
                action_type="llm_call",
            )
        )
        results.append((agent_id, decision.allowed))
        if decision.allowed:
            engine.budget.record_spending(
                "shared-pool", 3.0, description=f"{agent_id} llm call"
            )

    for agent_id, allowed in results:
        status = "ALLOWED" if allowed else "DENIED (budget)"
        print(f"  {agent_id}: {status}")

    summary = engine.budget.summary()
    for envelope in summary:
        if envelope["category"] == "shared-pool":
            print(
                f"  Budget utilisation: {envelope['spent']:.1f} / "
                f"{envelope['effective_limit']:.1f} "
                f"({envelope['utilization']:.0%})"
            )


async def demonstrate_consent_matrix(engine: GovernanceEngine) -> None:
    """Show different consent grants for different agent/purpose combinations."""
    print("\n=== Consent Matrix ===")

    # agent-analyst can access analytics data for any purpose.
    engine.consent.record_consent(
        agent_id="agent-analyst",
        data_type="analytics",
        purpose=None,  # blanket — covers all purposes
        granted_by="data-governance-team",
    )

    # agent-support can access user_profile only for 'ticket_resolution'.
    engine.consent.record_consent(
        agent_id="agent-support",
        data_type="user_profile",
        purpose="ticket_resolution",
        granted_by="support-lead",
    )

    engine.trust.set_level("agent-analyst", TrustLevel.L3_ACT_APPROVE)
    engine.trust.set_level("agent-support", TrustLevel.L3_ACT_APPROVE)

    checks = [
        ("agent-analyst", "analytics", "reporting"),
        ("agent-analyst", "analytics", "model_training"),
        ("agent-support", "user_profile", "ticket_resolution"),
        ("agent-support", "user_profile", "marketing"),  # no consent
        ("agent-support", "financial_records", "ticket_resolution"),  # no consent
    ]

    for agent_id, data_type, purpose in checks:
        result = engine.consent.check_consent(agent_id, data_type, purpose)
        status = "GRANTED" if result.granted else "DENIED "
        print(f"  [{status}] {agent_id} -> {data_type} ({purpose})")


async def demonstrate_audit_query(engine: GovernanceEngine) -> None:
    """Show audit log querying capabilities."""
    print("\n=== Audit Query ===")

    all_records = engine.audit.query()
    print(f"  Total audit records: {all_records.total_matched}")

    from aumos_governance import GovernanceOutcome, aggregate_outcomes

    stats = aggregate_outcomes(all_records.records)
    print(f"  Allow: {stats['allow']}  Deny: {stats['deny']}  "
          f"Denial rate: {stats['denial_rate']:.0%}")

    analyst_records = engine.audit.query(AuditFilter(agent_id="agent-analyst"))
    print(f"  Records for agent-analyst: {analyst_records.total_matched}")

    denied_records = engine.audit.query(
        AuditFilter(outcome=GovernanceOutcome.DENY, limit=5)
    )
    print(f"  Most recent denied (up to 5):")
    for record in denied_records.records:
        agent = record.context.agent_id if record.context else "unknown"
        print(f"    {record.timestamp.strftime('%H:%M:%S')} | {agent} | {record.decision}")


async def main() -> None:
    engine = GovernanceEngine(
        config=GovernanceConfig(
            consent=ConsentConfig(default_deny=True),
            budget=BudgetConfig(allow_overdraft=False),
        )
    )

    await demonstrate_scoped_trust(engine)
    await demonstrate_budget_sharing(engine)
    await demonstrate_consent_matrix(engine)
    await demonstrate_audit_query(engine)

    print(f"\nDone. {engine.audit.count()} total audit records written.")


if __name__ == "__main__":
    asyncio.run(main())
