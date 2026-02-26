# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

import collections

from aumos_governance.audit.query import AuditFilter, AuditQueryResult, apply_filter
from aumos_governance.audit.record import (
    AuditRecord,
    GovernanceDecisionContext,
    create_record,
)
from aumos_governance.config import AuditConfig
from aumos_governance.types import GovernanceOutcome


class AuditLogger:
    """
    Records governance decisions as immutable audit records.

    Audit logging is RECORDING ONLY. There is no anomaly detection,
    pattern analysis, or counterfactual generation.

    All records are stored in-memory in a bounded deque. When
    :attr:`~AuditConfig.max_records` is reached, the oldest record
    is evicted to make room for the new one.

    Example::

        logger = AuditLogger(AuditConfig(max_records=1000))
        record = logger.log(
            outcome=GovernanceOutcome.ALLOW,
            decision="Action approved",
            reasons=["Trust OK", "Budget OK"],
        )
        results = logger.query(AuditFilter(outcome=GovernanceOutcome.ALLOW))
    """

    def __init__(self, config: AuditConfig | None = None) -> None:
        self._config = config or AuditConfig()
        self._records: collections.deque[AuditRecord] = collections.deque(
            maxlen=self._config.max_records
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def log(
        self,
        outcome: GovernanceOutcome,
        decision: str,
        reasons: list[str] | None = None,
        context: GovernanceDecisionContext | None = None,
    ) -> AuditRecord:
        """
        Record a governance decision.

        When :attr:`~AuditConfig.include_context` is False the context
        is stripped before storage to reduce memory usage.

        Args:
            outcome: The :class:`~aumos_governance.types.GovernanceOutcome`.
            decision: A concise summary of the decision (e.g. ``'Action denied'``).
            reasons: Optional list of reasons collected from governance checks.
            context: Optional :class:`GovernanceDecisionContext` with metadata.

        Returns:
            The created :class:`~aumos_governance.audit.record.AuditRecord`.
        """
        stored_context = context if self._config.include_context else None
        record = create_record(
            outcome=outcome,
            decision=decision,
            reasons=reasons,
            context=stored_context,
        )
        self._records.append(record)
        return record

    def query(self, audit_filter: AuditFilter | None = None) -> AuditQueryResult:
        """
        Query stored audit records.

        Returns all records when no filter is provided.

        Args:
            audit_filter: Optional :class:`~aumos_governance.audit.query.AuditFilter`
                to narrow results. Supports filtering by agent_id, outcome,
                action_type, time range, and resource.

        Returns:
            An :class:`~aumos_governance.audit.query.AuditQueryResult` containing
            matching records and aggregate metadata.
        """
        all_records = list(self._records)
        effective_filter = audit_filter or AuditFilter()
        return apply_filter(records=all_records, audit_filter=effective_filter)

    def count(self) -> int:
        """Return the total number of stored audit records."""
        return len(self._records)

    def clear(self) -> int:
        """
        Remove all stored audit records.

        Returns:
            The number of records that were cleared.
        """
        count = len(self._records)
        self._records.clear()
        return count

    def latest(self, n: int = 10) -> list[AuditRecord]:
        """
        Return the ``n`` most recent audit records.

        Args:
            n: Number of records to return. Must be >= 1.

        Returns:
            List of :class:`~aumos_governance.audit.record.AuditRecord` objects,
            most recent last.
        """
        if n < 1:
            raise ValueError(f"n must be >= 1; got {n}.")
        records = list(self._records)
        return records[-n:]
