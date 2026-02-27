# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
Compliance evidence auto-generator for AumOS audit records.

Generates structured compliance evidence reports from audit records,
mapping governance decisions to specific compliance standard requirements.

Supported standards:
- SOC 2 (Trust Services Criteria)
- GDPR Article 30 (Records of Processing Activities)
- ISO 27001 (Information Security Management)

This module is recording-only — it reads existing audit records and
produces evidence reports. It does not perform anomaly detection,
counterfactual analysis, or real-time alerting.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from audit_trail.types import AuditRecord


# ---------------------------------------------------------------------------
# Supported compliance standards
# ---------------------------------------------------------------------------

ComplianceStandard = Literal["soc2", "gdpr_article_30", "iso_27001"]

SUPPORTED_STANDARDS: frozenset[str] = frozenset({"soc2", "gdpr_article_30", "iso_27001"})


# ---------------------------------------------------------------------------
# Evidence models
# ---------------------------------------------------------------------------


class ControlEvidence(BaseModel, frozen=True):
    """Evidence mapping for a single compliance control."""

    control_id: str = Field(..., description="Identifier of the compliance control.")
    control_name: str = Field(..., description="Human-readable name of the control.")
    description: str = Field(..., description="What this evidence demonstrates.")
    record_count: int = Field(
        ..., ge=0, description="Number of audit records supporting this control."
    )
    sample_record_ids: list[str] = Field(
        default_factory=list,
        description="IDs of sample records that serve as evidence (max 5).",
    )


class EvidenceSummary(BaseModel, frozen=True):
    """High-level summary of the compliance evidence report."""

    standard: str = Field(..., description="Compliance standard identifier.")
    standard_name: str = Field(..., description="Human-readable standard name.")
    total_records_analysed: int = Field(..., ge=0)
    total_controls_covered: int = Field(..., ge=0)
    total_controls_with_evidence: int = Field(..., ge=0)
    period_start_iso: str = Field(..., description="ISO 8601 start of the evidence period.")
    period_end_iso: str = Field(..., description="ISO 8601 end of the evidence period.")
    generated_at_iso: str = Field(..., description="ISO 8601 timestamp of report generation.")


class ComplianceEvidence(BaseModel, frozen=True):
    """
    Complete compliance evidence report.

    Maps audit records to compliance standard controls, providing
    structured evidence that governance decisions are being recorded
    and enforced.
    """

    summary: EvidenceSummary
    controls: list[ControlEvidence]


# ---------------------------------------------------------------------------
# Standard-specific control mappings
# ---------------------------------------------------------------------------

_SOC2_CONTROLS: list[tuple[str, str, str]] = [
    (
        "CC6.1",
        "Logical and Physical Access Controls",
        "Trust level checks demonstrate access control enforcement for agent actions.",
    ),
    (
        "CC6.3",
        "Role-Based Access and Least Privilege",
        "Agent trust level assignments enforce minimum-privilege for each scope.",
    ),
    (
        "CC7.2",
        "Monitoring of System Components",
        "Audit records provide continuous monitoring of agent governance decisions.",
    ),
    (
        "CC7.3",
        "Detection of Unauthorized Activities",
        "Denied actions in audit trail demonstrate detection of unauthorized attempts.",
    ),
    (
        "CC8.1",
        "Change Management",
        "Trust level change records provide evidence of controlled agent capability changes.",
    ),
    (
        "CC4.1",
        "Monitoring Activities",
        "Hash-chained audit log provides tamper-evident monitoring of all agent decisions.",
    ),
]

_GDPR_CONTROLS: list[tuple[str, str, str]] = [
    (
        "Art30.1(a)",
        "Controller Identity",
        "Agent identity (agent_id) is recorded for every governance decision.",
    ),
    (
        "Art30.1(b)",
        "Purposes of Processing",
        "Action field records the purpose of each agent operation.",
    ),
    (
        "Art30.1(d)",
        "Time Limits for Erasure",
        "Timestamps on all records enable retention policy enforcement.",
    ),
    (
        "Art30.1(g)",
        "Technical and Organisational Measures",
        "Hash-chain integrity and trust level enforcement demonstrate security measures.",
    ),
    (
        "Art30.2",
        "Processor Records",
        "Complete decision trail with agent_id, action, and outcome fields.",
    ),
]

_ISO27001_CONTROLS: list[tuple[str, str, str]] = [
    (
        "A.9.2.3",
        "Management of Privileged Access Rights",
        "Trust level assignments manage and restrict agent privileged operations.",
    ),
    (
        "A.9.4.1",
        "Information Access Restriction",
        "Budget and trust checks restrict agent access based on governance policy.",
    ),
    (
        "A.12.4.1",
        "Event Logging",
        "Every governance decision is recorded with full context in the audit trail.",
    ),
    (
        "A.12.4.2",
        "Protection of Log Information",
        "SHA-256 hash chain ensures tamper-evidence of audit records.",
    ),
    (
        "A.12.4.3",
        "Administrator and Operator Logs",
        "Trust assignments record the operator who made each change.",
    ),
    (
        "A.18.1.3",
        "Protection of Records",
        "Immutable hash-chained records ensure integrity of governance evidence.",
    ),
]

