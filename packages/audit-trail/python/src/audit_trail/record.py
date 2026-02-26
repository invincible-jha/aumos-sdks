# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
Helpers for constructing AuditRecord instances.

The creation pipeline is intentionally split into two stages:

1. ``build_pending_record`` — assemble every field except ``record_hash``.
2. ``finalise_record`` — attach the hash computed by the HashChain.

This keeps the hashing logic fully inside ``chain.py`` while record
construction remains testable without a live chain.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from audit_trail.types import AuditRecord, GovernanceDecisionInput


def _generate_id() -> str:
    """Return a new UUID v4 string."""
    return str(uuid.uuid4())


def _current_timestamp() -> str:
    """Return the current UTC time as an ISO 8601 string with millisecond precision."""
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def build_pending_record(
    decision: GovernanceDecisionInput,
    previous_hash: str,
    record_id: str | None = None,
    timestamp: str | None = None,
) -> dict[str, Any]:
    """
    Construct the pending record dictionary that the hash chain will sign.

    Returns a plain ``dict`` rather than an ``AuditRecord`` because the
    ``record_hash`` field is absent at this stage.  The dict is used as the
    canonical serialisation input inside ``chain.py``.

    Parameters
    ----------
    decision:
        Caller-supplied governance decision data.
    previous_hash:
        SHA-256 hex digest of the immediately preceding record, or the
        genesis hash (64 zeros) for the first record in the chain.
    record_id:
        Override the auto-generated UUID (useful in tests for determinism).
    timestamp:
        Override the auto-generated timestamp (useful in tests).
    """
    pending: dict[str, Any] = {
        "id": record_id or _generate_id(),
        "timestamp": timestamp or _current_timestamp(),
        "agent_id": decision.agent_id,
        "action": decision.action,
        "permitted": decision.permitted,
        "previous_hash": previous_hash,
    }

    # Include optional fields only when present, so the canonical JSON
    # stays compact and the hash covers only present fields.
    if decision.trust_level is not None:
        pending["trust_level"] = decision.trust_level
    if decision.required_level is not None:
        pending["required_level"] = decision.required_level
    if decision.budget_used is not None:
        pending["budget_used"] = decision.budget_used
    if decision.budget_remaining is not None:
        pending["budget_remaining"] = decision.budget_remaining
    if decision.reason is not None:
        pending["reason"] = decision.reason
    if decision.metadata is not None:
        pending["metadata"] = decision.metadata

    return pending


def finalise_record(pending: dict[str, Any], record_hash: str) -> AuditRecord:
    """
    Attach the computed hash to a pending record dict and validate it into an
    immutable ``AuditRecord``.
    """
    return AuditRecord.model_validate({**pending, "record_hash": record_hash})
