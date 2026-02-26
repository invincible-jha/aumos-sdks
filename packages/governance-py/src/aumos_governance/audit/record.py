# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from aumos_governance.types import GovernanceOutcome


class GovernanceDecisionContext(BaseModel, frozen=True):
    """
    Contextual metadata attached to a governance decision for audit purposes.

    All fields are optional — include whatever is relevant to the action
    being evaluated.

    Attributes:
        agent_id: The agent performing the action.
        action_type: A short string classifying the action (e.g. ``'tool_call'``).
        resource: The resource being accessed or mutated.
        scope: Optional operational scope.
        budget_category: Budget category charged for this action, if any.
        data_type: Data type accessed, if consent was checked.
        purpose: Purpose string used in consent check, if applicable.
        extra: Any additional key-value metadata.
    """

    agent_id: str | None = None
    action_type: str | None = None
    resource: str | None = None
    scope: str | None = None
    budget_category: str | None = None
    data_type: str | None = None
    purpose: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)


class AuditRecord(BaseModel, frozen=True):
    """
    An immutable audit record capturing a single governance decision.

    Attributes:
        record_id: Unique UUID for this record.
        outcome: The outcome of the governance decision.
        decision: Short description of the decision taken.
        reasons: List of reason strings from each governance check.
        context: Optional structured context for the decision.
        timestamp: UTC timestamp when the record was created.
    """

    record_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    outcome: GovernanceOutcome
    decision: str
    reasons: list[str] = Field(default_factory=list)
    context: GovernanceDecisionContext | None = None
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(tz=timezone.utc)
    )


def create_record(
    outcome: GovernanceOutcome,
    decision: str,
    reasons: list[str] | None = None,
    context: GovernanceDecisionContext | None = None,
) -> AuditRecord:
    """
    Construct an :class:`AuditRecord`.

    This factory function exists so callers always produce records through
    a consistent path rather than calling the Pydantic model directly.

    Args:
        outcome: The :class:`~aumos_governance.types.GovernanceOutcome`.
        decision: A concise human-readable summary of the decision.
        reasons: Optional list of reason strings collected during evaluation.
        context: Optional :class:`GovernanceDecisionContext`.

    Returns:
        A frozen :class:`AuditRecord`.
    """
    return AuditRecord(
        outcome=outcome,
        decision=decision,
        reasons=reasons or [],
        context=context,
    )
