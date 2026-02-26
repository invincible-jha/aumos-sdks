# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
siem_export.py — Demonstrates export to JSON, CSV, and CEF (SIEM) formats.

Shows how to:
- Export the full audit log as JSON
- Export a filtered subset as CSV
- Export to CEF format for Splunk / Elastic ingestion
- Write CEF output to a file suitable for log shipping

Run: python examples/siem_export.py
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "python" / "src"))

from audit_trail import AuditLogger, AuditFilter, GovernanceDecisionInput


async def seed_logger(logger: AuditLogger) -> None:
    """Populate the logger with representative governance decisions."""
    events = [
        GovernanceDecisionInput(
            agent_id="agent-ops-001",
            action="list_ec2_instances",
            permitted=True,
            trust_level=2,
            required_level=1,
        ),
        GovernanceDecisionInput(
            agent_id="agent-ops-001",
            action="terminate_ec2_instance",
            permitted=False,
            trust_level=2,
            required_level=5,
            reason="Destructive action requires elevated trust",
            metadata={"instance_id": "i-0abc123def456"},
        ),
        GovernanceDecisionInput(
            agent_id="agent-ops-001",
            action="read_cloudwatch_logs",
            permitted=True,
            trust_level=2,
            required_level=2,
            budget_used=0.005,
            budget_remaining=49.995,
        ),
        GovernanceDecisionInput(
            agent_id="agent-sec-002",
            action="rotate_iam_credentials",
            permitted=True,
            trust_level=5,
            required_level=4,
            reason="Scheduled rotation approved",
        ),
        GovernanceDecisionInput(
            agent_id="agent-sec-002",
            action="delete_s3_bucket",
            permitted=False,
            trust_level=5,
            required_level=6,
            reason="Deletion of production bucket requires maximum trust level",
            metadata={"bucket": "prod-customer-data"},
        ),
    ]
    for event in events:
        await logger.log(event)


async def main() -> None:
    print("=== AumOS Audit Trail — SIEM Export Example ===\n")

    logger = AuditLogger()
    await seed_logger(logger)

    total = await logger.count()
    print(f"Logged {total} decisions.\n")

    # -------------------------------------------------------------------------
    # JSON export (full log)
    # -------------------------------------------------------------------------
    print("--- JSON export (first 200 characters) ---")
    json_output = await logger.export_records("json")
    print(json_output[:200] + "...\n")

    # -------------------------------------------------------------------------
    # CSV export (denied decisions only)
    # -------------------------------------------------------------------------
    print("--- CSV export (denied decisions only) ---")
    csv_output = await logger.export_records("csv", AuditFilter(permitted=False))
    for line in csv_output.splitlines():
        print(f"  {line}")
    print()

    # -------------------------------------------------------------------------
    # CEF export (all records — Splunk/ELK compatible)
    # -------------------------------------------------------------------------
    print("--- CEF export (all records) ---")
    cef_output = await logger.export_records("cef")
    for line in cef_output.splitlines():
        # Truncate long lines for readability in the terminal.
        display = line if len(line) <= 120 else line[:117] + "..."
        print(f"  {display}")
    print()

    # -------------------------------------------------------------------------
    # Write CEF to a temp file (simulating log-ship handoff)
    # -------------------------------------------------------------------------
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".cef", delete=False, encoding="utf-8"
    ) as cef_file:
        cef_file.write(cef_output)
        cef_path = cef_file.name

    print(f"CEF log written to: {cef_path}")
    print(f"  Lines: {len(cef_output.splitlines())}")
    print(f"  Bytes: {len(cef_output.encode('utf-8'))}")
    print("\nReady for Splunk Universal Forwarder or Elastic Agent ingestion.")


if __name__ == "__main__":
    asyncio.run(main())
