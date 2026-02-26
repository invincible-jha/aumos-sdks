# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
basic_logging.py — Demonstrates core AuditLogger usage.

Shows how to:
- Create a logger (defaults to in-memory storage)
- Log governance decisions (permitted and denied)
- Query the log with filters
- Count records

Run: python examples/basic_logging.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Allow running directly from the examples directory.
sys.path.insert(0, str(Path(__file__).parent.parent / "python" / "src"))

from audit_trail import AuditLogger, AuditFilter, GovernanceDecisionInput


async def main() -> None:
    logger = AuditLogger()

    print("=== AumOS Audit Trail — Basic Logging Example ===\n")

    decisions = [
        GovernanceDecisionInput(
            agent_id="agent-crm-001",
            action="read_customer_record",
            permitted=True,
            trust_level=3,
            required_level=2,
            reason="Trust level meets requirement for read access",
        ),
        GovernanceDecisionInput(
            agent_id="agent-crm-001",
            action="export_customer_data",
            permitted=False,
            trust_level=3,
            required_level=5,
            reason="Trust level insufficient for bulk data export",
        ),
        GovernanceDecisionInput(
            agent_id="agent-crm-001",
            action="send_email",
            permitted=True,
            trust_level=3,
            required_level=3,
            budget_used=0.02,
            budget_remaining=9.98,
            reason="Action permitted within budget",
        ),
        GovernanceDecisionInput(
            agent_id="agent-billing-002",
            action="read_invoice",
            permitted=True,
            trust_level=4,
            required_level=2,
            metadata={"invoice_id": "INV-2026-0042"},
        ),
        GovernanceDecisionInput(
            agent_id="agent-billing-002",
            action="issue_refund",
            permitted=False,
            trust_level=4,
            required_level=6,
            reason="Refund issuance requires maximum trust level",
            metadata={"amount": 150.0, "currency": "USD"},
        ),
    ]

    print("Logging decisions...")
    records = []
    for decision in decisions:
        record = await logger.log(decision)
        records.append(record)
        status = "PERMITTED" if record.permitted else "DENIED   "
        print(
            f"  [{status}] {record.agent_id} -> {record.action}"
            f" | hash: {record.record_hash[:16]}..."
        )

    total_count = await logger.count()
    print(f"\nTotal records: {total_count}")

    # Query all denied decisions.
    print("\n--- Denied decisions ---")
    denied = await logger.query(AuditFilter(permitted=False))
    for record in denied:
        print(f"  {record.agent_id} -> {record.action}: {record.reason or 'no reason'}")

    # Query decisions for a specific agent.
    print("\n--- Decisions for agent-crm-001 ---")
    agent_records = await logger.query(AuditFilter(agent_id="agent-crm-001"))
    for record in agent_records:
        marker = "OK" if record.permitted else "NO"
        print(f"  [{marker}] {record.action}")

    # Show the first record's full structure.
    print("\n--- First record (full) ---")
    if records:
        import json
        print(json.dumps(records[0].model_dump(mode="json"), indent=2))


if __name__ == "__main__":
    asyncio.run(main())
