# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
aumos-audit — Enterprise extensions for the AumOS audit trail.

Provides SIEM export, tamper verification, compliance evidence generation,
and analytics dashboard data. All modules are recording-only — no anomaly
detection, counterfactual analysis, or real-time alerting.
"""

from aumos_audit.analytics import DashboardData, generate_dashboard_data, export_dashboard_json
from aumos_audit.compliance_evidence import (
    ComplianceEvidence,
    ComplianceStandard,
    generate_evidence,
    export_evidence_json,
    export_evidence_markdown,
)
from aumos_audit.siem_exporter import SiemExporter, SiemExporterConfig
from aumos_audit.tamper_verify import (
    VerificationResult,
    verify_chain,
    format_verification_result,
)

__all__ = [
    # SIEM
    "SiemExporter",
    "SiemExporterConfig",
    # Tamper verification
    "VerificationResult",
    "verify_chain",
    "format_verification_result",
    # Compliance
    "ComplianceEvidence",
    "ComplianceStandard",
    "generate_evidence",
    "export_evidence_json",
    "export_evidence_markdown",
    # Analytics
    "DashboardData",
    "generate_dashboard_data",
    "export_dashboard_json",
]
