# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
from __future__ import annotations

from datetime import datetime, timezone

from pydantic import BaseModel, Field


class ConsentRecord(BaseModel, frozen=True):
    """
    An immutable record of a consent grant.

    Attributes:
        agent_id: The agent for whom consent was recorded.
        data_type: The category or type of data covered by this consent.
        purpose: Optional purpose string further narrowing the consent scope.
        granted_by: Identifier of the entity (human or system) that granted consent.
        granted_at: UTC timestamp when consent was recorded.
        expires_at: Optional UTC timestamp after which consent is no longer valid.
    """

    agent_id: str
    data_type: str
    purpose: str | None = None
    granted_by: str
    granted_at: datetime = Field(
        default_factory=lambda: datetime.now(tz=timezone.utc)
    )
    expires_at: datetime | None = None

    def is_expired(self) -> bool:
        """Return True if this consent record has passed its expiry time."""
        if self.expires_at is None:
            return False
        return datetime.now(tz=timezone.utc) >= self.expires_at

    def matches(
        self,
        agent_id: str,
        data_type: str,
        purpose: str | None = None,
    ) -> bool:
        """
        Check whether this record covers the given agent/data/purpose combination.

        Purpose matching is intentionally permissive: a record with
        ``purpose=None`` covers ALL purposes for that agent+data_type pair.
        A record with a specific purpose only covers that exact purpose.

        Args:
            agent_id: The agent ID to match.
            data_type: The data type to match.
            purpose: The purpose to match (None matches any).

        Returns:
            True if this record applies and has not expired.
        """
        if self.is_expired():
            return False
        if self.agent_id != agent_id:
            return False
        if self.data_type != data_type:
            return False
        # A record with purpose=None covers all purposes.
        if self.purpose is None:
            return True
        # A record with a specific purpose only matches that purpose.
        return self.purpose == purpose


def _make_consent_key(
    agent_id: str,
    data_type: str,
    purpose: str | None,
) -> tuple[str, str, str | None]:
    """Create a hashable lookup key for a consent record."""
    return (agent_id, data_type, purpose)


class ConsentStore:
    """
    In-memory store for consent records.

    Records are keyed by (agent_id, data_type, purpose). A record with
    purpose=None represents blanket consent for all purposes of that
    agent+data_type combination.
    """

    def __init__(self) -> None:
        self._records: dict[tuple[str, str, str | None], ConsentRecord] = {}

    def put(self, record: ConsentRecord) -> None:
        """
        Store or replace a consent record.

        If a record for the same (agent_id, data_type, purpose) already
        exists it is overwritten.

        Args:
            record: The :class:`ConsentRecord` to store.
        """
        key = _make_consent_key(record.agent_id, record.data_type, record.purpose)
        self._records[key] = record

    def find(
        self,
        agent_id: str,
        data_type: str,
        purpose: str | None = None,
    ) -> ConsentRecord | None:
        """
        Find an active consent record.

        Lookup strategy:
        1. Exact match: (agent_id, data_type, purpose).
        2. Blanket match: (agent_id, data_type, None) — covers all purposes.

        Returns the first matching non-expired record, or None.

        Args:
            agent_id: The agent ID to search for.
            data_type: The data type to search for.
            purpose: Optional purpose to narrow the search.

        Returns:
            A :class:`ConsentRecord` if found and not expired, else None.
        """
        # 1. Try exact match first.
        if purpose is not None:
            exact_key = _make_consent_key(agent_id, data_type, purpose)
            exact = self._records.get(exact_key)
            if exact is not None and not exact.is_expired():
                return exact

        # 2. Try blanket (purpose=None) match.
        blanket_key = _make_consent_key(agent_id, data_type, None)
        blanket = self._records.get(blanket_key)
        if blanket is not None and not blanket.is_expired():
            return blanket

        return None

    def remove(
        self,
        agent_id: str,
        data_type: str,
        purpose: str | None = None,
    ) -> bool:
        """
        Remove a consent record.

        Args:
            agent_id: The agent ID.
            data_type: The data type.
            purpose: The purpose (None removes the blanket record).

        Returns:
            True if a record was removed, False if none was found.
        """
        key = _make_consent_key(agent_id, data_type, purpose)
        if key in self._records:
            del self._records[key]
            return True
        return False

    def remove_all_for_agent(self, agent_id: str) -> int:
        """
        Remove all consent records for a specific agent.

        Args:
            agent_id: The agent whose records should be removed.

        Returns:
            The number of records removed.
        """
        keys_to_delete = [
            key for key in self._records if key[0] == agent_id
        ]
        for key in keys_to_delete:
            del self._records[key]
        return len(keys_to_delete)

    def list_for_agent(self, agent_id: str) -> list[ConsentRecord]:
        """
        Return all consent records for a specific agent.

        Expired records are included — callers can filter using
        :meth:`ConsentRecord.is_expired` if needed.

        Args:
            agent_id: The agent ID to query.

        Returns:
            List of :class:`ConsentRecord` objects.
        """
        return [
            record
            for key, record in self._records.items()
            if key[0] == agent_id
        ]

    def count(self) -> int:
        """Return the total number of stored consent records."""
        return len(self._records)
