# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
TrustLadder — primary entry point for the trust-ladder Python package.

Manages 6-level graduated trust assignments for AI agents across independent
named scopes. All trust changes are strictly manual: the ladder never
automatically adjusts levels based on agent behaviour or any other signal.
Decay (if configured) can only lower the effective level over time.
"""

from __future__ import annotations

import time
from typing import Literal

from .assignment import AssignmentStore, validate_agent_id, validate_level
from .config import CliffDecayConfig, TrustLadderConfig, resolve_config
from .decay import DecayEngine
from .levels import TrustLevel, TRUST_LEVEL_MIN
from .types import TrustAssignment, TrustChangeRecord, TrustCheckResult


def _now_ms() -> int:
    """Return the current wall-clock time in milliseconds since Unix epoch."""
    return int(time.time() * 1000)


class TrustLadder:
    """
    Primary interface for managing trust levels in the AumOS trust-ladder.

    ## Invariants

    - Trust changes are MANUAL ONLY — ``assign()`` is the sole mechanism.
    - Decay is one-directional — effective levels only decrease over time.
    - Each (agent_id, scope) pair holds exactly one integer trust level [0, 5].
    - Scopes are independent — no inference across scope boundaries.

    ## Quick start

    ```python
    from trust_ladder import TrustLadder, TrustLevel

    ladder = TrustLadder()
    ladder.assign("agent-1", TrustLevel.ACT_WITH_APPROVAL, scope="payments")
    result = ladder.check("agent-1", TrustLevel.ACT_WITH_APPROVAL, scope="payments")
    assert result.permitted
    ```
    """

    def __init__(self, config: TrustLadderConfig | None = None) -> None:
        resolved = resolve_config(config)
        self._store = AssignmentStore(resolved.max_history_per_scope)
        self._decay_engine = DecayEngine(resolved.decay)
        self._default_scope = resolved.default_scope

    # -----------------------------------------------------------------------
    # Public API
    # -----------------------------------------------------------------------

    def assign(
        self,
        agent_id: str,
        level: int | TrustLevel,
        scope: str | None = None,
        *,
        reason: str | None = None,
        assigned_by: str | None = None,
    ) -> TrustAssignment:
        """
        Manually assign a trust level to an agent within an optional scope.

        This is the ONLY way trust levels change. The ladder never
        automatically adjusts levels based on agent behaviour or any signal.

        Args:
            agent_id:    Non-empty identifier for the agent.
            level:       Trust level integer in [0, 5] or TrustLevel member.
            scope:       Named scope. Defaults to the ladder's default_scope.
            reason:      Human-readable reason for audit purposes.
            assigned_by: Operator identifier for audit purposes.

        Returns:
            The created TrustAssignment record.

        Raises:
            TypeError:  If agent_id is not a non-empty string, or level is
                        not an integer.
            ValueError: If level is outside [0, 5], or agent_id is blank.
        """
        validated_id = validate_agent_id(agent_id)
        validated_level = validate_level(level)
        resolved_scope = scope if scope is not None else self._default_scope

        return self._store.record(
            agent_id=validated_id,
            scope=resolved_scope,
            level=validated_level,
            reason=reason,
            assigned_by=assigned_by,
            now_ms=_now_ms(),
        )

    def get_level(self, agent_id: str, scope: str | None = None) -> TrustLevel:
        """
        Get the effective trust level for an agent in a scope, accounting for
        any configured decay.

        If no assignment exists, returns TRUST_LEVEL_MIN (OBSERVER).

        Args:
            agent_id: Non-empty identifier for the agent.
            scope:    Named scope. Defaults to the ladder's default_scope.

        Returns:
            Effective TrustLevel in [0, 5].

        Raises:
            TypeError:  If agent_id is not a non-empty string.
            ValueError: If agent_id is blank.
        """
        validated_id = validate_agent_id(agent_id)
        resolved_scope = scope if scope is not None else self._default_scope

        assignment = self._store.get(validated_id, resolved_scope)
        if assignment is None:
            return TRUST_LEVEL_MIN

        now = _now_ms()
        result = self._decay_engine.compute(assignment, now)

        # Record a history entry when decay has lowered the effective level
        # and it has not already been recorded at this level. This prevents
        # duplicate entries on repeated get_level() calls at the same level.
        if result.effective_level != assignment.assigned_level:
            last_recorded = self._store.get_last_recorded_level(validated_id, resolved_scope)
            if last_recorded is None or last_recorded != result.effective_level:
                change_kind: Literal["decay_cliff", "decay_step"] = (
                    "decay_cliff"
                    if isinstance(self._decay_engine.config, CliffDecayConfig)
                    else "decay_step"
                )
                previous_level = (
                    last_recorded if last_recorded is not None else assignment.assigned_level
                )
                self._store.record_decay_step(
                    agent_id=validated_id,
                    scope=resolved_scope,
                    previous_level=previous_level,
                    new_level=result.effective_level,
                    change_kind=change_kind,
                    now_ms=now,
                )

        return result.effective_level

    def check(
        self,
        agent_id: str,
        required_level: int | TrustLevel,
        scope: str | None = None,
    ) -> TrustCheckResult:
        """
        Check whether an agent's effective trust level satisfies a required minimum.

        Args:
            agent_id:       Non-empty identifier for the agent.
            required_level: Minimum required trust level in [0, 5].
            scope:          Named scope. Defaults to the ladder's default_scope.

        Returns:
            TrustCheckResult with ``permitted`` flag and full context.

        Raises:
            TypeError:  If agent_id is not a non-empty string, or required_level
                        is not an integer.
            ValueError: If required_level is outside [0, 5], or agent_id is blank.
        """
        validated_id = validate_agent_id(agent_id)
        validated_required = validate_level(required_level)
        resolved_scope = scope if scope is not None else self._default_scope

        effective = self.get_level(validated_id, resolved_scope)

        return TrustCheckResult(
            permitted=int(effective) >= int(validated_required),
            effective_level=effective,
            required_level=validated_required,
            scope=resolved_scope,
            checked_at=_now_ms(),
        )

    def get_history(
        self, agent_id: str, scope: str | None = None
    ) -> list[TrustChangeRecord]:
        """
        Retrieve the immutable history of trust changes for an agent in a scope.

        The history includes manual assignments, decay events, and revocations.

        Args:
            agent_id: Non-empty identifier for the agent.
            scope:    Named scope. Defaults to the ladder's default_scope.

        Returns:
            List of TrustChangeRecord, oldest first.
        """
        validated_id = validate_agent_id(agent_id)
        resolved_scope = scope if scope is not None else self._default_scope
        return self._store.get_history(validated_id, resolved_scope)

    def revoke(self, agent_id: str, scope: str | None = None) -> None:
        """
        Remove all assignments for an agent in a scope (or all scopes if no
        scope is given). Records a revocation entry in history.

        After revocation, ``get_level()`` returns TRUST_LEVEL_MIN for that scope.

        Args:
            agent_id: Non-empty identifier for the agent.
            scope:    Named scope. If None, revokes all scopes for the agent.
        """
        validated_id = validate_agent_id(agent_id)
        now = _now_ms()

        if scope is not None:
            self._store.revoke(validated_id, scope, now)
            return

        # Revoke all scopes for this agent
        for assignment in list(self._store.list_all()):
            if assignment.agent_id == validated_id:
                self._store.revoke(assignment.agent_id, assignment.scope, now)

    def list_assignments(self) -> list[TrustAssignment]:
        """
        List all current (non-revoked) assignments managed by this instance.

        Returns:
            List of TrustAssignment.
        """
        return self._store.list_all()
