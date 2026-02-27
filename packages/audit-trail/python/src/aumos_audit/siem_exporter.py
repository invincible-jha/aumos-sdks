# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
SIEM integration exporter for AumOS audit records.

Provides export to two industry-standard SIEM formats:
- CEF (Common Event Format) for Splunk, QRadar, and ArcSight
- Syslog (RFC 5424) for general-purpose SIEM ingestion

This module is recording-only — it transforms existing audit records
into SIEM-compatible event strings. It does not perform anomaly detection,
real-time alerting, or any analytical processing.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

# Import the canonical AuditRecord from the existing audit_trail package.
from audit_trail.types import AuditRecord


# ---------------------------------------------------------------------------
# Configuration models
# ---------------------------------------------------------------------------


class SiemExporterConfig(BaseModel, frozen=True):
    """Configuration for the SIEM exporter."""

    vendor: str = Field(
        default="AumOS",
        description="Vendor name used in CEF headers.",
    )
    product: str = Field(
        default="AuditTrail",
        description="Product name used in CEF headers.",
    )
    product_version: str = Field(
        default="1.0",
        description="Product version used in CEF headers.",
    )
    syslog_app_name: str = Field(
        default="aumos-audit",
        description="APP-NAME field for RFC 5424 syslog messages.",
    )
    syslog_hostname: str = Field(
        default="-",
        description="HOSTNAME field for RFC 5424 syslog messages. '-' means nilvalue.",
    )
    syslog_facility: int = Field(
        default=16,
        ge=0,
        le=23,
        description="Syslog facility code (default 16 = local0).",
    )


# ---------------------------------------------------------------------------
# CEF helpers
# ---------------------------------------------------------------------------


def _cef_severity(record: AuditRecord) -> int:
    """
    Map a governance decision to a CEF severity level (0–10).

    Denied actions receive a higher severity since they represent
    governance interventions that security teams should be aware of.
    """
    if not record.permitted:
        return 7  # High — action was blocked
    return 3  # Low — action was permitted


def _escape_cef_header(value: str) -> str:
    """Escape a CEF header field value per the ArcSight CEF specification."""
    return value.replace("\\", "\\\\").replace("|", "\\|")


def _escape_cef_extension(value: str) -> str:
    """Escape a CEF extension field value per the ArcSight CEF specification."""
    return value.replace("\\", "\\\\").replace("=", "\\=").replace("\n", "\\n")


