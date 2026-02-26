# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

from __future__ import annotations

from budget_enforcer.envelope import available_balance, utilization_percent
from budget_enforcer.types import BudgetUtilization, SpendingEnvelope


def build_utilization(envelope: SpendingEnvelope) -> BudgetUtilization:
    """
    Derive a BudgetUtilization snapshot from a live envelope.

    The snapshot is point-in-time — callers should refresh the period before
    calling this if they need current-period values.
    """
    return BudgetUtilization(
        category=envelope.category,
        envelope_id=envelope.id,
        limit=envelope.limit,
        spent=envelope.spent,
        committed=envelope.committed,
        available=available_balance(envelope),
        utilization_percent=utilization_percent(envelope),
        period=envelope.period,
        period_start=envelope.period_start,
        suspended=envelope.suspended,
    )


def build_all_utilizations(
    envelopes: list[SpendingEnvelope],
) -> list[BudgetUtilization]:
    """
    Summarize all envelopes into utilization snapshots, sorted by
    utilization_percent descending (most constrained first).
    """
    return sorted(
        (build_utilization(envelope) for envelope in envelopes),
        key=lambda utilization: utilization.utilization_percent,
        reverse=True,
    )
