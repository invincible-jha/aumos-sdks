# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
Abstract base class that every storage backend must implement.

Implementations must guarantee append-only semantics: records written through
``append`` must never be altered or deleted by the storage layer.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from audit_trail.types import AuditFilter, AuditRecord


class AuditStorage(ABC):
    """
    Contract for audit record persistence backends.

    The interface is intentionally minimal — callers interact with the full
    AuditLogger API; storage backends only need to satisfy these four operations.
    """

    @abstractmethod
    async def append(self, record: AuditRecord) -> None:
        """
        Persist a fully-formed audit record.

        Called after the hash chain has computed and embedded the record hash.
        Implementations must not modify the record before persisting it.
        """
        ...

    @abstractmethod
    async def query(self, audit_filter: AuditFilter) -> list[AuditRecord]:
        """
        Return records matching the given filter, in ascending timestamp order.
        """
        ...

    @abstractmethod
    async def all(self) -> list[AuditRecord]:
        """
        Return every record in the store, in ascending timestamp order.

        Used by the chain verifier which requires the full corpus.
        """
        ...

    @abstractmethod
    async def count(self) -> int:
        """Return the total number of records in the store."""
        ...
