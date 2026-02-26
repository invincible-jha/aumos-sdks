# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

from datetime import datetime, timezone

from aumos_governance.types import TrustLevel


class DecayResult:
    """
    Result of a decay calculation.

    Attributes:
        effective_level: The trust level after applying decay.
        decayed: Whether any decay was applied.
        days_inactive: Number of days since the agent was last active.
    """

    __slots__ = ("effective_level", "decayed", "days_inactive")

    def __init__(
        self,
        effective_level: TrustLevel,
        decayed: bool,
        days_inactive: float,
    ) -> None:
        self.effective_level = effective_level
        self.decayed = decayed
        self.days_inactive = days_inactive

    def __repr__(self) -> str:
        return (
            f"DecayResult(effective_level={self.effective_level!r}, "
            f"decayed={self.decayed}, days_inactive={self.days_inactive:.1f})"
        )


def calculate_decay(
    current_level: TrustLevel,
    last_active: datetime | None,
    cliff_days: int | None,
    gradual_days: int | None,
) -> DecayResult:
    """
    Calculate the effective trust level after applying time-based decay.

    Two decay modes are supported:

    - **Cliff decay**: If the agent has been inactive for at least
      ``cliff_days``, the trust level drops by one tier. Cliff decay
      applies once per cliff period — it does not cascade across
      multiple tiers regardless of total inactivity.

    - **Gradual decay**: If the agent has been inactive for at least
      ``gradual_days`` (and cliff decay has not already reduced the
      level), the level is also reduced by one tier. Gradual decay
      represents a softer signal prior to the cliff.

    Only one reduction is applied per query even if both thresholds
    are crossed — cliff decay takes precedence.

    Args:
        current_level: The agent's assigned trust level.
        last_active: UTC timestamp of the agent's last recorded activity.
            If None the agent is treated as never active, which triggers
            decay immediately if any decay is configured.
        cliff_days: Days of inactivity required for cliff decay.
            None means cliff decay is disabled.
        gradual_days: Days of inactivity required for gradual decay.
            None means gradual decay is disabled.

    Returns:
        A :class:`DecayResult` containing the effective level and metadata.
    """
    if cliff_days is None and gradual_days is None:
        return DecayResult(
            effective_level=current_level,
            decayed=False,
            days_inactive=0.0,
        )

    if last_active is None:
        # No last-active timestamp — treat as infinitely inactive.
        days_inactive = float("inf")
    else:
        now = datetime.now(tz=timezone.utc)
        delta = now - last_active
        days_inactive = delta.total_seconds() / 86_400.0

    effective = current_level
    decayed = False

    # Cliff decay takes precedence — apply it and return if triggered.
    if cliff_days is not None and days_inactive >= cliff_days:
        if effective > TrustLevel.L0_OBSERVER:
            effective = TrustLevel(int(effective) - 1)
            decayed = True
        return DecayResult(
            effective_level=effective,
            decayed=decayed,
            days_inactive=days_inactive if days_inactive != float("inf") else -1.0,
        )

    # Gradual decay applies if cliff did not fire.
    if gradual_days is not None and days_inactive >= gradual_days:
        if effective > TrustLevel.L0_OBSERVER:
            effective = TrustLevel(int(effective) - 1)
            decayed = True

    return DecayResult(
        effective_level=effective,
        decayed=decayed,
        days_inactive=days_inactive if days_inactive != float("inf") else -1.0,
    )
