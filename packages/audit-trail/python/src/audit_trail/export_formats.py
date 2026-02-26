# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
Export helpers — serialise AuditRecord lists to JSON, CSV, and CEF formats.

- JSON: standard JSON array, human-readable with 2-space indentation.
- CSV:  RFC 4180 CSV with a header row; all 13 fields present on every row.
- CEF:  ArcSight Common Event Format for SIEM integration (Splunk / ELK).
"""

from __future__ import annotations

import csv
import io
import json
from typing import Any

from audit_trail.types import AuditRecord

# ---------------------------------------------------------------------------
# JSON export
# ---------------------------------------------------------------------------


def export_json(records: list[AuditRecord]) -> str:
    """Serialise records to a JSON array string with 2-space indentation."""
    return json.dumps(
        [record.model_dump(mode="json") for record in records],
        indent=2,
        ensure_ascii=False,
    )


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------

CSV_COLUMNS: list[str] = [
    "id",
    "timestamp",
    "agent_id",
    "action",
    "permitted",
    "trust_level",
    "required_level",
    "budget_used",
    "budget_remaining",
    "reason",
    "metadata",
    "previous_hash",
    "record_hash",
]


def _record_to_csv_row(record: AuditRecord) -> list[str]:
    raw = record.model_dump(mode="json")
    row: list[str] = []
    for column in CSV_COLUMNS:
        value = raw.get(column)
        if value is None:
            row.append("")
        elif isinstance(value, dict):
            row.append(json.dumps(value, ensure_ascii=False))
        else:
            row.append(str(value))
    return row


def export_csv(records: list[AuditRecord]) -> str:
    """
    Serialise records to CSV format.

    The first row contains column headers.  All 13 fields are present on every
    row; optional fields that are absent on a particular record are left empty.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for record in records:
        writer.writerow(_record_to_csv_row(record))
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# CEF export (Common Event Format — SIEM integration)
# ---------------------------------------------------------------------------


def _cef_severity(record: AuditRecord) -> int:
    """Map a governance decision to a CEF severity level (0–10)."""
    if not record.permitted:
        return 7
    return 3


def _escape_cef_extension(value: str) -> str:
    """Escape a CEF extension field value per the ArcSight CEF spec."""
    return value.replace("\\", "\\\\").replace("=", "\\=")


def _escape_cef_header(value: str) -> str:
    """Escape a CEF header field value per the ArcSight CEF spec."""
    return value.replace("\\", "\\\\").replace("|", "\\|")


def _record_to_cef_line(record: AuditRecord) -> str:
    """
    Serialise a single AuditRecord to a CEF event line.

    Format:
    ``CEF:0|Vendor|Product|Version|SignatureId|Name|Severity|Extension``
    """
    severity = _cef_severity(record)
    signature_id = _escape_cef_header(record.action)
    name = _escape_cef_header(f"Governance Decision: {record.action}")

    extensions: list[str] = [
        f"rt={_escape_cef_extension(record.timestamp)}",
        f"src={_escape_cef_extension(record.agent_id)}",
        f"act={_escape_cef_extension(record.action)}",
        f"outcome={'permitted' if record.permitted else 'denied'}",
        "cs1Label=recordId",
        f"cs1={_escape_cef_extension(record.id)}",
        "cs2Label=previousHash",
        f"cs2={_escape_cef_extension(record.previous_hash)}",
        "cs3Label=recordHash",
        f"cs3={_escape_cef_extension(record.record_hash)}",
    ]

    if record.trust_level is not None:
        extensions += ["cn1Label=trustLevel", f"cn1={record.trust_level}"]
    if record.required_level is not None:
        extensions += ["cn2Label=requiredLevel", f"cn2={record.required_level}"]
    if record.budget_used is not None:
        extensions += ["cn3Label=budgetUsed", f"cn3={record.budget_used}"]
    if record.budget_remaining is not None:
        extensions += ["cn4Label=budgetRemaining", f"cn4={record.budget_remaining}"]
    if record.reason is not None:
        extensions.append(f"msg={_escape_cef_extension(record.reason)}")

    extension_string = " ".join(extensions)
    return f"CEF:0|AumOS|AuditTrail|1.0|{signature_id}|{name}|{severity}|{extension_string}"


def export_cef(records: list[AuditRecord]) -> str:
    """
    Serialise records to CEF format, one event per line.

    Compatible with Splunk Universal Forwarder and Elastic Agent syslog inputs.
    """
    return "\n".join(_record_to_cef_line(record) for record in records)


# ---------------------------------------------------------------------------
# Unified dispatcher
# ---------------------------------------------------------------------------


def export_records(records: list[AuditRecord], export_format: str) -> str:
    """
    Route export to the appropriate format handler.

    Parameters
    ----------
    records:
        The records to export.
    export_format:
        One of ``"json"``, ``"csv"``, or ``"cef"``.

    Raises
    ------
    ValueError
        When an unsupported format string is supplied.
    """
    if export_format == "json":
        return export_json(records)
    if export_format == "csv":
        return export_csv(records)
    if export_format == "cef":
        return export_cef(records)
    raise ValueError(f"Unsupported export format: {export_format!r}")
