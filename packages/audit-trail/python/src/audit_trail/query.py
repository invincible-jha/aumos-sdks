# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
Composable query facade over any AuditStorage backend.

AuditQuery wraps a storage backend and exposes a typed, filter-driven API.
Callers can use it independently of AuditLogger when they only need read access
to an existing audit store.
"""

from __future__ import annotations

from audit_trail.storage.interface import AuditStorage
from audit_trail.types import AuditFilter, AuditRecord


class AuditQuery:
    """
    Read-only query interface over an AuditStorage backend.

    Parameters
    ----------
    storage:
        The storage backend to query.
    """

    def __init__(self, storage: AuditStorage) -> None:
        self._storage = storage

    async def find(self, audit_filter: AuditFilter) -> list[AuditRecord]:
        """
        Return records matching all supplied filter fields.

        Omitted fields are treated as wildcards — no restriction on that
        dimension.
        """
        return await self._storage.query(audit_filter)

    async def find_by_agent(
        self,
        agent_id: str,
        limit: int | None = None,
    ) -> list[AuditRecord]:
        """Return records for a specific agent, optionally limited."""
        return await self._storage.query(AuditFilter(agent_id=agent_id, limit=limit))

    async def find_denied(
        self,
        agent_id: str | None = None,
        limit: int | None = None,
    ) -> list[AuditRecord]:
        """
        Return only denied (not permitted) decisions, optionally for a specific
        agent.
        """
        return await self._storage.query(
            AuditFilter(agent_id=agent_id, permitted=False, limit=limit)
        )

    async def find_in_time_range(
        self,
        start_time: str,
        end_time: str,
        agent_id: str | None = None,
        action: str | None = None,
        limit: int | None = None,
    ) -> list[AuditRecord]:
        """
        Return decisions within a time window.

        Both bounds are inclusive ISO 8601 strings.  Omit ``agent_id`` or
        ``action`` to search across all agents / actions.
        """
        return await self._storage.query(
            AuditFilter(
                start_time=start_time,
                end_time=end_time,
                agent_id=agent_id,
                action=action,
                limit=limit,
            )
        )

    async def count(self) -> int:
        """Return the total number of records currently in the store."""
        return await self._storage.count()
