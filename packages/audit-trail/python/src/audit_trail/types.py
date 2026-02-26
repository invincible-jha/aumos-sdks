# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
Shared type definitions for the audit-trail package.

All record models are frozen Pydantic v2 models — fields cannot be mutated
after construction, which mirrors the immutability guarantee of the hash chain.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class AuditRecord(BaseModel):
    """
    An immutable, hash-chained record of a single governance decision.

    ``record_hash`` is the SHA-256 digest of the record's canonical JSON
    representation combined with ``previous_hash``.  Any mutation to any field
    other than ``record_hash`` will cause chain verification to fail.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    timestamp: str
    agent_id: str
    action: str
    permitted: bool
    trust_level: int | None = None
    required_level: int | None = None
    budget_used: float | None = None
    budget_remaining: float | None = None
    reason: str | None = None
    metadata: dict[str, Any] | None = None
    previous_hash: str
    record_hash: str


class GovernanceDecisionInput(BaseModel):
    """
    Caller-supplied input for a single governance decision log entry.

    Hash fields are absent — the HashChain computes them on append.
    """

    model_config = ConfigDict(frozen=True)

    agent_id: str
    action: str
    permitted: bool
    trust_level: int | None = None
    required_level: int | None = None
    budget_used: float | None = None
    budget_remaining: float | None = None
    reason: str | None = None
    metadata: dict[str, Any] | None = None


class AuditFilter(BaseModel):
    """
    Filter parameters for querying the audit log.

    All fields are optional.  Omitting a field means no restriction on that
    dimension.
    """

    model_config = ConfigDict(frozen=True)

    agent_id: str | None = None
    action: str | None = None
    permitted: bool | None = None
    start_time: str | None = None
    end_time: str | None = None
    limit: int | None = None
    offset: int | None = None


class ChainVerificationSuccess(BaseModel):
    """Returned by HashChain.verify when every record link is intact."""

    model_config = ConfigDict(frozen=True)

    valid: bool = True
    record_count: int


class ChainVerificationFailure(BaseModel):
    """Returned by HashChain.verify when a broken link is detected."""

    model_config = ConfigDict(frozen=True)

    valid: bool = False
    record_count: int
    broken_at: int
    reason: str


ChainVerificationResult = ChainVerificationSuccess | ChainVerificationFailure

ExportFormat = str  # "json" | "csv" | "cef"