def _build_cef_extensions(record: AuditRecord) -> str:
    """Build the CEF extension key=value pairs for a single audit record."""
    pairs: list[str] = [
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
        pairs.extend(["cn1Label=trustLevel", f"cn1={record.trust_level}"])
    if record.required_level is not None:
        pairs.extend(["cn2Label=requiredLevel", f"cn2={record.required_level}"])
    if record.budget_used is not None:
        pairs.extend(["cn3Label=budgetUsed", f"cn3={record.budget_used}"])
    if record.budget_remaining is not None:
        pairs.extend(["cn4Label=budgetRemaining", f"cn4={record.budget_remaining}"])
    if record.reason is not None:
        pairs.append(f"msg={_escape_cef_extension(record.reason)}")
    if record.metadata is not None:
        pairs.append(
            f"cs4Label=metadata cs4={_escape_cef_extension(json.dumps(record.metadata, ensure_ascii=False))}"
        )

    return " ".join(pairs)


# ---------------------------------------------------------------------------
# Syslog (RFC 5424) helpers
# ---------------------------------------------------------------------------


_SYSLOG_SEVERITY_MAP: dict[bool, int] = {
    True: 6,   # Informational — permitted action
    False: 4,  # Warning — denied action
}


def _syslog_priority(facility: int, permitted: bool) -> int:
    """Compute RFC 5424 PRI value from facility and severity."""
    severity = _SYSLOG_SEVERITY_MAP[permitted]
    return (facility * 8) + severity


def _build_structured_data(record: AuditRecord) -> str:
    """
    Build RFC 5424 structured-data from an audit record.

    Uses the enterprise number space for AumOS-specific SD-IDs.
    """
    params: list[str] = [
        f'recordId="{record.id}"',
        f'agentId="{record.agent_id}"',
        f'action="{record.action}"',
        f'permitted="{record.permitted}"',
        f'recordHash="{record.record_hash}"',
        f'previousHash="{record.previous_hash}"',
    ]

    if record.trust_level is not None:
        params.append(f'trustLevel="{record.trust_level}"')
    if record.required_level is not None:
        params.append(f'requiredLevel="{record.required_level}"')
    if record.budget_used is not None:
        params.append(f'budgetUsed="{record.budget_used}"')
    if record.budget_remaining is not None:
        params.append(f'budgetRemaining="{record.budget_remaining}"')
    if record.reason is not None:
        # Escape quotes and backslashes in SD-PARAM values per RFC 5424
        escaped_reason = record.reason.replace("\\", "\\\\").replace('"', '\\"')
        params.append(f'reason="{escaped_reason}"')

    return "[aumos@0 " + " ".join(params) + "]"


# ---------------------------------------------------------------------------
# SiemExporter
# ---------------------------------------------------------------------------


class SiemExporter:
    """
    Exports AumOS audit records to SIEM-compatible formats.

    This exporter is stateless and read-only. It transforms existing
    AuditRecord instances into CEF or Syslog event strings for ingestion
    by SIEM platforms such as Splunk, QRadar, Elastic SIEM, or any
    RFC 5424-compliant syslog receiver.

    Usage::

        exporter = SiemExporter()
        cef_events = exporter.export_cef(records)
        syslog_events = exporter.export_syslog(records)
    """

    def __init__(self, config: SiemExporterConfig | None = None) -> None:
        self._config = config or SiemExporterConfig()

    def export_cef(self, records: list[AuditRecord]) -> list[str]:
        """
        Export audit records to CEF (Common Event Format) lines.

        Each record produces one CEF event line following the format:
        ``CEF:0|Vendor|Product|Version|SignatureId|Name|Severity|Extensions``

        Args:
            records: List of AuditRecord instances to export.

        Returns:
            A list of CEF event strings, one per record.
        """
        result: list[str] = []
        for record in records:
            severity = _cef_severity(record)
            signature_id = _escape_cef_header(record.action)
            name = _escape_cef_header(f"Governance Decision: {record.action}")
            vendor = _escape_cef_header(self._config.vendor)
            product = _escape_cef_header(self._config.product)
            version = _escape_cef_header(self._config.product_version)
            extensions = _build_cef_extensions(record)

            line = (
                f"CEF:0|{vendor}|{product}|{version}"
                f"|{signature_id}|{name}|{severity}|{extensions}"
            )
            result.append(line)
        return result

    def export_syslog(self, records: list[AuditRecord]) -> list[str]:
        """
        Export audit records to RFC 5424 syslog messages.

        Each record produces one syslog message with structured data
        containing all governance decision fields.

        Args:
            records: List of AuditRecord instances to export.

        Returns:
            A list of RFC 5424-formatted syslog message strings.
        """
        result: list[str] = []
        for record in records:
            priority = _syslog_priority(self._config.syslog_facility, record.permitted)
            hostname = self._config.syslog_hostname
            app_name = self._config.syslog_app_name
            msg_id = record.action
            structured_data = _build_structured_data(record)

            outcome = "permitted" if record.permitted else "denied"
            message = f"agent={record.agent_id} action={record.action} outcome={outcome}"

            # RFC 5424: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID SD MSG
            line = (
                f"<{priority}>1 {record.timestamp} {hostname} "
                f"{app_name} - {msg_id} {structured_data} {message}"
            )
            result.append(line)
        return result

    def export_cef_string(self, records: list[AuditRecord]) -> str:
        """Export audit records to a single newline-separated CEF string."""
        return "\n".join(self.export_cef(records))

    def export_syslog_string(self, records: list[AuditRecord]) -> str:
        """Export audit records to a single newline-separated syslog string."""
        return "\n".join(self.export_syslog(records))
