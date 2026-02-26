# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
Multi-scope query helpers for the AumOS trust-ladder.

Pure functions over read-only collections. No state mutation.
"""

from __future__ import annotations

from .types import TrustAssignment, TrustChangeRecord


def assignments_for_agent(
    all_assignments: list[TrustAssignment],
    agent_id: str,
) -> list[TrustAssignment]:
    """
    Filter a list of assignments to those belonging to *agent_id*.

    Returns a new list; does not mutate the input.
    """
    return [a for a in all_assignments if a.agent_id == agent_id]


def assignments_for_scope(
    all_assignments: list[TrustAssignment],
    scope: str,
) -> list[TrustAssignment]:
    """
    Filter a list of assignments to those in *scope*.

    Returns a new list; does not mutate the input.
    """
    return [a for a in all_assignments if a.scope == scope]


def distinct_scopes(all_assignments: list[TrustAssignment]) -> list[str]:
    """Return all unique scope strings present in *all_assignments*."""
    seen: set[str] = set()
    result: list[str] = []
    for assignment in all_assignments:
        if assignment.scope not in seen:
            seen.add(assignment.scope)
            result.append(assignment.scope)
    return result


def distinct_agent_ids(all_assignments: list[TrustAssignment]) -> list[str]:
    """Return all unique agent_id strings present in *all_assignments*."""
    seen: set[str] = set()
    result: list[str] = []
    for assignment in all_assignments:
        if assignment.agent_id not in seen:
            seen.add(assignment.agent_id)
            result.append(assignment.agent_id)
    return result


def max_level_per_scope(all_assignments: list[TrustAssignment]) -> dict[str, int]:
    """
    Summarise the highest *assigned_level* per scope.

    Note: these are the raw assigned levels, not effective (post-decay) levels.
    For effective levels, call ``TrustLadder.get_level()`` per entry.

    Returns:
        A dict mapping scope string to the maximum assigned_level integer.
    """
    result: dict[str, int] = {}
    for assignment in all_assignments:
        current = result.get(assignment.scope, -1)
        level_int = int(assignment.assigned_level)
        if level_int > current:
            result[assignment.scope] = level_int
    return result


def history_in_window(
    history: list[TrustChangeRecord],
    start_ms: int,
    end_ms: int,
) -> list[TrustChangeRecord]:
    """
    Filter *history* to entries within the time window [start_ms, end_ms].

    Both bounds are inclusive (ms since Unix epoch).
    """
    return [r for r in history if start_ms <= r.changed_at <= end_ms]


def history_by_kind(
    history: list[TrustChangeRecord],
    kind: str,
) -> list[TrustChangeRecord]:
    """
    Filter *history* to entries with a specific ``change_kind``.

    Args:
        history: List of TrustChangeRecord entries.
        kind:    One of ``"manual"``, ``"decay_cliff"``, ``"decay_step"``,
                 ``"revocation"``.
    """
    return [r for r in history if r.change_kind == kind]
