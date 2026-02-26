# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
Assignment storage and input validation for the AumOS trust-ladder.

The AssignmentStore keeps the current assignment per (agent_id, scope) pair
and an append-only history log. All writes are mediated through typed methods
to ensure the Fire Line rules are never violated in storage logic.
"""

from __future__ import annotations

from .levels import TrustLevel, TRUST_LEVEL_MIN, is_valid_trust_level
from .types import TrustAssignment, TrustChangeKind, TrustChangeRecord, build_scope_key


class AssignmentStore:
    """
    In-memory storage for trust assignments and their change histories.

    Thread-safety: not thread-safe. Wrap with a lock if concurrent access is
    required by the calling application.
    """

    def __init__(self, max_history_per_scope: int) -> None:
        self._assignments: dict[str, TrustAssignment] = {}
        self._history: dict[str, list[TrustChangeRecord]] = {}
        self._max_history_per_scope = max_history_per_scope

    def record(
        self,
        agent_id: str,
        scope: str,
        level: TrustLevel,
        reason: str | None,
        assigned_by: str | None,
        now_ms: int,
    ) -> TrustAssignment:
        """
        Persist a new manual trust assignment and append a history entry.

        Args:
            agent_id:    Non-empty agent identifier.
            scope:       Scope string (empty = global scope).
            level:       Trust level to assign.
            reason:      Optional human-readable reason for audit.
            assigned_by: Optional operator identifier for audit.
            now_ms:      Current time in ms since Unix epoch.

        Returns:
            The created TrustAssignment.
        """
        key = build_scope_key(agent_id, scope)
        previous = self._assignments.get(key)

        assignment = TrustAssignment(
            agent_id=agent_id,
            scope=scope,
            assigned_level=level,
            assigned_at=now_ms,
            reason=reason,
            assigned_by=assigned_by,
        )
        self._assignments[key] = assignment

        record = TrustChangeRecord(
            agent_id=agent_id,
            scope=scope,
            previous_level=previous.assigned_level if previous is not None else None,
            new_level=level,
            changed_at=now_ms,
            change_kind="manual",
            reason=reason,
            changed_by=assigned_by,
        )
        self._append_history(key, record)
        return assignment

    def record_decay_step(
        self,
        agent_id: str,
        scope: str,
        previous_level: TrustLevel,
        new_level: TrustLevel,
        change_kind: TrustChangeKind,
        now_ms: int,
    ) -> TrustChangeRecord:
        """
        Append a decay event to history without modifying the stored assignment.

        The assignment preserves the original operator intent (assigned_level).
        Only the computed effective level changes via decay.
        """
        key = build_scope_key(agent_id, scope)
        reason_text = (
            "Assignment TTL expired; trust reset to OBSERVER."
            if change_kind == "decay_cliff"
            else "Gradual decay step; trust decreased by one level."
        )
        record = TrustChangeRecord(
            agent_id=agent_id,
            scope=scope,
            previous_level=previous_level,
            new_level=new_level,
            changed_at=now_ms,
            change_kind=change_kind,
            reason=reason_text,
        )
        self._append_history(key, record)
        return record

    def revoke(self, agent_id: str, scope: str, now_ms: int) -> bool:
        """
        Remove the current assignment for (agent_id, scope) and record a
        revocation entry in history.

        Returns:
            True if an assignment existed and was removed; False otherwise.
        """
        key = build_scope_key(agent_id, scope)
        existing = self._assignments.pop(key, None)
        if existing is None:
            return False

        record = TrustChangeRecord(
            agent_id=agent_id,
            scope=scope,
            previous_level=existing.assigned_level,
            new_level=TRUST_LEVEL_MIN,
            changed_at=now_ms,
            change_kind="revocation",
            reason="Assignment explicitly revoked.",
        )
        self._append_history(key, record)
        return True

    def get(self, agent_id: str, scope: str) -> TrustAssignment | None:
        """Retrieve the current TrustAssignment for (agent_id, scope)."""
        return self._assignments.get(build_scope_key(agent_id, scope))

    def list_all(self) -> list[TrustAssignment]:
        """Return all current (non-revoked) assignments as a list."""
        return list(self._assignments.values())

    def get_history(self, agent_id: str, scope: str) -> list[TrustChangeRecord]:
        """Return the change history for (agent_id, scope), oldest first."""
        key = build_scope_key(agent_id, scope)
        return list(self._history.get(key, []))

    def get_last_recorded_level(self, agent_id: str, scope: str) -> TrustLevel | None:
        """
        Return the new_level from the most recent history entry, or None if
        there is no history yet. Used to prevent duplicate decay records.
        """
        records = self._history.get(build_scope_key(agent_id, scope))
        if not records:
            return None
        return records[-1].new_level

    # -----------------------------------------------------------------------
    # Private helpers
    # -----------------------------------------------------------------------

    def _append_history(self, key: str, record: TrustChangeRecord) -> None:
        if key not in self._history:
            self._history[key] = []
        records = self._history[key]
        records.append(record)

        if self._max_history_per_scope > 0 and len(records) > self._max_history_per_scope:
            excess = len(records) - self._max_history_per_scope
            del records[:excess]


# ---------------------------------------------------------------------------
# Input validation helpers
# ---------------------------------------------------------------------------


def validate_agent_id(agent_id: object) -> str:
    """
    Validate that *agent_id* is a non-empty string.

    Returns:
        The validated agent_id string.

    Raises:
        TypeError:  If agent_id is not a string.
        ValueError: If agent_id is empty or whitespace-only.
    """
    if not isinstance(agent_id, str):
        raise TypeError(f"agent_id must be a string, got {type(agent_id).__name__!r}.")
    if not agent_id.strip():
        raise ValueError("agent_id must be a non-empty string.")
    return agent_id


def validate_level(level: object) -> TrustLevel:
    """
    Validate that *level* is a valid trust level integer [0, 5].

    Returns:
        The validated TrustLevel.

    Raises:
        TypeError:  If level is not an integer.
        ValueError: If level is out of the valid range.
    """
    if not isinstance(level, int):
        raise TypeError(f"Trust level must be an integer, got {type(level).__name__!r}.")
    if not is_valid_trust_level(level):
        raise ValueError(
            f"Trust level must be an integer in [0, 5]. Received: {level!r}."
        )
    return TrustLevel(level)
