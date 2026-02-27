# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
Trust level audit report generator.

Produces structured audit reports from a list of TrustAssignment records,
including summary statistics, level distributions, time-at-level metrics,
and change history timelines. All data is read-only — this module does not
modify assignments or perform any automatic trust progression.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from .levels import TrustLevel, TRUST_LEVEL_DESCRIPTIONS, trust_level_name
from .types import TrustAssignment


# ---------------------------------------------------------------------------
# Report models
# ---------------------------------------------------------------------------


class LevelDistribution(BaseModel, frozen=True):
    """Count of agents at each trust level."""

    level: int = Field(..., ge=0, le=5, description="Trust level integer [0, 5].")
    level_name: str = Field(..., description="Human-readable name for the level.")
    count: int = Field(..., ge=0, description="Number of agents at this level.")
    percentage: float = Field(
        ...,
        ge=0.0,
        le=100.0,
        description="Percentage of total assignments at this level.",
    )


class TimeAtLevelMetric(BaseModel, frozen=True):
    """Time-at-level metric for a single agent-scope assignment."""

    agent_id: str = Field(..., description="Agent identifier.")
    scope: str = Field(..., description="Scope of the assignment.")
    assigned_level: int = Field(..., ge=0, le=5, description="Currently assigned level.")
    assigned_at_iso: str = Field(..., description="ISO 8601 timestamp of assignment.")
    duration_seconds: int = Field(
        ...,
        ge=0,
        description="Seconds elapsed since assignment was made.",
    )


class AssignmentEntry(BaseModel, frozen=True):
    """A single entry in the change history timeline."""

    agent_id: str
    scope: str
    assigned_level: int = Field(..., ge=0, le=5)
    level_name: str
    assigned_at_iso: str
    reason: str | None = None
    assigned_by: str | None = None


class ReportSummary(BaseModel, frozen=True):
    """High-level summary statistics for the audit report."""

    total_assignments: int = Field(..., ge=0)
    unique_agents: int = Field(..., ge=0)
    unique_scopes: int = Field(..., ge=0)
    highest_level_assigned: int = Field(..., ge=0, le=5)
    lowest_level_assigned: int = Field(..., ge=0, le=5)
    generated_at_iso: str = Field(..., description="ISO 8601 timestamp when report was generated.")


class TrustAuditReport(BaseModel, frozen=True):
    """
    Complete trust audit report.

    Contains summary statistics, level distribution, time-at-level metrics,
    and a chronological assignment timeline.
    """

    summary: ReportSummary
    level_distribution: list[LevelDistribution]
    time_at_level: list[TimeAtLevelMetric]
    assignment_timeline: list[AssignmentEntry]


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------


def _ms_to_iso(timestamp_ms: int) -> str:
    """Convert a millisecond Unix timestamp to an ISO 8601 string."""
    return datetime.fromtimestamp(timestamp_ms / 1000.0, tz=timezone.utc).isoformat()


def _current_time_ms() -> int:
    """Return the current time in milliseconds since the Unix epoch."""
    return int(datetime.now(tz=timezone.utc).timestamp() * 1000)


