# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
Trust level definitions for the AumOS trust ladder.

The six levels represent progressively broader autonomy granted to an AI agent.
Levels are represented as integers [0, 5] for easy numeric comparison.
"""

from __future__ import annotations

from enum import IntEnum


class TrustLevel(IntEnum):
    """
    Six-level graduated trust scale for AI agents.

    Each level grants a strictly broader set of execution capabilities than
    the level below it. Trust can only be assigned manually by an operator —
    no automatic promotion is provided by this package.
    """

    OBSERVER = 0
    """Read-only observation; no execution capability."""

    MONITOR = 1
    """State monitoring and structured status signalling."""

    SUGGEST = 2
    """Recommendation generation for human review."""

    ACT_WITH_APPROVAL = 3
    """Action execution requiring explicit human approval."""

    ACT_AND_REPORT = 4
    """Action execution with mandatory post-hoc reporting."""

    AUTONOMOUS = 5
    """Full autonomous execution within the assigned scope."""


# Human-readable descriptions keyed by TrustLevel
TRUST_LEVEL_DESCRIPTIONS: dict[TrustLevel, str] = {
    TrustLevel.OBSERVER: "Read-only observation; no execution capability.",
    TrustLevel.MONITOR: "State monitoring and structured status signalling.",
    TrustLevel.SUGGEST: "Recommendation generation for human review.",
    TrustLevel.ACT_WITH_APPROVAL: "Action execution requiring explicit human approval.",
    TrustLevel.ACT_AND_REPORT: "Action execution with mandatory post-hoc reporting.",
    TrustLevel.AUTONOMOUS: "Full autonomous execution within the assigned scope.",
}

#: Minimum trust level (floor for decay — never goes below this).
TRUST_LEVEL_MIN: TrustLevel = TrustLevel.OBSERVER

#: Maximum trust level.
TRUST_LEVEL_MAX: TrustLevel = TrustLevel.AUTONOMOUS

#: Total number of distinct trust levels.
TRUST_LEVEL_COUNT: int = 6


def is_valid_trust_level(value: object) -> bool:
    """Return True if *value* is a valid TrustLevel integer [0, 5]."""
    return isinstance(value, int) and TrustLevel.OBSERVER <= value <= TrustLevel.AUTONOMOUS


def trust_level_name(level: int) -> str:
    """
    Return the name string for a numeric trust level.

    Raises:
        ValueError: If *level* is out of the valid range [0, 5].
    """
    if not is_valid_trust_level(level):
        raise ValueError(
            f"Trust level {level!r} is out of range "
            f"[{TRUST_LEVEL_MIN}, {TRUST_LEVEL_MAX}]."
        )
    return TrustLevel(level).name


def trust_level_description(level: int) -> str:
    """
    Return the description string for a numeric trust level.

    Raises:
        ValueError: If *level* is out of the valid range [0, 5].
    """
    if not is_valid_trust_level(level):
        raise ValueError(
            f"Trust level {level!r} is out of range "
            f"[{TRUST_LEVEL_MIN}, {TRUST_LEVEL_MAX}]."
        )
    return TRUST_LEVEL_DESCRIPTIONS[TrustLevel(level)]


def clamp_trust_level(value: int) -> TrustLevel:
    """
    Clamp *value* to the valid trust-level range [0, 5].

    Used internally by decay mechanics to prevent under- or overflow.
    """
    clamped = max(int(TRUST_LEVEL_MIN), min(int(TRUST_LEVEL_MAX), value))
    return TrustLevel(clamped)
