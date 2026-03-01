# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
"""
hash-chained audit log for tamper-evident governance records.

Each record stores a SHA-256 hash of its own content combined with the hash
of the immediately preceding record. Appending a new record links it
cryptographically to all prior records so that any retrospective modification
of an earlier entry is detectable by re-verifying the chain.

Audit logging is RECORDING ONLY.  This module contains no anomaly detection,
pattern analysis, or counterfactual generation.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


@dataclass(frozen=True)
class ChainedAuditRecord:
    """
    An immutable, hash-chained audit record.

    Attributes:
        record_id: UUID string uniquely identifying this record.
        timestamp: ISO 8601 UTC timestamp string.
        agent_id: The agent that triggered the governance decision.
        action: Short label for the action being governed (e.g. "tool_call").
        decision: The governance outcome (e.g. "allow", "deny").
        details: Free-form dictionary of supplementary audit context.
        previous_hash: SHA-256 hex digest of the immediately preceding record.
            The genesis record uses a well-known constant as its previous_hash.
        record_hash: SHA-256 hex digest of this record's canonical fields
            (record_id, timestamp, agent_id, action, decision, details,
            previous_hash) encoded as UTF-8 JSON.
    """

    record_id: str
    timestamp: str
    agent_id: str
    action: str
    decision: str
    details: dict[str, object]
    previous_hash: str
    record_hash: str


# ---------------------------------------------------------------------------
# HashChainedAuditLog
# ---------------------------------------------------------------------------


class HashChainedAuditLog:
    """
    SHA-256 hash-chained audit log for tamper-evident governance records.

    Records are stored in an in-memory deque with an optional size cap.  When
    the cap is reached the oldest record is evicted (the chain integrity check
    covers only the records currently in memory).

    This class is a drop-in addition to :class:`~aumos_governance.audit.logger.AuditLogger`;
    it does not replace it.  Use both when you require both queryable records
    (AuditLogger) and tamper-evidence (HashChainedAuditLog).

    Example::

        log = HashChainedAuditLog()
        log.append("agent-1", "tool_call", "allow", {"resource": "reports/q1"})
        log.append("agent-1", "write", "deny", {"reason": "budget exceeded"})

        valid, error = log.verify_chain()
        assert valid, error
    """

    _GENESIS_HASH: str = hashlib.sha256(b"AUMOS_GENESIS_BLOCK").hexdigest()

    def __init__(self, max_size: int = 10_000) -> None:
        self._chain: deque[ChainedAuditRecord] = deque(maxlen=max_size)
        self._last_hash: str = self._GENESIS_HASH

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def append(
        self,
        agent_id: str,
        action: str,
        decision: str,
        details: Optional[dict[str, object]] = None,
    ) -> ChainedAuditRecord:
        """
        Append a new record to the chain.

        Args:
            agent_id: The agent performing the action.
            action: A short label for the action (e.g. "tool_call", "read").
            decision: The governance outcome (e.g. "allow", "deny", "review").
            details: Optional dict of supplementary context values.

        Returns:
            The newly created :class:`ChainedAuditRecord`.
        """
        record_id = str(uuid.uuid4())
        timestamp = datetime.now(tz=timezone.utc).isoformat()
        safe_details: dict[str, object] = details or {}

        record_hash = self._compute_record_hash(
            record_id=record_id,
            timestamp=timestamp,
            agent_id=agent_id,
            action=action,
            decision=decision,
            details=safe_details,
            previous_hash=self._last_hash,
        )

        record = ChainedAuditRecord(
            record_id=record_id,
            timestamp=timestamp,
            agent_id=agent_id,
            action=action,
            decision=decision,
            details=safe_details,
            previous_hash=self._last_hash,
            record_hash=record_hash,
        )

        self._chain.append(record)
        self._last_hash = record_hash
        return record

    def verify_chain(self) -> tuple[bool, Optional[str]]:
        """
        Verify the integrity of the entire in-memory chain.

        Walks every record from oldest to newest and confirms that:
        1. Each record's ``previous_hash`` matches the hash of the record
           that preceded it (or the genesis hash for the first record).
        2. Each record's ``record_hash`` matches the recomputed hash of its
           canonical fields.

        Returns:
            A ``(is_valid, error_message)`` tuple.  ``error_message`` is
            ``None`` when the chain is valid.
        """
        records = list(self._chain)
        if not records:
            return True, None

        expected_previous = self._GENESIS_HASH

        for index, record in enumerate(records):
            if record.previous_hash != expected_previous:
                return False, (
                    f"Record {index} (id={record.record_id}): "
                    f"previous_hash mismatch. "
                    f"Expected {expected_previous!r}, got {record.previous_hash!r}."
                )

            recomputed = self._compute_record_hash(
                record_id=record.record_id,
                timestamp=record.timestamp,
                agent_id=record.agent_id,
                action=record.action,
                decision=record.decision,
                details=record.details,
                previous_hash=record.previous_hash,
            )
            if record.record_hash != recomputed:
                return False, (
                    f"Record {index} (id={record.record_id}): "
                    f"record_hash mismatch — record may have been tampered with."
                )

            expected_previous = record.record_hash

        return True, None

    def get_records(
        self, agent_id: Optional[str] = None
    ) -> list[ChainedAuditRecord]:
        """
        Return all records, optionally filtered by agent_id.

        Args:
            agent_id: When provided, only records matching this agent ID are
                returned.  ``None`` returns all records.

        Returns:
            List of :class:`ChainedAuditRecord` in insertion order (oldest first).
        """
        records = list(self._chain)
        if agent_id is not None:
            records = [r for r in records if r.agent_id == agent_id]
        return records

    def count(self) -> int:
        """Return the number of records currently in the chain."""
        return len(self._chain)

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _genesis_hash() -> str:
        """Return the well-known genesis hash constant."""
        return hashlib.sha256(b"AUMOS_GENESIS_BLOCK").hexdigest()

    @staticmethod
    def _compute_record_hash(
        *,
        record_id: str,
        timestamp: str,
        agent_id: str,
        action: str,
        decision: str,
        details: dict[str, object],
        previous_hash: str,
    ) -> str:
        """
        Compute the SHA-256 digest for a record's canonical fields.

        The canonical representation is a JSON object with keys in a fixed
        order, serialised without trailing whitespace.
        """
        canonical: dict[str, object] = {
            "record_id": record_id,
            "timestamp": timestamp,
            "agent_id": agent_id,
            "action": action,
            "decision": decision,
            "details": details,
            "previous_hash": previous_hash,
        }
        serialised = json.dumps(canonical, separators=(",", ":"), sort_keys=False)
        return hashlib.sha256(serialised.encode("utf-8")).hexdigest()
