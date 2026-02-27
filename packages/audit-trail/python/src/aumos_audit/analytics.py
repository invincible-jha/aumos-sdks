# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
Pre-built analytics dashboard data for AumOS audit records.

Computes static, aggregate metrics from audit records for dashboard
consumption. All analytics are purely descriptive — this module does
NOT perform anomaly detection, predictive analytics, or real-time alerting.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from audit_trail.types import AuditRecord


# ---------------------------------------------------------------------------
# Dashboard data models
# ---------------------------------------------------------------------------


class DailyDecisionCount(BaseModel, frozen=True):
    """Number of governance decisions on a specific date."""

    date: str = Field(..., description="Date in YYYY-MM-DD format.")
    count: int = Field(..., ge=0, description="Number of decisions on this date.")


class ActionDenialEntry(BaseModel, frozen=True):
    """An action and its denial count."""

    action: str = Field(..., description="The action that was denied.")
    denial_count: int = Field(..., ge=0, description="Number of times this action was denied.")


class TrustLevelCount(BaseModel, frozen=True):
    """Count of decisions made at a specific trust level."""

    trust_level: int = Field(..., ge=0, le=5, description="Trust level [0, 5].")
    count: int = Field(..., ge=0, description="Number of decisions at this trust level.")


class DecisionRatio(BaseModel, frozen=True):
    """Ratio of allowed vs denied decisions."""

    total: int = Field(..., ge=0, description="Total number of decisions.")
    allowed: int = Field(..., ge=0, description="Number of permitted decisions.")
    denied: int = Field(..., ge=0, description="Number of denied decisions.")
    allow_rate: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Fraction of decisions that were permitted (0.0–1.0).",
    )
    deny_rate: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Fraction of decisions that were denied (0.0–1.0).",
    )


class AgentActivityEntry(BaseModel, frozen=True):
    """Activity count for a specific agent."""

    agent_id: str = Field(..., description="Agent identifier.")
    decision_count: int = Field(..., ge=0, description="Number of decisions for this agent.")
    denial_count: int = Field(..., ge=0, description="Number of denied decisions for this agent.")


class DashboardData(BaseModel, frozen=True):
    """
    Pre-computed analytics data for dashboard display.

    All metrics are static aggregates of the provided audit records.
    This data structure is JSON-serialisable for direct consumption
    by frontend dashboards.
    """

    generated_at_iso: str = Field(..., description="ISO 8601 report generation timestamp.")
    total_decisions: int = Field(..., ge=0)
    decision_ratio: DecisionRatio
    decisions_per_day: list[DailyDecisionCount]
    top_denied_actions: list[ActionDenialEntry]
    trust_level_distribution: list[TrustLevelCount]
    top_agents_by_activity: list[AgentActivityEntry]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _parse_date(timestamp_str: str) -> str:
    """Extract a YYYY-MM-DD date string from an ISO 8601 timestamp."""
    # Handle common ISO formats: "2026-01-15T10:30:00Z" or "2026-01-15T10:30:00+00:00"
    return timestamp_str[:10]


def _compute_decision_ratio(records: list[AuditRecord]) -> DecisionRatio:
    """Compute the allow/deny ratio from a list of records."""
    total = len(records)
    allowed = sum(1 for r in records if r.permitted)
    denied = total - allowed

    if total > 0:
        allow_rate = round(allowed / total, 4)
        deny_rate = round(denied / total, 4)
    else:
        allow_rate = 0.0
        deny_rate = 0.0

    return DecisionRatio(
        total=total,
        allowed=allowed,
        denied=denied,
        allow_rate=allow_rate,
        deny_rate=deny_rate,
    )


def _compute_decisions_per_day(records: list[AuditRecord]) -> list[DailyDecisionCount]:
    """Aggregate decisions by date, sorted chronologically."""
    date_counts: Counter[str] = Counter()
    for record in records:
        date_str = _parse_date(record.timestamp)
        date_counts[date_str] += 1

    return [
        DailyDecisionCount(date=date, count=count)
        for date, count in sorted(date_counts.items())
    ]


def _compute_top_denied_actions(
    records: list[AuditRecord],
    limit: int = 10,
) -> list[ActionDenialEntry]:
    """Compute the most frequently denied actions."""
    denial_counts: Counter[str] = Counter()
    for record in records:
        if not record.permitted:
            denial_counts[record.action] += 1

    return [
        ActionDenialEntry(action=action, denial_count=count)
        for action, count in denial_counts.most_common(limit)
    ]


def _compute_trust_level_distribution(records: list[AuditRecord]) -> list[TrustLevelCount]:
    """Compute the distribution of decisions across trust levels."""
    level_counts: Counter[int] = Counter()
    for record in records:
        if record.trust_level is not None:
            level_counts[record.trust_level] += 1

    return [
        TrustLevelCount(trust_level=level, count=count)
        for level, count in sorted(level_counts.items())
    ]


def _compute_agent_activity(
    records: list[AuditRecord],
    limit: int = 10,
) -> list[AgentActivityEntry]:
    """Compute per-agent activity counts, sorted by total activity descending."""
    agent_decisions: Counter[str] = Counter()
    agent_denials: Counter[str] = Counter()

    for record in records:
        agent_decisions[record.agent_id] += 1
        if not record.permitted:
            agent_denials[record.agent_id] += 1

    return [
        AgentActivityEntry(
            agent_id=agent_id,
            decision_count=count,
            denial_count=agent_denials.get(agent_id, 0),
        )
        for agent_id, count in agent_decisions.most_common(limit)
    ]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def generate_dashboard_data(
    records: list[AuditRecord],
    top_denied_limit: int = 10,
    top_agents_limit: int = 10,
    now_iso: str | None = None,
) -> DashboardData:
    """
    Generate pre-computed analytics data from audit records for dashboard display.

    All metrics are static aggregates — no anomaly detection, no predictive
    analytics, no real-time alerting.

    Args:
        records:            List of AuditRecord instances to analyse.
        top_denied_limit:   Maximum number of top denied actions to include.
        top_agents_limit:   Maximum number of top agents to include.
        now_iso:            Optional ISO 8601 timestamp for report generation.
                            Defaults to current UTC time.

    Returns:
        A DashboardData instance containing all pre-computed metrics,
        serialisable to JSON for dashboard consumption.
    """
    if now_iso is None:
        now_iso = datetime.now(tz=timezone.utc).isoformat()

    return DashboardData(
        generated_at_iso=now_iso,
        total_decisions=len(records),
        decision_ratio=_compute_decision_ratio(records),
        decisions_per_day=_compute_decisions_per_day(records),
        top_denied_actions=_compute_top_denied_actions(records, limit=top_denied_limit),
        trust_level_distribution=_compute_trust_level_distribution(records),
        top_agents_by_activity=_compute_agent_activity(records, limit=top_agents_limit),
    )


def export_dashboard_json(data: DashboardData) -> str:
    """Export DashboardData to a JSON string for frontend consumption."""
    return data.model_dump_json(indent=2)
