# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
Volatile in-memory storage backend.

All records are held in a plain list in insertion order.  Suitable for testing,
short-lived processes, and scenarios where persistence is not required.  Data is
lost when the process exits.
"""

from __future__ import annotations

from audit_trail.storage.interface import AuditStorage
from audit_trail.types import AuditFilter, AuditRecord


class MemoryStorage(AuditStorage):
    """In-memory, non-persistent AuditStorage implementation."""

    def __init__(self) -> None:
        self._records: list[AuditRecord] = []

    async def append(self, record: AuditRecord) -> None:
        self._records.append(record)

    async def query(self, audit_filter: AuditFilter) -> list[AuditRecord]:
        results: list[AuditRecord] = list(self._records)

        if audit_filter.agent_id is not None:
            agent_id = audit_filter.agent_id
            results = [r for r in results if r.agent_id == agent_id]

        if audit_filter.action is not None:
            action = audit_filter.action
            results = [r for r in results if r.action == action]

        if audit_filter.permitted is not None:
            permitted = audit_filter.permitted
            results = [r for r in results if r.permitted == permitted]

        if audit_filter.start_time is not None:
            start_time = audit_filter.start_time
            results = [r for r in results if r.timestamp >= start_time]

        if audit_filter.end_time is not None:
            end_time = audit_filter.end_time
            results = [r for r in results if r.timestamp <= end_time]

        offset = audit_filter.offset or 0
        results = results[offset:]

        if audit_filter.limit is not None:
            results = results[: audit_filter.limit]

        return results

    async def all(self) -> list[AuditRecord]:
        return list(self._records)

    async def count(self) -> int:
        return len(self._records)