_STANDARD_CONFIGS: dict[str, tuple[str, list[tuple[str, str, str]]]] = {
    "soc2": ("SOC 2 Type II — Trust Services Criteria", _SOC2_CONTROLS),
    "gdpr_article_30": ("GDPR Article 30 — Records of Processing Activities", _GDPR_CONTROLS),
    "iso_27001": ("ISO 27001 — Information Security Management", _ISO27001_CONTROLS),
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _ms_to_iso(timestamp_str: str) -> str:
    """Pass through ISO timestamp strings from audit records."""
    return timestamp_str


def _get_sample_ids(records: list[AuditRecord], max_samples: int = 5) -> list[str]:
    """Extract up to max_samples record IDs from a list of records."""
    return [record.id for record in records[:max_samples]]


def _records_with_denied(records: list[AuditRecord]) -> list[AuditRecord]:
    """Filter to only denied (not permitted) records."""
    return [r for r in records if not r.permitted]


def _records_with_trust_info(records: list[AuditRecord]) -> list[AuditRecord]:
    """Filter to records that include trust level information."""
    return [r for r in records if r.trust_level is not None]


def _records_with_budget_info(records: list[AuditRecord]) -> list[AuditRecord]:
    """Filter to records that include budget information."""
    return [r for r in records if r.budget_used is not None]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def generate_evidence(
    records: list[AuditRecord],
    standard: str,
    now_iso: str | None = None,
) -> ComplianceEvidence:
    """
    Generate a compliance evidence report from audit records.

    Analyses the provided records against the controls of the specified
    compliance standard and produces a structured evidence report.

    Args:
        records:  List of AuditRecord instances to analyse.
        standard: Compliance standard identifier. One of:
                  ``"soc2"``, ``"gdpr_article_30"``, ``"iso_27001"``.
        now_iso:  Optional ISO 8601 timestamp for report generation time.
                  Defaults to current UTC time.

    Returns:
        A ComplianceEvidence report with summary and per-control evidence.

    Raises:
        ValueError: If the standard is not supported.
    """
    if standard not in SUPPORTED_STANDARDS:
        raise ValueError(
            f"Unsupported compliance standard: {standard!r}. "
            f"Supported: {', '.join(sorted(SUPPORTED_STANDARDS))}"
        )

    if now_iso is None:
        now_iso = datetime.now(tz=timezone.utc).isoformat()

    standard_name, controls_spec = _STANDARD_CONFIGS[standard]

    # Determine the evidence period from record timestamps
    if records:
        timestamps = [r.timestamp for r in records]
        period_start = min(timestamps)
        period_end = max(timestamps)
    else:
        period_start = now_iso
        period_end = now_iso

    # Pre-compute filtered record sets
    denied_records = _records_with_denied(records)
    trust_records = _records_with_trust_info(records)

    # Map control IDs to relevant records based on the control type
    controls: list[ControlEvidence] = []
    controls_with_evidence = 0

    for control_id, control_name, description in controls_spec:
        # Determine which records are relevant for this specific control
        relevant: list[AuditRecord]
        if "denied" in description.lower() or "unauthorized" in description.lower():
            relevant = denied_records
        elif "trust" in description.lower() or "access" in description.lower():
            relevant = trust_records if trust_records else records
        else:
            relevant = records

        if relevant:
            controls_with_evidence += 1

        controls.append(
            ControlEvidence(
                control_id=control_id,
                control_name=control_name,
                description=description,
                record_count=len(relevant),
                sample_record_ids=_get_sample_ids(relevant),
            )
        )

    summary = EvidenceSummary(
        standard=standard,
        standard_name=standard_name,
        total_records_analysed=len(records),
        total_controls_covered=len(controls),
        total_controls_with_evidence=controls_with_evidence,
        period_start_iso=period_start,
        period_end_iso=period_end,
        generated_at_iso=now_iso,
    )

    return ComplianceEvidence(summary=summary, controls=controls)


def export_evidence_json(evidence: ComplianceEvidence) -> str:
    """Export a ComplianceEvidence report to a JSON string."""
    return evidence.model_dump_json(indent=2)


def export_evidence_markdown(evidence: ComplianceEvidence) -> str:
    """Export a ComplianceEvidence report to a human-readable Markdown string."""
    lines: list[str] = []

    lines.append(f"# Compliance Evidence Report: {evidence.summary.standard_name}")
    lines.append("")
    lines.append(f"**Generated:** {evidence.summary.generated_at_iso}")
    lines.append(
        f"**Period:** {evidence.summary.period_start_iso} to {evidence.summary.period_end_iso}"
    )
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- **Standard:** {evidence.summary.standard_name}")
    lines.append(f"- **Records analysed:** {evidence.summary.total_records_analysed}")
    lines.append(f"- **Controls covered:** {evidence.summary.total_controls_covered}")
    lines.append(
        f"- **Controls with evidence:** {evidence.summary.total_controls_with_evidence}"
    )
    lines.append("")
    lines.append("## Control Evidence")
    lines.append("")

    for control in evidence.controls:
        has_evidence = "Yes" if control.record_count > 0 else "No"
        lines.append(f"### {control.control_id} — {control.control_name}")
        lines.append("")
        lines.append(f"- **Evidence available:** {has_evidence}")
        lines.append(f"- **Supporting records:** {control.record_count}")
        lines.append(f"- **Description:** {control.description}")
        if control.sample_record_ids:
            lines.append(f"- **Sample records:** {', '.join(control.sample_record_ids)}")
        lines.append("")

    return "\n".join(lines)
