# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
SHA-256 hash chain for immutable audit record linkage.

Each record is linked to its predecessor via a SHA-256 digest, making
retrospective tampering detectable — any modification to a record invalidates
every subsequent hash in the chain.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from audit_trail.record import finalise_record
from audit_trail.types import AuditRecord, ChainVerificationResult
from audit_trail.types import ChainVerificationSuccess, ChainVerificationFailure

# The hash value that precedes the very first record in any chain.
# Using 64 zero hex characters mirrors the Bitcoin genesis block convention
# and makes the genesis condition explicit and detectable.
GENESIS_HASH: str = "0" * 64


def _canonicalise(pending: dict[str, Any]) -> str:
    """
    Produce a deterministic JSON string from a pending record dict.

    Keys are sorted alphabetically so that two dicts with the same fields in
    different insertion orders produce identical digests.  This protects against
    subtle chain breaks caused by non-deterministic serialisation.
    """
    return json.dumps(pending, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _compute_hash(pending: dict[str, Any], previous_hash: str) -> str:
    """
    Compute a SHA-256 digest over the canonical serialisation of a pending
    record combined with the previous record's hash.

    Input: ``<canonicalJSON>\\n<previousHash>``
    The newline separator ensures the two fields cannot overlap.
    """
    payload = _canonicalise(pending) + "\n" + previous_hash
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class HashChain:
    """
    Maintains the running hash state of an append-only audit log.

    Thread safety: this class is not thread-safe.  In concurrent environments
    callers must serialise calls to ``append``.

    Parameters
    ----------
    initial_hash:
        Seed the chain at a known tip.  Pass the stored last hash when
        restoring chain state from durable storage.  Defaults to the genesis
        hash (64 zeros).
    """

    def __init__(self, initial_hash: str | None = None) -> None:
        self._last_record_hash: str = initial_hash or GENESIS_HASH

    def append(self, pending: dict[str, Any]) -> AuditRecord:
        """
        Link a pending record dict into the chain.

        Computes the SHA-256 digest of the pending dict combined with the
        previous hash, advances the chain tip, and returns the completed
        immutable ``AuditRecord`` with ``record_hash`` populated.
        """
        record_hash = _compute_hash(pending, self._last_record_hash)
        self._last_record_hash = record_hash
        return finalise_record(pending, record_hash)

    def verify(self, records: list[AuditRecord]) -> ChainVerificationResult:
        """
        Walk every record in ``records`` from index 0 and re-derive each
        expected hash from scratch, comparing it against the stored value.

        A failure at index ``i`` means record ``i`` was altered or the chain
        was seeded with a different genesis hash.

        Returns
        -------
        ChainVerificationSuccess
            When every record link is intact.
        ChainVerificationFailure
            At the first detected discrepancy, with index and reason.
        """
        expected_previous_hash = GENESIS_HASH

        for index, record in enumerate(records):
            # Verify the previousHash link.
            if record.previous_hash != expected_previous_hash:
                return ChainVerificationFailure(
                    record_count=len(records),
                    broken_at=index,
                    reason=(
                        f"Record at index {index} has previous_hash "
                        f'"{record.previous_hash}" but expected '
                        f'"{expected_previous_hash}".'
                    ),
                )

            # Reconstruct the pending dict (everything except record_hash)
            # and re-compute the digest.
            pending = record.model_dump(mode="json", exclude={"record_hash"})
            # Exclude None values to match how build_pending_record omits them.
            pending = {k: v for k, v in pending.items() if v is not None}

            expected_hash = _compute_hash(pending, expected_previous_hash)

            if record.record_hash != expected_hash:
                return ChainVerificationFailure(
                    record_count=len(records),
                    broken_at=index,
                    reason=(
                        f'Record at index {index} (id="{record.id}") has '
                        f'record_hash "{record.record_hash}" but recomputed '
                        f'hash is "{expected_hash}". '
                        f"Record content may have been altered."
                    ),
                )

            expected_previous_hash = record.record_hash

        return ChainVerificationSuccess(record_count=len(records))

    def last_hash(self) -> str:
        """
        Return the hash of the most recently appended record, or the genesis
        hash when no records have been appended yet.
        """
        return self._last_record_hash
