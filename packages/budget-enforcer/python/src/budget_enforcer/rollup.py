# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
Team/org budget hierarchy with static rollup aggregation.

Provides a tree structure for rolling up member budgets to team level
and team budgets to organisation level. All aggregation is static —
no adaptive allocation, dynamic rebalancing, or ML-based distribution
is performed.
"""

from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Hierarchy node models
# ---------------------------------------------------------------------------


class MemberBudget(BaseModel, frozen=True):
    """Budget allocation for a single team member."""

    member_id: str = Field(..., min_length=1, description="Unique member identifier.")
    limit: float = Field(..., ge=0.0, description="Budget limit in USD for this member.")
    spent: float = Field(default=0.0, ge=0.0, description="Amount spent by this member in USD.")


class TeamRollup(BaseModel, frozen=True):
    """Aggregated budget rollup for a single team."""

    team_id: str = Field(..., min_length=1, description="Unique team identifier.")
    team_limit: float = Field(..., ge=0.0, description="Team-level budget limit in USD.")
    total_member_limits: float = Field(
        ..., ge=0.0, description="Sum of all member limits in USD."
    )
    total_spent: float = Field(
        ..., ge=0.0, description="Sum of all member spending in USD."
    )
    total_available: float = Field(
        ..., description="Remaining budget at team level (team_limit - total_spent)."
    )
    member_count: int = Field(..., ge=0, description="Number of members in the team.")
    utilization_percent: float = Field(
        ...,
        ge=0.0,
        description="Team budget utilization as a percentage.",
    )


class OrgRollup(BaseModel, frozen=True):
    """Aggregated budget rollup at the organisation level."""

    org_id: str = Field(..., min_length=1, description="Unique organisation identifier.")
    org_limit: float = Field(..., ge=0.0, description="Organisation-level budget limit in USD.")
    total_team_limits: float = Field(
        ..., ge=0.0, description="Sum of all team limits in USD."
    )
    total_spent: float = Field(
        ..., ge=0.0, description="Sum of all spending across all teams in USD."
    )
    total_available: float = Field(
        ..., description="Remaining budget at org level (org_limit - total_spent)."
    )
    team_count: int = Field(..., ge=0, description="Number of teams in the organisation.")
    total_member_count: int = Field(
        ..., ge=0, description="Total number of members across all teams."
    )
    utilization_percent: float = Field(
        ...,
        ge=0.0,
        description="Organisation budget utilization as a percentage.",
    )
    team_rollups: list[TeamRollup] = Field(
        default_factory=list, description="Per-team rollup summaries."
    )


# ---------------------------------------------------------------------------
# Internal team state
# ---------------------------------------------------------------------------


class _TeamState:
    """Mutable internal state for a team during hierarchy construction."""

    def __init__(self, team_id: str, team_limit: float) -> None:
        self.team_id = team_id
        self.team_limit = team_limit
        self.members: list[MemberBudget] = []


# ---------------------------------------------------------------------------
# BudgetHierarchy
# ---------------------------------------------------------------------------


class BudgetHierarchy:
    """
    Manages a team/org budget hierarchy with static rollup aggregation.

    Members are grouped into teams, and teams into an organisation.
    The ``rollup`` method computes aggregate spending at each level
    of the hierarchy.

    All aggregation is static — no adaptive allocation, dynamic
    rebalancing, or ML-based distribution is performed.

    Usage::

        hierarchy = BudgetHierarchy(org_id="acme", org_limit=10000.0)
        hierarchy.add_team("engineering", team_limit=5000.0)
        hierarchy.add_member("engineering", MemberBudget(
            member_id="alice", limit=2000.0, spent=450.0
        ))
        hierarchy.add_member("engineering", MemberBudget(
            member_id="bob", limit=3000.0, spent=1200.0
        ))
        result = hierarchy.rollup()
    """

    def __init__(self, org_id: str, org_limit: float) -> None:
        """
        Initialize a budget hierarchy for an organisation.

        Args:
            org_id:    Unique organisation identifier.
            org_limit: Organisation-level budget limit in USD.
        """
        if not org_id.strip():
            raise ValueError("org_id must be a non-empty string.")
        if org_limit < 0:
            raise ValueError("org_limit must be non-negative.")

        self._org_id = org_id
        self._org_limit = org_limit
        self._teams: dict[str, _TeamState] = {}

    def add_team(self, team_id: str, team_limit: float) -> None:
        """
        Add a team to the hierarchy.

        Args:
            team_id:    Unique team identifier.
            team_limit: Team-level budget limit in USD.

        Raises:
            ValueError: If team_id is empty or team_limit is negative.
            KeyError:   If a team with this ID already exists.
        """
        if not team_id.strip():
            raise ValueError("team_id must be a non-empty string.")
        if team_limit < 0:
            raise ValueError("team_limit must be non-negative.")
        if team_id in self._teams:
            raise KeyError(f"Team already exists: {team_id!r}")

        self._teams[team_id] = _TeamState(team_id=team_id, team_limit=team_limit)

    def remove_team(self, team_id: str) -> bool:
        """
        Remove a team and all its members from the hierarchy.

        Returns:
            True if the team existed and was removed.
        """
        return self._teams.pop(team_id, None) is not None

    def add_member(self, team_id: str, member: MemberBudget) -> None:
        """
        Add a member to a team.

        Args:
            team_id: The team to add the member to.
            member:  The member budget allocation.

        Raises:
            KeyError: If the team does not exist.
        """
        team = self._teams.get(team_id)
        if team is None:
            raise KeyError(f"Team not found: {team_id!r}")
        team.members.append(member)

    def _rollup_team(self, team: _TeamState) -> TeamRollup:
        """Compute the static rollup for a single team."""
        total_member_limits = sum(m.limit for m in team.members)
        total_spent = sum(m.spent for m in team.members)
        total_available = max(0.0, team.team_limit - total_spent)
        utilization = (
            round((total_spent / team.team_limit) * 100.0, 2)
            if team.team_limit > 0
            else 0.0
        )

        return TeamRollup(
            team_id=team.team_id,
            team_limit=team.team_limit,
            total_member_limits=total_member_limits,
            total_spent=total_spent,
            total_available=total_available,
            member_count=len(team.members),
            utilization_percent=utilization,
        )

    def rollup(self) -> OrgRollup:
        """
        Compute the static rollup aggregation across the entire hierarchy.

        Aggregates member budgets to team level and team budgets to
        organisation level. This is a point-in-time snapshot — no
        adaptive allocation or dynamic rebalancing is performed.

        Returns:
            An OrgRollup with per-team and org-level aggregated metrics.
        """
        team_rollups: list[TeamRollup] = []
        total_team_limits = 0.0
        total_spent = 0.0
        total_member_count = 0

        for team in self._teams.values():
            team_rollup = self._rollup_team(team)
            team_rollups.append(team_rollup)
            total_team_limits += team_rollup.team_limit
            total_spent += team_rollup.total_spent
            total_member_count += team_rollup.member_count

        total_available = max(0.0, self._org_limit - total_spent)
        utilization = (
            round((total_spent / self._org_limit) * 100.0, 2)
            if self._org_limit > 0
            else 0.0
        )

        return OrgRollup(
            org_id=self._org_id,
            org_limit=self._org_limit,
            total_team_limits=total_team_limits,
            total_spent=total_spent,
            total_available=total_available,
            team_count=len(self._teams),
            total_member_count=total_member_count,
            utilization_percent=utilization,
            team_rollups=team_rollups,
        )
