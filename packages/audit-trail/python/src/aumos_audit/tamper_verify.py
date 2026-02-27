# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
Hash chain tamper verification for AumOS audit records.

Provides standalone verification of SHA-256 hash chain integrity on a
list of AuditRecord instances. This module is purely read-only — it
inspects existing records and reports on chain integrity without
modifying any data.
"""

from __future__ import annotations

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, Field

from audit_trail.types import AuditRecord

# The genesis hash used as the previous_hash of the very first record.
# Matches the convention in audit_trail.chain.
GENESIS_HASH: str = "0" * 64


# ---------------------------------------------------------------------------
# Result models
# ---------------------------------------------------------------------------


class BrokenLink(BaseModel, frozen=True):
    """Details about a single broken link in the hash chain."""

    index: int = Field(..., ge=0, description="Zero-based index of the broken record.")
    record_id: str = Field(..., description="ID of the record at the broken link.")
    expected_hash: str = Field(..., description="Hash that was expected based on recomputation.")
    actual_hash: str = Field(..., description="Hash that was found on the record.")
    issue: str = Field(..., description="Human-readable description of the issue.")


class VerificationResult(BaseModel, frozen=True):
    """
    Result of verifying the integrity of an audit record hash chain.

    If ``tamper_detected`` is True, the ``first_broken_link`` field
    identifies the earliest point of chain corruption.
    """

    tamper_detected: bool = Field(
        ..., description="True if any hash chain link is broken."
    )
    total_records: int = Field(
        ..., ge=0, description="Total number of records inspected."
    )
    total_verified: int = Field(
        ...,
        ge=0,
        description="Number of records that passed verification before the first break.",
    )
    first_broken_link: BrokenLink | None = Field(
        default=None,
        description="Details of the first detected broken link, or None if chain is intact.",
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _canonicalise(pending: dict[str, object]) -> str:
    """
    Produce a deterministic JSON string from a pending record dict.

    Keys are sorted so that identical fields in different insertion orders
    produce the same digest.
    """
    return json.dumps(pending, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _compute_hash(pending: dict[str, object], previous_hash: str) -> str:
    """
    Recompute the SHA-256 digest for a pending record dict.

    The input is ``<canonicalJSON>\\n<previousHash>`` which matches the
    convention used by ``audit_trail.chain.HashChain``.
    """
    payload = _canonicalise(pending) + "\n" + previous_hash
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def verify_chain(records: list[AuditRecord]) -> VerificationResult:
    """
    Verify the SHA-256 hash chain integrity of a list of audit records.

    Walks every record from index 0 and re-derives each expected hash
    from scratch. Verification stops at the first detected discrepancy.

    This function is purely read-only and does not modify any records.

    Args:
        records: List of AuditRecord instances in chain order (oldest first).

    Returns:
        A VerificationResult indicating whether the chain is intact
        or where the first broken link was found.
    """
    if not records:
        return VerificationResult(
            tamper_detected=False,
            total_records=0,
            total_verified=0,
            first_broken_link=None,
        )

    expected_previous_hash = GENESIS_HASH

    for index, record in enumerate(records):
        # Check the previous_hash link
        if record.previous_hash != expected_previous_hash:
            return VerificationResult(
                tamper_detected=True,
                total_records=len(records),
                total_verified=index,
                first_broken_link=BrokenLink(
                    index=index,
                    record_id=record.id,
                    expected_hash=expected_previous_hash,
                    actual_hash=record.previous_hash,
                    issue=(
                        f"Record at index {index} has previous_hash "
                        f'"{record.previous_hash}" but expected '
                        f'"{expected_previous_hash}".'
                    ),
                ),
            )

        # Reconstruct the pending dict (everything except record_hash)
        pending = record.model_dump(mode="json", exclude={"record_hash"})
        # Exclude None values to match how build_pending_record omits them
        pending = {k: v for k, v in pending.items() if v is not None}

        expected_hash = _compute_hash(pending, expected_previous_hash)

        if record.record_hash != expected_hash:
            return VerificationResult(
                tamper_detected=True,
                total_records=len(records),
                total_verified=index,
                first_broken_link=BrokenLink(
                    index=index,
                    record_id=record.id,
                    expected_hash=expected_hash,
                    actual_hash=record.record_hash,
                    issue=(
                        f"Record at index {index} (id={record.id!r}) has "
                        f'record_hash "{record.record_hash}" but recomputed '
                        f'hash is "{expected_hash}". '
                        f"Record content may have been altered."
                    ),
                ),
            )

        expected_previous_hash = record.record_hash

    return VerificationResult(
        tamper_detected=False,
        total_records=len(records),
        total_verified=len(records),
        first_broken_link=None,
    )


def format_verification_result(result: VerificationResult) -> str:
    """
    Format a VerificationResult as a human-readable string suitable
    for CLI output.

    Args:
        result: The verification result to format.

    Returns:
        A multi-line string summarising the verification outcome.
    """
    lines: list[str] = []
    lines.append("=== Audit Chain Verification ===")
    lines.append(f"Total records:  {result.total_records}")
    lines.append(f"Verified:       {result.total_verified}")

    if result.tamper_detected:
        lines.append("Status:         TAMPER DETECTED")
        if result.first_broken_link is not None:
            link = result.first_broken_link
            lines.append(f"Broken at:      index {link.index} (record {link.record_id})")
            lines.append(f"Expected hash:  {link.expected_hash}")
            lines.append(f"Actual hash:    {link.actual_hash}")
            lines.append(f"Issue:          {link.issue}")
    else:
        lines.append("Status:         CHAIN INTACT")

    return "\n".join(lines)
