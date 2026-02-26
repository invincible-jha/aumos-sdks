# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel

from aumos_governance.audit.record import AuditRecord
from aumos_governance.types import GovernanceOutcome


class AuditFilter(BaseModel, frozen=True):
    """
    Filter criteria for querying audit records.

    All fields are optional. Multiple criteria are combined with AND logic —
    a record must satisfy every provided criterion to be included.

    Attributes:
        agent_id: Only include records whose context has this agent_id.
        outcome: Only include records with this outcome.
        action_type: Only include records whose context has this action_type.
        since: Only include records at or after this UTC timestamp.
        until: Only include records before this UTC timestamp.
        resource: Only include records whose context references this resource.
        limit: Maximum number of records to return. 0 means no limit.
        offset: Number of records to skip before collecting results.
    """

    agent_id: str | None = None
    outcome: GovernanceOutcome | None = None
    action_type: str | None = None
    since: datetime | None = None
    until: datetime | None = None
    resource: str | None = None
    limit: int = 0
    offset: int = 0


class AuditQueryResult(BaseModel, frozen=True):
    """
    Result of an audit query.

    Attributes:
        records: The matching audit records, ordered oldest-first.
        total_matched: Total number of records that matched the filter
            before applying ``limit`` and ``offset``.
        filter_applied: A copy of the :class:`AuditFilter` used.
    """

    records: list[AuditRecord]
    total_matched: int
    filter_applied: AuditFilter


def apply_filter(
    records: list[AuditRecord],
    audit_filter: AuditFilter,
) -> AuditQueryResult:
    """
    Apply an :class:`AuditFilter` to a list of records.

    Filtering is performed in-memory over the provided list. The result
    is returned as an :class:`AuditQueryResult`.

    Args:
        records: The full list of audit records to search.
        audit_filter: The filter criteria to apply.

    Returns:
        An :class:`AuditQueryResult` with matching records.
    """
    matched: list[AuditRecord] = []

    for record in records:
        if not _record_matches(record, audit_filter):
            continue
        matched.append(record)

    total_matched = len(matched)

    # Apply offset and limit.
    paginated = matched[audit_filter.offset :]
    if audit_filter.limit > 0:
        paginated = paginated[: audit_filter.limit]

    return AuditQueryResult(
        records=paginated,
        total_matched=total_matched,
        filter_applied=audit_filter,
    )


def _record_matches(record: AuditRecord, audit_filter: AuditFilter) -> bool:
    """Return True if ``record`` satisfies all criteria in ``audit_filter``."""
    if audit_filter.outcome is not None and record.outcome != audit_filter.outcome:
        return False

    if audit_filter.since is not None and record.timestamp < audit_filter.since:
        return False

    if audit_filter.until is not None and record.timestamp >= audit_filter.until:
        return False

    ctx = record.context
    if audit_filter.agent_id is not None:
        if ctx is None or ctx.agent_id != audit_filter.agent_id:
            return False

    if audit_filter.action_type is not None:
        if ctx is None or ctx.action_type != audit_filter.action_type:
            return False

    if audit_filter.resource is not None:
        if ctx is None or ctx.resource != audit_filter.resource:
            return False

    return True


def aggregate_outcomes(records: list[AuditRecord]) -> dict[str, Any]:
    """
    Compute a summary count of outcomes across a list of records.

    Args:
        records: The audit records to aggregate.

    Returns:
        Dict with keys ``'allow'``, ``'deny'``, ``'allow_with_caveat'``,
        ``'total'``, and ``'denial_rate'`` (fraction of total that were denied).
    """
    counts: dict[str, int] = {
        GovernanceOutcome.ALLOW: 0,
        GovernanceOutcome.DENY: 0,
        GovernanceOutcome.ALLOW_WITH_CAVEAT: 0,
    }
    for record in records:
        outcome_key = str(record.outcome)
        if outcome_key in counts:
            counts[outcome_key] += 1

    total = len(records)
    denial_rate = counts[GovernanceOutcome.DENY] / total if total > 0 else 0.0

    return {
        "allow": counts[GovernanceOutcome.ALLOW],
        "deny": counts[GovernanceOutcome.DENY],
        "allow_with_caveat": counts[GovernanceOutcome.ALLOW_WITH_CAVEAT],
        "total": total,
        "denial_rate": denial_rate,
    }
