# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

from __future__ import annotations

import math
from datetime import datetime, timezone
from uuid import uuid4

from budget_enforcer.types import (
    PERIOD_SECONDS,
    EnvelopeConfig,
    Period,
    SpendingEnvelope,
)


def create_envelope(config: EnvelopeConfig) -> SpendingEnvelope:
    """
    Build a new SpendingEnvelope from caller-supplied config.
    Validates inputs via Pydantic before constructing the envelope.
    """
    validated = EnvelopeConfig.model_validate(config if isinstance(config, dict) else config.model_dump())
    return SpendingEnvelope(
        id=validated.id if validated.id is not None else str(uuid4()),
        category=validated.category,
        limit=validated.limit,
        period=validated.period,
        spent=0.0,
        committed=0.0,
        period_start=datetime.now(tz=timezone.utc),
        suspended=False,
    )


def period_duration_seconds(period: Period) -> float:
    """
    Return how many seconds the given period spans.
    Returns math.inf for 'total' (never resets).
    """
    if period == "total":
        return math.inf
    return float(PERIOD_SECONDS[period])


def is_period_expired(envelope: SpendingEnvelope, now: datetime | None = None) -> bool:
    """Determine whether an envelope's period window has elapsed."""
    if envelope.period == "total":
        return False
    if now is None:
        now = datetime.now(tz=timezone.utc)
    period_start = envelope.period_start
    if period_start.tzinfo is None:
        period_start = period_start.replace(tzinfo=timezone.utc)
    elapsed = (now - period_start).total_seconds()
    return elapsed >= PERIOD_SECONDS[envelope.period]


def refresh_envelope_period(envelope: SpendingEnvelope, now: datetime | None = None) -> None:
    """
    Reset an envelope's accumulators and advance period_start if the current
    window has elapsed.

    Mutates the envelope in place — callers must re-persist it.
    The 'total' period never resets.
    """
    if envelope.period == "total":
        return
    if now is None:
        now = datetime.now(tz=timezone.utc)
    period_start = envelope.period_start
    if period_start.tzinfo is None:
        period_start = period_start.replace(tzinfo=timezone.utc)

    duration_seconds = PERIOD_SECONDS[envelope.period]
    elapsed = (now - period_start).total_seconds()

    if elapsed < duration_seconds:
        return

    # Step periodStart forward by whole periods to avoid drift.
    periods_elapsed = int(elapsed // duration_seconds)
    from datetime import timedelta

    new_start = period_start + timedelta(seconds=periods_elapsed * duration_seconds)

    envelope.spent = 0.0
    envelope.committed = 0.0
    envelope.period_start = new_start


def available_balance(envelope: SpendingEnvelope) -> float:
    """Compute how much of the limit remains available for new spending."""
    return max(0.0, envelope.limit - envelope.spent - envelope.committed)


def utilization_percent(envelope: SpendingEnvelope) -> float:
    """Compute utilization as a percentage (0–100+)."""
    if envelope.limit == 0:
        return 100.0
    return ((envelope.spent + envelope.committed) / envelope.limit) * 100.0