def generate_trust_audit_report(
    assignments: list[TrustAssignment],
    now_ms: int | None = None,
) -> TrustAuditReport:
    """
    Generate a structured trust audit report from a list of trust assignments.

    This function is purely analytical — it reads assignment data and produces
    a report. It does not modify any assignments or trigger trust changes.

    Args:
        assignments: List of TrustAssignment records to analyse.
        now_ms:      Optional current time in ms since Unix epoch.
                     Defaults to the actual current wall-clock time.

    Returns:
        A TrustAuditReport containing summary, distribution, time metrics,
        and a chronological assignment timeline.
    """
    if now_ms is None:
        now_ms = _current_time_ms()

    generated_at = _ms_to_iso(now_ms)

    # --- Summary ---
    unique_agents: set[str] = set()
    unique_scopes: set[str] = set()
    level_counter: Counter[int] = Counter()

    for assignment in assignments:
        unique_agents.add(assignment.agent_id)
        unique_scopes.add(assignment.scope)
        level_counter[assignment.assigned_level.value] += 1

    highest_level = max(level_counter.keys()) if level_counter else 0
    lowest_level = min(level_counter.keys()) if level_counter else 0

    summary = ReportSummary(
        total_assignments=len(assignments),
        unique_agents=len(unique_agents),
        unique_scopes=len(unique_scopes),
        highest_level_assigned=highest_level,
        lowest_level_assigned=lowest_level,
        generated_at_iso=generated_at,
    )

    # --- Level distribution ---
    total = len(assignments) if assignments else 1  # avoid division by zero
    level_distribution: list[LevelDistribution] = []
    for level_int in range(6):
        count = level_counter.get(level_int, 0)
        percentage = round((count / total) * 100.0, 2) if assignments else 0.0
        level_distribution.append(
            LevelDistribution(
                level=level_int,
                level_name=trust_level_name(level_int),
                count=count,
                percentage=percentage,
            )
        )

    # --- Time at level ---
    time_at_level: list[TimeAtLevelMetric] = []
    for assignment in assignments:
        duration_ms = max(0, now_ms - assignment.assigned_at)
        duration_seconds = duration_ms // 1000
        time_at_level.append(
            TimeAtLevelMetric(
                agent_id=assignment.agent_id,
                scope=assignment.scope,
                assigned_level=assignment.assigned_level.value,
                assigned_at_iso=_ms_to_iso(assignment.assigned_at),
                duration_seconds=duration_seconds,
            )
        )

    # --- Assignment timeline (chronological) ---
    sorted_assignments = sorted(assignments, key=lambda a: a.assigned_at)
    assignment_timeline: list[AssignmentEntry] = []
    for assignment in sorted_assignments:
        assignment_timeline.append(
            AssignmentEntry(
                agent_id=assignment.agent_id,
                scope=assignment.scope,
                assigned_level=assignment.assigned_level.value,
                level_name=trust_level_name(assignment.assigned_level.value),
                assigned_at_iso=_ms_to_iso(assignment.assigned_at),
                reason=assignment.reason,
                assigned_by=assignment.assigned_by,
            )
        )

    return TrustAuditReport(
        summary=summary,
        level_distribution=level_distribution,
        time_at_level=time_at_level,
        assignment_timeline=assignment_timeline,
    )


# ---------------------------------------------------------------------------
# Export helpers
# ---------------------------------------------------------------------------


def export_report_json(report: TrustAuditReport) -> str:
    """
    Export a TrustAuditReport to a JSON string with 2-space indentation.

    Returns:
        A JSON string representation of the full report.
    """
    return report.model_dump_json(indent=2)


def export_report_markdown(report: TrustAuditReport) -> str:
    """
    Export a TrustAuditReport to a human-readable Markdown string.

    Returns:
        A Markdown-formatted string suitable for documentation or review.
    """
    lines: list[str] = []

    lines.append("# Trust Audit Report")
    lines.append("")
    lines.append(f"**Generated:** {report.summary.generated_at_iso}")
    lines.append("")

    # Summary
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- **Total assignments:** {report.summary.total_assignments}")
    lines.append(f"- **Unique agents:** {report.summary.unique_agents}")
    lines.append(f"- **Unique scopes:** {report.summary.unique_scopes}")
    lines.append(
        f"- **Highest level assigned:** L{report.summary.highest_level_assigned}"
    )
    lines.append(
        f"- **Lowest level assigned:** L{report.summary.lowest_level_assigned}"
    )
    lines.append("")

    # Level distribution
    lines.append("## Level Distribution")
    lines.append("")
    lines.append("| Level | Name | Count | Percentage |")
    lines.append("|------:|------|------:|-----------:|")
    for dist in report.level_distribution:
        lines.append(
            f"| L{dist.level} | {dist.level_name} | {dist.count} | {dist.percentage}% |"
        )
    lines.append("")

    # Time at level
    lines.append("## Time at Level")
    lines.append("")
    lines.append("| Agent | Scope | Level | Assigned At | Duration (s) |")
    lines.append("|-------|-------|------:|-------------|-------------:|")
    for metric in report.time_at_level:
        lines.append(
            f"| {metric.agent_id} | {metric.scope} | L{metric.assigned_level} "
            f"| {metric.assigned_at_iso} | {metric.duration_seconds} |"
        )
    lines.append("")

    # Timeline
    lines.append("## Assignment Timeline")
    lines.append("")
    for entry in report.assignment_timeline:
        by_text = f" by {entry.assigned_by}" if entry.assigned_by else ""
        reason_text = f" — {entry.reason}" if entry.reason else ""
        lines.append(
            f"- **{entry.assigned_at_iso}** — `{entry.agent_id}` "
            f"assigned L{entry.assigned_level} ({entry.level_name}) "
            f"in scope `{entry.scope}`{by_text}{reason_text}"
        )
    lines.append("")

    return "\n".join(lines)
