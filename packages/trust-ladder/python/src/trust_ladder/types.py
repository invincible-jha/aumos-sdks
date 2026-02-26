# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
Core type definitions for the AumOS trust-ladder package.

All runtime data models are Pydantic v2 models for full validation and
serialisation support. Frozen models are used wherever immutability is required.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .levels import TrustLevel

# ---------------------------------------------------------------------------
# Change kind literal
# ---------------------------------------------------------------------------

TrustChangeKind = Literal["manual", "decay_cliff", "decay_step", "revocation"]
"""
Machine-readable categories for trust-level change events.

- ``manual``      — an operator explicitly called assign().
- ``decay_cliff`` — TTL expired; trust dropped to OBSERVER.
- ``decay_step``  — one gradual decay step occurred.
- ``revocation``  — the assignment was explicitly revoked.
"""


# ---------------------------------------------------------------------------
# TrustAssignment — immutable record of a manual operator assignment
# ---------------------------------------------------------------------------


class TrustAssignment(BaseModel, frozen=True):
    """
    A point-in-time record of a trust assignment made by a human operator.
    All trust changes are manual — this record is immutable once created.
    """

    agent_id: str = Field(..., min_length=1, description="Unique identifier of the agent.")
    scope: str = Field(
        default="",
        description="Named scope for this assignment. Empty string = global scope.",
    )
    assigned_level: TrustLevel = Field(
        ..., description="Trust level assigned by the operator (before any decay)."
    )
    assigned_at: int = Field(
        ...,
        description="Wall-clock timestamp (ms since Unix epoch) when assignment was made.",
    )
    reason: str | None = Field(
        default=None,
        description="Human-readable reason for the assignment (for audit).",
    )
    assigned_by: str | None = Field(
        default=None,
        description="Identifier of the human operator who made this assignment.",
    )


# ---------------------------------------------------------------------------
# TrustChangeRecord — append-only audit log entry
# ---------------------------------------------------------------------------


class TrustChangeRecord(BaseModel, frozen=True):
    """A single entry in the immutable history of trust changes for an agent."""

    agent_id: str = Field(..., min_length=1)
    scope: str = Field(default="")
    previous_level: TrustLevel | None = Field(
        default=None,
        description="Trust level before this change (None for the first assignment).",
    )
    new_level: TrustLevel = Field(..., description="Trust level after this change.")
    changed_at: int = Field(
        ..., description="Wall-clock timestamp (ms since Unix epoch) of the change."
    )
    change_kind: TrustChangeKind = Field(
        ..., description="Machine-readable category for why the level changed."
    )
    reason: str | None = Field(default=None)
    changed_by: str | None = Field(default=None)


# ---------------------------------------------------------------------------
# TrustCheckResult — result of a level-sufficiency check
# ---------------------------------------------------------------------------


class TrustCheckResult(BaseModel, frozen=True):
    """The result of checking whether an agent's effective level permits an action."""

    permitted: bool = Field(
        ..., description="True if the agent's effective level >= required level."
    )
    effective_level: TrustLevel = Field(
        ..., description="The agent's effective trust level at check time."
    )
    required_level: TrustLevel = Field(
        ..., description="The minimum level that was required."
    )
    scope: str = Field(..., description="The scope under which the check was evaluated.")
    checked_at: int = Field(
        ..., description="Wall-clock timestamp (ms since Unix epoch) of the check."
    )


# ---------------------------------------------------------------------------
# Scope key helper
# ---------------------------------------------------------------------------


def build_scope_key(agent_id: str, scope: str) -> str:
    """
    Build a canonical lookup key from agent_id and scope.

    A null byte is used as separator so neither component can accidentally
    produce a collision with a valid key from different inputs.
    """
    return f"{agent_id}\x00{scope}"
