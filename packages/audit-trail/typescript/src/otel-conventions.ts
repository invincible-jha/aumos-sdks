// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * OpenTelemetry semantic conventions for AumOS governance observability.
 *
 * These attribute keys and span names follow the OpenTelemetry specification
 * naming scheme (`namespace.sub_namespace.attribute`) and are safe to embed
 * directly as span attributes, metric labels, or log record attributes.
 *
 * Use alongside the {@link GovernanceOTelExporter} or set them manually on
 * any OTel Span:
 *
 * ```typescript
 * span.setAttribute(GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_TRUST_LEVEL, 3);
 * span.setAttribute(GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_DECISION, 'permitted');
 * ```
 *
 * All keys in this object are `as const` — TypeScript narrows each value to
 * its exact string literal type, enabling type-safe attribute lookup.
 */
export const GOVERNANCE_SEMANTIC_CONVENTIONS = {
  // ---------------------------------------------------------------------------
  // Trust governance attributes
  //
  // Capture the outcome of a trust evaluation without recording how that
  // level was originally established.  Trust level changes are always manual;
  // these attributes are read-only snapshots at the moment of the decision.
  // ---------------------------------------------------------------------------

  /** Integer trust level held by the agent at decision time. */
  AI_GOVERNANCE_TRUST_LEVEL: "ai.governance.trust.level",

  /** Minimum trust level required for the requested action to be permitted. */
  AI_GOVERNANCE_TRUST_REQUIRED: "ai.governance.trust.required",

  /** Human-readable outcome of the trust evaluation: `"passed"` or `"failed"`. */
  AI_GOVERNANCE_TRUST_DECISION: "ai.governance.trust.decision",

  // ---------------------------------------------------------------------------
  // Budget governance attributes
  //
  // Record static budget limits and point-in-time spending snapshots.
  // No adaptive or ML-derived values are ever included here.
  // ---------------------------------------------------------------------------

  /** Configured maximum spend limit for this budget period. */
  AI_GOVERNANCE_BUDGET_LIMIT: "ai.governance.budget.limit",

  /** Remaining balance in the budget after the current operation. */
  AI_GOVERNANCE_BUDGET_REMAINING: "ai.governance.budget.remaining",

  /** Cost charged by this specific operation. */
  AI_GOVERNANCE_BUDGET_COST: "ai.governance.budget.cost",

  /** ISO 4217 currency code (e.g. `"USD"`) or token unit (e.g. `"tokens"`). */
  AI_GOVERNANCE_BUDGET_CURRENCY: "ai.governance.budget.currency",

  // ---------------------------------------------------------------------------
  // Consent governance attributes
  // ---------------------------------------------------------------------------

  /**
   * Current consent status for the data subject or operation scope.
   * Canonical values: `"granted"`, `"revoked"`, `"absent"`.
   */
  AI_GOVERNANCE_CONSENT_STATUS: "ai.governance.consent.status",

  /** Processing purpose for which consent was requested or evaluated. */
  AI_GOVERNANCE_CONSENT_PURPOSE: "ai.governance.consent.purpose",

  // ---------------------------------------------------------------------------
  // Decision attributes
  //
  // Top-level outcome of any governance evaluation.
  // ---------------------------------------------------------------------------

  /**
   * Overall governance decision.
   * Canonical values: `"permitted"`, `"denied"`.
   */
  AI_GOVERNANCE_DECISION: "ai.governance.decision",

  /**
   * Free-form human-readable explanation for the governance decision.
   * Maps directly to `AuditRecord.reason`.
   */
  AI_GOVERNANCE_DECISION_REASON: "ai.governance.decision.reason",

  // ---------------------------------------------------------------------------
  // Audit chain attributes
  //
  // Correlate an OTel span to the corresponding immutable audit record so that
  // distributed traces can be cross-referenced against the tamper-evident log.
  // ---------------------------------------------------------------------------

  /** UUID of the AuditRecord produced for this governance event. */
  AI_GOVERNANCE_AUDIT_RECORD_ID: "ai.governance.audit.record_id",

  /**
   * SHA-256 chain hash of the AuditRecord.  Including the hash in the span
   * lets operators verify that the trace was not produced from a mutated record.
   */
  AI_GOVERNANCE_AUDIT_CHAIN_HASH: "ai.governance.audit.chain_hash",

  // ---------------------------------------------------------------------------
  // Agent identity attributes
  //
  // Identify the AI agent that triggered the governance evaluation.
  // ---------------------------------------------------------------------------

  /** Stable unique identifier for the agent (e.g. `"agent-crm-001"`). */
  AI_AGENT_ID: "ai.agent.id",

  /** Human-readable name for the agent (e.g. `"CRM Assistant"`). */
  AI_AGENT_NAME: "ai.agent.name",

  /**
   * Name of the agent framework (e.g. `"openai-agents"`, `"langchain"`,
   * `"aumos-governance"`).
   */
  AI_AGENT_FRAMEWORK: "ai.agent.framework",

  // ---------------------------------------------------------------------------
  // Canonical span names
  //
  // Use these as the `name` argument to `tracer.startSpan()` so that trace
  // UIs group spans consistently across all AumOS-instrumented services.
  // ---------------------------------------------------------------------------

  /** Top-level span wrapping an end-to-end governance evaluation. */
  SPAN_GOVERNANCE_EVALUATE: "ai.governance.evaluate",

  /** Child span for the trust-level evaluation step. */
  SPAN_TRUST_CHECK: "ai.governance.trust_check",

  /** Child span for the budget-limit evaluation step. */
  SPAN_BUDGET_CHECK: "ai.governance.budget_check",

  /** Child span for the consent-status evaluation step. */
  SPAN_CONSENT_CHECK: "ai.governance.consent_check",

  /** Child span representing the audit-record write to persistent storage. */
  SPAN_AUDIT_LOG: "ai.governance.audit_log",
} as const;

/**
 * Union of every semantic convention attribute key defined above.
 *
 * Useful for narrowing a string to a known governance attribute:
 *
 * ```typescript
 * function assertGovernanceKey(key: GovernanceAttributeKey): void { ... }
 * ```
 */
export type GovernanceAttributeKey =
  (typeof GOVERNANCE_SEMANTIC_CONVENTIONS)[keyof typeof GOVERNANCE_SEMANTIC_CONVENTIONS];
