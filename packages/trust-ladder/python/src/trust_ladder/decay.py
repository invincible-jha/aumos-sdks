# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
Stateless decay engine for the AumOS trust-ladder.

All computation methods are pure functions of (assignment, config, now_ms).
The engine never mutates state — callers are responsible for recording
resulting history entries via the AssignmentStore.

Decay is strictly one-directional: effective levels only decrease over time.
There is no pathway for the engine to increase trust.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .config import CliffDecayConfig, GradualDecayConfig, NoDecayConfig
from .levels import TrustLevel, TRUST_LEVEL_MIN, clamp_trust_level
from .types import TrustAssignment


# ---------------------------------------------------------------------------
# Decay result dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DecayResult:
    """The result of computing the effective trust level for one assignment."""

    effective_level: TrustLevel
    """Effective trust level after applying decay."""

    decayed_to_floor: bool
    """True if the effective level has reached TRUST_LEVEL_MIN."""

    new_step_count: int
    """
    Number of decay steps that have occurred since the last computation.
    For cliff decay this is 0 or 1. For gradual decay this is the integer
    number of new steps.
    """


# ---------------------------------------------------------------------------
# Decay engine
# ---------------------------------------------------------------------------


class DecayEngine:
    """
    Stateless decay engine.

    Instantiate once per TrustLadder with the resolved decay configuration.
    Call ``compute()`` to get the effective level for any assignment at any
    point in time.
    """

    def __init__(
        self, config: CliffDecayConfig | GradualDecayConfig | NoDecayConfig
    ) -> None:
        self._config = config

    @property
    def config(self) -> CliffDecayConfig | GradualDecayConfig | NoDecayConfig:
        """The decay configuration this engine was constructed with."""
        return self._config

    def compute(self, assignment: TrustAssignment, now_ms: int) -> DecayResult:
        """
        Compute the effective trust level for *assignment* at time *now_ms*.

        If decay is disabled, returns the assignment's ``assigned_level``
        unchanged.

        Args:
            assignment: The TrustAssignment to evaluate.
            now_ms:     Current wall-clock time in milliseconds since Unix epoch.

        Returns:
            A ``DecayResult`` describing the effective level and decay state.
        """
        if not self._config.enabled:
            return DecayResult(
                effective_level=assignment.assigned_level,
                decayed_to_floor=False,
                new_step_count=0,
            )

        if isinstance(self._config, CliffDecayConfig):
            return self._apply_cliff_decay(assignment, now_ms)

        return self._apply_gradual_decay(assignment, now_ms)

    # -----------------------------------------------------------------------
    # Private decay strategies
    # -----------------------------------------------------------------------

    def _apply_cliff_decay(
        self, assignment: TrustAssignment, now_ms: int
    ) -> DecayResult:
        """
        Cliff decay: if elapsed >= ttl_ms, drop effective level to OBSERVER.
        """
        assert isinstance(self._config, CliffDecayConfig)
        elapsed_ms = now_ms - assignment.assigned_at

        if elapsed_ms >= self._config.ttl_ms:
            dropped = assignment.assigned_level > TRUST_LEVEL_MIN
            return DecayResult(
                effective_level=TRUST_LEVEL_MIN,
                decayed_to_floor=True,
                new_step_count=1 if dropped else 0,
            )

        return DecayResult(
            effective_level=assignment.assigned_level,
            decayed_to_floor=False,
            new_step_count=0,
        )

    def _apply_gradual_decay(
        self, assignment: TrustAssignment, now_ms: int
    ) -> DecayResult:
        """
        Gradual decay: effective_level = max(L0, assigned_level - steps_elapsed).

        Where steps_elapsed = floor(elapsed_ms / step_interval_ms).
        """
        assert isinstance(self._config, GradualDecayConfig)
        elapsed_ms = now_ms - assignment.assigned_at

        steps_elapsed = math.floor(elapsed_ms / self._config.step_interval_ms)
        raw_level = int(assignment.assigned_level) - steps_elapsed
        effective = clamp_trust_level(max(int(TRUST_LEVEL_MIN), raw_level))

        return DecayResult(
            effective_level=effective,
            decayed_to_floor=(effective == TRUST_LEVEL_MIN),
            new_step_count=min(steps_elapsed, int(assignment.assigned_level)),
        )


# ---------------------------------------------------------------------------
# Module-level convenience functions
# ---------------------------------------------------------------------------


def compute_effective_level(
    assignment: TrustAssignment,
    config: CliffDecayConfig | GradualDecayConfig | NoDecayConfig,
    now_ms: int,
) -> TrustLevel:
    """
    Compute the effective trust level for one assignment without constructing
    a DecayEngine instance.

    Args:
        assignment: The TrustAssignment to evaluate.
        config:     The decay configuration to apply.
        now_ms:     Current time in milliseconds since Unix epoch.

    Returns:
        Effective TrustLevel after applying the configured decay.
    """
    return DecayEngine(config).compute(assignment, now_ms).effective_level


def time_until_next_decay(
    assignment: TrustAssignment,
    config: CliffDecayConfig | GradualDecayConfig | NoDecayConfig,
    now_ms: int,
) -> int | None:
    """
    Return the milliseconds remaining until the effective level decreases
    by at least one step (or drops to floor via cliff).

    Returns:
        Number of milliseconds until next decay event, or ``None`` if decay
        is disabled, if the assignment is already at the floor, or if the
        assignment type has no concept of a "next" event.
    """
    if not config.enabled:
        return None
    if int(assignment.assigned_level) == int(TRUST_LEVEL_MIN):
        return None

    elapsed_ms = now_ms - assignment.assigned_at

    if isinstance(config, CliffDecayConfig):
        remaining = config.ttl_ms - elapsed_ms
        return max(0, remaining)

    # Gradual
    assert isinstance(config, GradualDecayConfig)
    steps_elapsed = math.floor(elapsed_ms / config.step_interval_ms)
    current_effective = clamp_trust_level(
        max(int(TRUST_LEVEL_MIN), int(assignment.assigned_level) - steps_elapsed)
    )
    if current_effective == TRUST_LEVEL_MIN:
        return None

    next_step_at_ms = (steps_elapsed + 1) * config.step_interval_ms
    remaining = next_step_at_ms - elapsed_ms
    return max(0, remaining)
