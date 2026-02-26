# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
AuditLogger — primary entry point for recording and querying governance decisions.

AuditLogger coordinates three concerns:

1. Record construction — building a well-typed AuditRecord from caller input.
2. Hash chain maintenance — linking each record cryptographically to the last.
3. Storage delegation — persisting and retrieving records via a pluggable backend.

Usage::

    from audit_trail import AuditLogger, GovernanceDecisionInput

    logger = AuditLogger()
    record = await logger.log(
        GovernanceDecisionInput(agent_id="agent-1", action="send_email", permitted=True)
    )
    result = await logger.verify()
"""

from __future__ import annotations

from audit_trail.chain import HashChain
from audit_trail.export_formats import export_records
from audit_trail.record import build_pending_record
from audit_trail.storage.interface import AuditStorage
from audit_trail.storage.memory import MemoryStorage
from audit_trail.types import (
    AuditFilter,
    AuditRecord,
    ChainVerificationResult,
    GovernanceDecisionInput,
)


class AuditLogger:
    """
    Primary logger for governance decisions.

    Parameters
    ----------
    storage:
        Pluggable storage backend.  Defaults to in-memory storage when omitted.
    """

    def __init__(self, storage: AuditStorage | None = None) -> None:
        self._storage: AuditStorage = storage or MemoryStorage()
        self._chain: HashChain = HashChain()

    async def log(self, decision: GovernanceDecisionInput) -> AuditRecord:
        """
        Record a governance decision.

        The decision is wrapped in an AuditRecord, linked to the previous record
        via SHA-256, and persisted to the configured storage backend.

        Returns
        -------
        AuditRecord
            The fully-formed, immutable record including its computed hash.
        """
        pending = build_pending_record(decision, self._chain.last_hash())
        record = self._chain.append(pending)
        await self._storage.append(record)
        return record

    async def query(self, audit_filter: AuditFilter) -> list[AuditRecord]:
        """
        Query the audit log using the supplied filter.

        Returns records in ascending timestamp order.  All filter fields are
        optional — omitting a field returns all records on that dimension.
        """
        return await self._storage.query(audit_filter)

    async def verify(self) -> ChainVerificationResult:
        """
        Verify the integrity of every record in the log.

        Walks the complete record set, re-derives each SHA-256 hash from
        scratch, and compares it against the stored value.  Any discrepancy
        indicates that a record was altered after it was written.

        This operation reads the full record corpus from storage and has O(n)
        time complexity.
        """
        records = await self._storage.all()
        return self._chain.verify(records)

    async def export_records(
        self,
        export_format: str,
        audit_filter: AuditFilter | None = None,
    ) -> str:
        """
        Export records to the requested format.

        Supported formats:

        - ``"json"`` — JSON array of AuditRecord objects.
        - ``"csv"``  — RFC 4180 CSV with a header row.
        - ``"cef"``  — Common Event Format for SIEM integration (Splunk / ELK).

        An optional ``audit_filter`` narrows the export to a subset of records.
        """
        if audit_filter is not None:
            records = await self._storage.query(audit_filter)
        else:
            records = await self._storage.all()
        return export_records(records, export_format)

    async def count(self) -> int:
        """Return the total number of records currently in the store."""
        return await self._storage.count()
