# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
OpenTelemetry semantic conventions for AumOS governance observability.

This module mirrors ``typescript/src/otel-conventions.ts`` exactly so that
Python and TypeScript services emit identical attribute keys and span names,
allowing a single OTel collector pipeline to ingest traces from both runtimes
without field-mapping gymnastics.

Usage::

    from audit_trail.otel_conventions import GOVERNANCE_SEMANTIC_CONVENTIONS

    span.set_attribute(
        GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_DECISION,
        "permitted",
    )

All attributes are frozen at import time — the dataclass uses
``frozen=True, slots=True`` so no field can be accidentally overwritten.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class _GovernanceSemanticConventions:
    """
    Typed container for every AumOS governance semantic convention.

    Prefer accessing values through the module-level singleton
    ``GOVERNANCE_SEMANTIC_CONVENTIONS`` rather than constructing this class
    directly.
    """

    # -------------------------------------------------------------------------
    # Trust governance attributes
    #
    # Capture the outcome of a trust evaluation without recording how that
    # level was originally established.  Trust level changes are always manual;
    # these attributes are read-only snapshots at the moment of the decision.
    # -------------------------------------------------------------------------

    AI_GOVERNANCE_TRUST_LEVEL: str = "ai.governance.trust.level"
    """Integer trust level held by the agent at decision time."""

    AI_GOVERNANCE_TRUST_REQUIRED: str = "ai.governance.trust.required"
    """Minimum trust level required for the requested action to be permitted."""

    AI_GOVERNANCE_TRUST_DECISION: str = "ai.governance.trust.decision"
    """Human-readable outcome of the trust evaluation: ``"passed"`` or ``"failed"``."""

    # -------------------------------------------------------------------------
    # Budget governance attributes
    #
    # Record static budget limits and point-in-time spending snapshots.
    # No adaptive or ML-derived values are ever included here.
    # -------------------------------------------------------------------------

    AI_GOVERNANCE_BUDGET_LIMIT: str = "ai.governance.budget.limit"
    """Configured maximum spend limit for this budget period."""

    AI_GOVERNANCE_BUDGET_REMAINING: str = "ai.governance.budget.remaining"
    """Remaining balance in the budget after the current operation."""

    AI_GOVERNANCE_BUDGET_COST: str = "ai.governance.budget.cost"
    """Cost charged by this specific operation."""

    AI_GOVERNANCE_BUDGET_CURRENCY: str = "ai.governance.budget.currency"
    """ISO 4217 currency code (e.g. ``"USD"``) or token unit (e.g. ``"tokens"``)."""

    # -------------------------------------------------------------------------
    # Consent governance attributes
    # -------------------------------------------------------------------------

    AI_GOVERNANCE_CONSENT_STATUS: str = "ai.governance.consent.status"
    """
    Current consent status for the data subject or operation scope.
    Canonical values: ``"granted"``, ``"revoked"``, ``"absent"``.
    """

    AI_GOVERNANCE_CONSENT_PURPOSE: str = "ai.governance.consent.purpose"
    """Processing purpose for which consent was requested or evaluated."""

    # -------------------------------------------------------------------------
    # Decision attributes
    # -------------------------------------------------------------------------

    AI_GOVERNANCE_DECISION: str = "ai.governance.decision"
    """
    Overall governance decision.
    Canonical values: ``"permitted"``, ``"denied"``.
    """

    AI_GOVERNANCE_DECISION_REASON: str = "ai.governance.decision.reason"
    """
    Free-form human-readable explanation for the governance decision.
    Maps directly to ``AuditRecord.reason``.
    """

    # -------------------------------------------------------------------------
    # Audit chain attributes
    # -------------------------------------------------------------------------

    AI_GOVERNANCE_AUDIT_RECORD_ID: str = "ai.governance.audit.record_id"
    """UUID of the AuditRecord produced for this governance event."""

    AI_GOVERNANCE_AUDIT_CHAIN_HASH: str = "ai.governance.audit.chain_hash"
    """
    SHA-256 chain hash of the AuditRecord.  Including the hash in the span lets
    operators verify that the trace was not produced from a mutated record.
    """

    # -------------------------------------------------------------------------
    # Agent identity attributes
    # -------------------------------------------------------------------------

    AI_AGENT_ID: str = "ai.agent.id"
    """Stable unique identifier for the agent (e.g. ``"agent-crm-001"``)."""

    AI_AGENT_NAME: str = "ai.agent.name"
    """Human-readable name for the agent (e.g. ``"CRM Assistant"``)."""

    AI_AGENT_FRAMEWORK: str = "ai.agent.framework"
    """
    Name of the agent framework (e.g. ``"openai-agents"``, ``"langchain"``,
    ``"aumos-governance"``).
    """

    # -------------------------------------------------------------------------
    # Canonical span names
    # -------------------------------------------------------------------------

    SPAN_GOVERNANCE_EVALUATE: str = "ai.governance.evaluate"
    """Top-level span wrapping an end-to-end governance evaluation."""

    SPAN_TRUST_CHECK: str = "ai.governance.trust_check"
    """Child span for the trust-level evaluation step."""

    SPAN_BUDGET_CHECK: str = "ai.governance.budget_check"
    """Child span for the budget-limit evaluation step."""

    SPAN_CONSENT_CHECK: str = "ai.governance.consent_check"
    """Child span for the consent-status evaluation step."""

    SPAN_AUDIT_LOG: str = "ai.governance.audit_log"
    """Child span representing the audit-record write to persistent storage."""


#: Module-level singleton — import and use this directly.
GOVERNANCE_SEMANTIC_CONVENTIONS: _GovernanceSemanticConventions = (
    _GovernanceSemanticConventions()
)

__all__ = [
    "GOVERNANCE_SEMANTIC_CONVENTIONS",
    "_GovernanceSemanticConventions",
]
