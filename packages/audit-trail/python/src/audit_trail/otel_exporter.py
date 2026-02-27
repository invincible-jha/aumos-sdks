# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 MuVeraAI Corporation

"""
OpenTelemetry governance exporter for AumOS audit events.

This module mirrors ``typescript/src/otel-exporter.ts`` and deliberately avoids
a hard dependency on ``opentelemetry-api``.  It defines the narrow subset of
OTel interfaces it requires as Python Protocols, so the package installs
cleanly whether or not the caller has OTel in their environment.

When OTel is present, pass your tracer (and optionally a meter provider) at
construction time and every governance event will be emitted as a span.  When
OTel is absent, every method becomes a safe no-op.

Usage::

    from opentelemetry import trace
    from audit_trail.otel_exporter import GovernanceOTelExporter

    exporter = GovernanceOTelExporter(
        tracer=trace.get_tracer("my-agent", "1.0.0"),
    )

    record = await logger.log(decision)
    exporter.export_decision(record)
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Generator, Literal

from audit_trail.otel_conventions import GOVERNANCE_SEMANTIC_CONVENTIONS
from audit_trail.types import AuditRecord

if TYPE_CHECKING:
    # These imports are only used for type checking; they do NOT create a
    # runtime dependency on opentelemetry-api.
    pass

# ---------------------------------------------------------------------------
# OTel span status codes (mirrors opentelemetry.trace.StatusCode)
# ---------------------------------------------------------------------------

_SPAN_STATUS_OK = 1
_SPAN_STATUS_ERROR = 2

# ---------------------------------------------------------------------------
# Minimal OTel Protocol interfaces
#
# We declare only the methods we actually call.  Real OTel objects satisfy
# these Protocols structurally; stub objects work equally well for testing.
# ---------------------------------------------------------------------------

from typing import Protocol, runtime_checkable


@runtime_checkable
class OTelSpan(Protocol):
    """Minimal span interface — a strict subset of opentelemetry-api Span."""

    def set_attribute(self, key: str, value: str | int | float | bool) -> None:
        """Set a single attribute on the span."""
        ...

    def set_status(self, status_code: int, description: str = "") -> None:
        """
        Set the span status.

        Parameters
        ----------
        status_code:
            1 = OK, 2 = ERROR (mirrors opentelemetry.trace.StatusCode).
        description:
            Optional human-readable message, typically used with ERROR status.
        """
        ...

    def end(self) -> None:
        """Finalise the span and flush it to the exporter pipeline."""
        ...


@runtime_checkable
class OTelTracer(Protocol):
    """Minimal tracer interface — a strict subset of opentelemetry-api Tracer."""

    def start_span(self, name: str) -> OTelSpan:
        """Create and start a new span with the given operation name."""
        ...


@runtime_checkable
class OTelMeter(Protocol):
    """Minimal meter interface — reserved for future metric recording."""

    def create_counter(self, name: str, unit: str = "", description: str = "") -> object:
        """Create a monotonically increasing counter instrument."""
        ...


@runtime_checkable
class OTelMeterProvider(Protocol):
    """Minimal meter provider interface."""

    def get_meter(self, name: str, version: str = "") -> OTelMeter:
        """Return a Meter for the given instrumentation scope."""
        ...


# ---------------------------------------------------------------------------
# Input dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class TrustCheckSnapshot:
    """Point-in-time snapshot of a trust evaluation."""

    agent_id: str
    """Agent whose trust level was evaluated."""

    trust_level: int
    """Trust level held by the agent at evaluation time."""

    required_level: int
    """Minimum trust level that was required."""

    passed: bool
    """Whether the trust check passed."""

    audit_record_id: str | None = None
    """Optional cross-reference to the AuditRecord that was produced."""

    audit_chain_hash: str | None = None
    """Optional chain hash of the AuditRecord."""


@dataclass(frozen=True, slots=True)
class BudgetCheckSnapshot:
    """Point-in-time snapshot of a budget evaluation."""

    agent_id: str
    """Agent whose budget was evaluated."""

    budget_limit: float
    """Configured maximum spend for the budget period."""

    budget_remaining: float
    """Balance remaining after this operation."""

    operation_cost: float
    """Cost charged by this specific operation."""

    currency: str
    """ISO 4217 currency code or token unit label."""

    passed: bool
    """Whether the budget check passed (i.e. funds were sufficient)."""

    audit_record_id: str | None = None
    """Optional cross-reference to the AuditRecord that was produced."""

    audit_chain_hash: str | None = None
    """Optional chain hash of the AuditRecord."""


@dataclass(frozen=True, slots=True)
class ConsentCheckSnapshot:
    """Point-in-time snapshot of a consent evaluation."""

    agent_id: str
    """Agent or data subject identifier whose consent was evaluated."""

    purpose: str
    """Processing purpose for which consent was checked."""

    consent_status: Literal["granted", "revoked", "absent"]
    """
    Consent status at evaluation time.
    Canonical values: ``"granted"``, ``"revoked"``, ``"absent"``.
    """

    passed: bool
    """Whether the consent check passed (i.e. consent was granted)."""

    audit_record_id: str | None = None
    """Optional cross-reference to the AuditRecord that was produced."""

    audit_chain_hash: str | None = None
    """Optional chain hash of the AuditRecord."""


# ---------------------------------------------------------------------------
# Exporter
# ---------------------------------------------------------------------------


class GovernanceOTelExporter:
    """
    Converts AumOS governance events into OpenTelemetry spans.

    The exporter is intentionally thin: it maps well-typed governance snapshots
    onto OTel attributes using the ``GOVERNANCE_SEMANTIC_CONVENTIONS`` keys.
    All business logic (trust evaluation, budget allocation, consent lookup)
    happens upstream; this class only records what occurred.

    Parameters
    ----------
    tracer:
        OTel tracer to use for span creation.  When ``None`` every export
        method is a safe no-op — spans are not emitted.
    meter_provider:
        OTel meter provider for future metric recording.  Currently accepted
        but unused so that a future metric implementation does not require a
        breaking API change.

    Examples
    --------
    ::

        from opentelemetry import trace
        from audit_trail.otel_exporter import GovernanceOTelExporter

        exporter = GovernanceOTelExporter(
            tracer=trace.get_tracer("my-service", "1.0.0"),
        )

        record = await logger.log(decision)
        exporter.export_decision(record)
    """

    def __init__(
        self,
        tracer: OTelTracer | None = None,
        meter_provider: OTelMeterProvider | None = None,
    ) -> None:
        self._tracer = tracer
        # meter_provider stored for future use; suppress lint warnings.
        self._meter_provider = meter_provider

    # -------------------------------------------------------------------------
    # Public export methods
    # -------------------------------------------------------------------------

    def export_decision(self, record: AuditRecord) -> None:
        """
        Emit a governance-decision span from a fully formed :class:`AuditRecord`.

        The span captures the complete outcome of a governance evaluation:
        agent identity, action requested, trust and budget snapshots (when
        present on the record), the decision outcome, and a cross-reference to
        the audit record via its ID and chain hash.

        The span status is set to OK for permitted decisions and ERROR for denied
        ones, which lets trace UIs highlight denied operations without any custom
        visualisation logic.

        Parameters
        ----------
        record:
            The immutable ``AuditRecord`` returned by ``AuditLogger.log()``.
        """
        with self._managed_span(GOVERNANCE_SEMANTIC_CONVENTIONS.SPAN_GOVERNANCE_EVALUATE) as span:
            if span is None:
                return

            # Agent identity
            span.set_attribute(GOVERNANCE_SEMANTIC_CONVENTIONS.AI_AGENT_ID, record.agent_id)

            # Decision outcome
            decision = "permitted" if record.permitted else "denied"
            span.set_attribute(GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_DECISION, decision)

            if record.reason is not None:
                span.set_attribute(
                    GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_DECISION_REASON,
                    record.reason,
                )

            # Trust snapshot
            if record.trust_level is not None:
                span.set_attribute(
                    GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_TRUST_LEVEL,
                    record.trust_level,
                )
            if record.required_level is not None:
                span.set_attribute(
                    GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_TRUST_REQUIRED,
                    record.required_level,
                )

            # Budget snapshot
            if record.budget_used is not None:
                span.set_attribute(
                    GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_BUDGET_COST,
                    record.budget_used,
                )
            if record.budget_remaining is not None:
                span.set_attribute(
                    GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_BUDGET_REMAINING,
                    record.budget_remaining,
                )

            # Audit chain cross-reference
            span.set_attribute(
                GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_RECORD_ID,
                record.id,
            )
            span.set_attribute(
                GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_CHAIN_HASH,
                record.record_hash,
            )

            # Span status
            if record.permitted:
                span.set_status(_SPAN_STATUS_OK)
            else:
                span.set_status(
                    _SPAN_STATUS_ERROR,
                    record.reason or "Governance decision: denied",
                )

    def export_trust_check(self, snapshot: TrustCheckSnapshot) -> None:
        """
        Emit a span representing a standalone trust-level evaluation.

        Use this when the trust check is performed as a distinct step from the
        full governance decision — for example, inside a GovernanceEngine that
        evaluates trust, budget, and consent as separate child spans.

        Parameters
        ----------
        snapshot:
            Point-in-time trust evaluation data.
        """
        with self._managed_span(GOVERNANCE_SEMANTIC_CONVENTIONS.SPAN_TRUST_CHECK) as span:
            if span is None:
                return

            span.set_attribute(GOVERNANCE_SEMANTIC_CONVENTIONS.AI_AGENT_ID, snapshot.agent_id)
            span.set_attribute(
                GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_TRUST_LEVEL,
                snapshot.trust_level,
            )
            span.set_attribute(
                GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_TRUST_REQUIRED,
                snapshot.required_level,
            )
            span.set_attribute(
                GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_TRUST_DECISION,
                "passed" if snapshot.passed else "failed",
            )

            if snapshot.audit_record_id is not None:
                span.set_attribute(
                    GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_RECORD_ID,
                    snapshot.audit_record_id,
                )
            if snapshot.audit_chain_hash is not None:
                span.set_attribute(
                    GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_CHAIN_HASH,
                    snapshot.audit_chain_hash,
                )

            if snapshot.passed:
                span.set_status(_SPAN_STATUS_OK)
            else:
                span.set_status(_SPAN_STATUS_ERROR, "Trust level insufficient")

    def export_budget_check(self, snapshot: BudgetCheckSnapshot) -> None:
        """
        Emit a span representing a standalone budget evaluation.

        Records the static budget limit, operation cost, and remaining balance —
        never any adaptive or ML-derived budget values.

        Parameters
        ----------
        snapshot:
            Point-in-time budget evaluation data.
        """
        with self._managed_span(GOVERNANCE_SEMANTIC_CONVENTIONS.SPAN_BUDGET_CHECK) as span:
            if span is None:
                return

            span.set_attribute(GOVERNANCE_SEMANTIC_CONVENTIONS.AI_AGENT_ID, snapshot.agent_id)
            span.set_attribute(
                GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_BUDGET_LIMIT,
                snapshot.budget_limit,
            )
            span.set_attribute(
                GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_BUDGET_REMAINING,
                snapshot.budget_remaining,
            )
            span.set_attribute(
                GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_BUDGET_COST,
                snapshot.operation_cost,
            )
            span.set_attribute(
                GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_BUDGET_CURRENCY,
                snapshot.currency,
            )

            if snapshot.audit_record_id is not None:
                span.set_attribute(
                    GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_RECORD_ID,
                    snapshot.audit_record_id,
                )
            if snapshot.audit_chain_hash is not None:
                span.set_attribute(
                    GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_CHAIN_HASH,
                    snapshot.audit_chain_hash,
                )

            if snapshot.passed:
                span.set_status(_SPAN_STATUS_OK)
            else:
                span.set_status(_SPAN_STATUS_ERROR, "Budget limit exceeded")

    def export_consent_check(self, snapshot: ConsentCheckSnapshot) -> None:
        """
        Emit a span representing a standalone consent evaluation.

        Parameters
        ----------
        snapshot:
            Point-in-time consent evaluation data.
        """
        with self._managed_span(GOVERNANCE_SEMANTIC_CONVENTIONS.SPAN_CONSENT_CHECK) as span:
            if span is None:
                return

            span.set_attribute(GOVERNANCE_SEMANTIC_CONVENTIONS.AI_AGENT_ID, snapshot.agent_id)
            span.set_attribute(
                GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_CONSENT_STATUS,
                snapshot.consent_status,
            )
            span.set_attribute(
                GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_CONSENT_PURPOSE,
                snapshot.purpose,
            )

            if snapshot.audit_record_id is not None:
                span.set_attribute(
                    GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_RECORD_ID,
                    snapshot.audit_record_id,
                )
            if snapshot.audit_chain_hash is not None:
                span.set_attribute(
                    GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_CHAIN_HASH,
                    snapshot.audit_chain_hash,
                )

            if snapshot.passed:
                span.set_status(_SPAN_STATUS_OK)
            else:
                span.set_status(
                    _SPAN_STATUS_ERROR,
                    f"Consent not granted for purpose: {snapshot.purpose}",
                )

    # -------------------------------------------------------------------------
    # Private helpers
    # -------------------------------------------------------------------------

    @contextmanager
    def _managed_span(self, name: str) -> Generator[OTelSpan | None, None, None]:
        """
        Context manager that starts a span if a tracer is configured.

        Yields ``None`` when no tracer is present so callers can guard with
        ``if span is None: return`` without a try/finally.

        When a span is yielded the context manager calls ``span.end()``
        on exit, even if the body raises an exception.
        """
        if self._tracer is None:
            yield None
            return

        span: OTelSpan = self._tracer.start_span(name)
        try:
            yield span
        finally:
            span.end()


__all__ = [
    "GovernanceOTelExporter",
    "TrustCheckSnapshot",
    "BudgetCheckSnapshot",
    "ConsentCheckSnapshot",
    "OTelSpan",
    "OTelTracer",
    "OTelMeter",
    "OTelMeterProvider",
]
