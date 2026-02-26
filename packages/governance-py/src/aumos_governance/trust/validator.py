# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

from pydantic import BaseModel

from aumos_governance.types import TrustLevel


class TrustCheckResult(BaseModel, frozen=True):
    """
    Result of a trust level check against a required minimum.

    Attributes:
        allowed: True if the agent meets or exceeds the required level.
        agent_id: The agent that was evaluated.
        required_level: The minimum trust level required by the action.
        actual_level: The agent's current effective trust level.
        scope: Optional scope context for this evaluation.
        reason: Human-readable explanation of the decision.
    """

    allowed: bool
    agent_id: str
    required_level: TrustLevel
    actual_level: TrustLevel
    scope: str | None = None
    reason: str


def validate_trust(
    agent_id: str,
    required_level: TrustLevel,
    actual_level: TrustLevel,
    scope: str | None = None,
) -> TrustCheckResult:
    """
    Validate whether an agent's effective trust level satisfies a requirement.

    This is a pure function — it does not modify state or log anything.
    The GovernanceEngine and TrustManager use this internally; callers
    may also call it directly for dry-run checks.

    Args:
        agent_id: Identifier of the agent being checked.
        required_level: The minimum :class:`~aumos_governance.types.TrustLevel`
            required to proceed.
        actual_level: The agent's current effective trust level (after decay).
        scope: Optional scope string providing context for the check.

    Returns:
        A frozen :class:`TrustCheckResult` describing the outcome.
    """
    allowed = actual_level >= required_level
    scope_text = f" in scope '{scope}'" if scope else ""

    if allowed:
        reason = (
            f"Agent '{agent_id}'{scope_text} has trust level "
            f"{actual_level.label()} ({int(actual_level)}), which satisfies "
            f"the required level {required_level.label()} ({int(required_level)})."
        )
    else:
        reason = (
            f"Agent '{agent_id}'{scope_text} has trust level "
            f"{actual_level.label()} ({int(actual_level)}), which is below "
            f"the required level {required_level.label()} ({int(required_level)})."
        )

    return TrustCheckResult(
        allowed=allowed,
        agent_id=agent_id,
        required_level=required_level,
        actual_level=actual_level,
        scope=scope,
        reason=reason,
    )
