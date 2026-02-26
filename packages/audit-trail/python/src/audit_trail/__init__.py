# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
agent-audit-trail — Immutable, hash-chained decision logging for AI agent governance.

Public API surface:

    Classes:
        AuditLogger    — Primary logger: log(), query(), verify(), export_records(), count()
        HashChain      — Low-level hash-chain management (append + verify)
        AuditQuery     — Composable query facade over any AuditStorage backend
        MemoryStorage  — Volatile in-memory storage (default)
        FileStorage    — Append-only NDJSON file storage

    Functions:
        export_json     — Serialise records to JSON
        export_csv      — Serialise records to CSV
        export_cef      — Serialise records to CEF (SIEM)
        export_records  — Format-dispatching export helper

    Types:
        AuditRecord, GovernanceDecisionInput, AuditFilter,
        ChainVerificationResult, ChainVerificationSuccess,
        ChainVerificationFailure, AuditStorage
"""

from audit_trail.chain import HashChain
from audit_trail.export_formats import export_cef, export_csv, export_json, export_records
from audit_trail.logger import AuditLogger
from audit_trail.query import AuditQuery
from audit_trail.record import build_pending_record, finalise_record
from audit_trail.storage.file import FileStorage
from audit_trail.storage.interface import AuditStorage
from audit_trail.storage.memory import MemoryStorage
from audit_trail.types import (
    AuditFilter,
    AuditRecord,
    ChainVerificationFailure,
    ChainVerificationResult,
    ChainVerificationSuccess,
    GovernanceDecisionInput,
)

__all__ = [
    # Core classes
    "AuditLogger",
    "HashChain",
    "AuditQuery",
    # Storage
    "MemoryStorage",
    "FileStorage",
    "AuditStorage",
    # Record helpers
    "build_pending_record",
    "finalise_record",
    # Export helpers
    "export_json",
    "export_csv",
    "export_cef",
    "export_records",
    # Types
    "AuditRecord",
    "GovernanceDecisionInput",
    "AuditFilter",
    "ChainVerificationResult",
    "ChainVerificationSuccess",
    "ChainVerificationFailure",
]
