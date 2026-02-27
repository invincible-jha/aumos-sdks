// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * OpenTelemetry governance exporter for AumOS audit events.
 *
 * This module deliberately avoids a hard dependency on `@opentelemetry/api`.
 * It defines the narrow subset of the OTel interfaces it requires as local
 * Protocol types, so the package installs cleanly whether or not the caller
 * has OTel in their dependency tree.
 *
 * When OTel is present, pass your tracer and meter provider at construction
 * time and all governance spans will be emitted automatically.  When OTel is
 * absent, every method becomes a safe no-op, preserving the audit-trail
 * semantics without blowing up at runtime.
 *
 * Usage:
 * ```typescript
 * import { trace } from '@opentelemetry/api';
 * import { GovernanceOTelExporter } from '@aumos/audit-trail';
 *
 * const exporter = new GovernanceOTelExporter({
 *   tracer: trace.getTracer('my-agent', '1.0.0'),
 * });
 *
 * const record = await logger.log(decision);
 * exporter.exportDecision(record);
 * ```
 */

import { GOVERNANCE_SEMANTIC_CONVENTIONS } from "./otel-conventions.js";
import type { AuditRecord } from "./types.js";

// ---------------------------------------------------------------------------
// Minimal OTel interface subset
//
// We declare only the methods we actually call.  Real OTel objects satisfy
// these interfaces; a stub object also works for testing or opt-out use.
// ---------------------------------------------------------------------------

/**
 * Minimal tracer interface — a strict subset of `@opentelemetry/api` Tracer.
 * Pass the real tracer from `trace.getTracer(...)` or a stub for testing.
 */
export interface OTelTracer {
  startSpan(name: string, options?: Record<string, unknown>): OTelSpan;
}

/**
 * Minimal span interface — a strict subset of `@opentelemetry/api` Span.
 */
export interface OTelSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  end(): void;
}

/**
 * Minimal meter provider interface.
 * Reserved for future metric recording; currently unused but accepted at
 * construction time so callers do not need a breaking upgrade later.
 */
export interface OTelMeterProvider {
  getMeter(name: string, version?: string): OTelMeter;
}

/**
 * Minimal meter interface — a strict subset of `@opentelemetry/api` Meter.
 */
export interface OTelMeter {
  createCounter(name: string, options?: Record<string, unknown>): OTelCounter;
}

/**
 * Minimal counter instrument interface.
 */
export interface OTelCounter {
  add(value: number, attributes?: Record<string, string | number | boolean>): void;
}

// ---------------------------------------------------------------------------
// Span status codes (mirrors @opentelemetry/api SpanStatusCode)
// ---------------------------------------------------------------------------

const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/**
 * Snapshot of a trust evaluation to export as an OTel span.
 */
export interface TrustCheckSnapshot {
  /** Agent whose trust level was evaluated. */
  readonly agentId: string;
  /** Trust level held by the agent at evaluation time. */
  readonly trustLevel: number;
  /** Minimum trust level that was required. */
  readonly requiredLevel: number;
  /** Whether the trust check passed. */
  readonly passed: boolean;
  /** Optional cross-reference to the AuditRecord that was produced. */
  readonly auditRecordId?: string;
  /** Optional chain hash of the AuditRecord. */
  readonly auditChainHash?: string;
}

/**
 * Snapshot of a budget evaluation to export as an OTel span.
 */
export interface BudgetCheckSnapshot {
  /** Agent whose budget was evaluated. */
  readonly agentId: string;
  /** Configured maximum spend for the budget period. */
  readonly budgetLimit: number;
  /** Balance remaining after this operation. */
  readonly budgetRemaining: number;
  /** Cost charged by this specific operation. */
  readonly operationCost: number;
  /** ISO 4217 currency code or token unit label. */
  readonly currency: string;
  /** Whether the budget check passed (i.e. funds were sufficient). */
  readonly passed: boolean;
  /** Optional cross-reference to the AuditRecord that was produced. */
  readonly auditRecordId?: string;
  /** Optional chain hash of the AuditRecord. */
  readonly auditChainHash?: string;
}

/**
 * Snapshot of a consent evaluation to export as an OTel span.
 */
export interface ConsentCheckSnapshot {
  /** Agent or data subject identifier whose consent was evaluated. */
  readonly agentId: string;
  /** Processing purpose for which consent was checked. */
  readonly purpose: string;
  /**
   * Consent status at evaluation time.
   * Canonical values: `"granted"`, `"revoked"`, `"absent"`.
   */
  readonly consentStatus: "granted" | "revoked" | "absent";
  /** Whether the consent check passed (i.e. consent was granted). */
  readonly passed: boolean;
  /** Optional cross-reference to the AuditRecord that was produced. */
  readonly auditRecordId?: string;
  /** Optional chain hash of the AuditRecord. */
  readonly auditChainHash?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link GovernanceOTelExporter}.
 */
export interface GovernanceOTelExporterOptions {
  /**
   * OTel tracer to use for span creation.  When omitted every export method
   * is a safe no-op; spans are simply not emitted.
   */
  readonly tracer?: OTelTracer;

  /**
   * OTel meter provider for metric recording.
   * Reserved for future use — currently governance decision counters are not
   * yet implemented, but accepting the provider now prevents a future breaking
   * API change.
   */
  readonly meterProvider?: OTelMeterProvider;

  /**
   * Instrumentation scope name forwarded to the OTel SDK.
   * Defaults to `"@aumos/audit-trail"`.
   */
  readonly instrumentationName?: string;
}

// ---------------------------------------------------------------------------
// Exporter
// ---------------------------------------------------------------------------

/**
 * Converts AumOS governance events into OpenTelemetry spans.
 *
 * The exporter is intentionally thin: it maps well-typed governance snapshots
 * onto OTel attributes using the {@link GOVERNANCE_SEMANTIC_CONVENTIONS} keys.
 * All business logic (trust evaluation, budget allocation, consent lookup)
 * happens upstream; this class only records what occurred.
 *
 * Thread / concurrency model: all methods are synchronous — OTel span
 * creation and attribute setting are synchronous operations in the OTel API.
 * The `end()` call flushes the span to the registered exporter pipeline.
 *
 * @example
 * ```typescript
 * const exporter = new GovernanceOTelExporter({ tracer });
 *
 * // After AuditLogger.log() returns:
 * exporter.exportDecision(auditRecord);
 *
 * // After a dedicated trust check:
 * exporter.exportTrustCheck({
 *   agentId: 'agent-crm-001',
 *   trustLevel: 3,
 *   requiredLevel: 2,
 *   passed: true,
 * });
 * ```
 */
export class GovernanceOTelExporter {
  private readonly tracer: OTelTracer | undefined;
  private readonly meterProvider: OTelMeterProvider | undefined;

  constructor(options: GovernanceOTelExporterOptions = {}) {
    this.tracer = options.tracer;
    this.meterProvider = options.meterProvider;

    // Suppress "unused variable" — meterProvider is stored for future use.
    void this.meterProvider;
  }

  // --------------------------------------------------------------------------
  // Public export methods
  // --------------------------------------------------------------------------

  /**
   * Emit a governance-decision span from a fully formed {@link AuditRecord}.
   *
   * The span captures the complete outcome of a governance evaluation:
   * agent identity, action requested, trust and budget snapshots (when
   * present on the record), the decision outcome, and a cross-reference to
   * the audit record via its ID and chain hash.
   *
   * The span status is set to OK for permitted decisions and ERROR for denied
   * ones, which lets trace UIs highlight denied operations without any custom
   * visualisation logic.
   *
   * @param record - The immutable AuditRecord returned by `AuditLogger.log()`.
   */
  exportDecision(record: AuditRecord): void {
    const span = this.startSpan(GOVERNANCE_SEMANTIC_CONVENTIONS.SPAN_GOVERNANCE_EVALUATE);
    if (span === undefined) {
      return;
    }

    try {
      // Agent identity
      this.setAttr(span, GOVERNANCE_SEMANTIC_CONVENTIONS.AI_AGENT_ID, record.agentId);

      // Decision outcome
      const decision = record.permitted ? "permitted" : "denied";
      this.setAttr(span, GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_DECISION, decision);

      if (record.reason !== undefined) {
        this.setAttr(
          span,
          GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_DECISION_REASON,
          record.reason,
        );
      }

      // Trust snapshot
      if (record.trustLevel !== undefined) {
        this.setAttr(
          span,
          GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_TRUST_LEVEL,
          record.trustLevel,
        );
      }
      if (record.requiredLevel !== undefined) {
        this.setAttr(
          span,
          GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_TRUST_REQUIRED,
          record.requiredLevel,
        );
      }

      // Budget snapshot
      if (record.budgetUsed !== undefined) {
        this.setAttr(
          span,
          GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_BUDGET_COST,
          record.budgetUsed,
        );
      }
      if (record.budgetRemaining !== undefined) {
        this.setAttr(
          span,
          GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_BUDGET_REMAINING,
          record.budgetRemaining,
        );
      }

      // Audit chain cross-reference
      this.setAttr(
        span,
        GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_RECORD_ID,
        record.id,
      );
      this.setAttr(
        span,
        GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_CHAIN_HASH,
        record.recordHash,
      );

      // Span status: ERROR for denied, OK for permitted
      if (record.permitted) {
        span.setStatus({ code: SPAN_STATUS_OK });
      } else {
        span.setStatus({
          code: SPAN_STATUS_ERROR,
          message: record.reason ?? "Governance decision: denied",
        });
      }
    } finally {
      span.end();
    }
  }

  /**
   * Emit a span representing a standalone trust-level evaluation.
   *
   * Use this when the trust check is performed as a distinct step from the
   * full governance decision — for example, inside a GovernanceEngine that
   * evaluates trust, budget, and consent as separate child spans.
   *
   * @param snapshot - Point-in-time trust evaluation data.
   */
  exportTrustCheck(snapshot: TrustCheckSnapshot): void {
    const span = this.startSpan(GOVERNANCE_SEMANTIC_CONVENTIONS.SPAN_TRUST_CHECK);
    if (span === undefined) {
      return;
    }

    try {
      this.setAttr(span, GOVERNANCE_SEMANTIC_CONVENTIONS.AI_AGENT_ID, snapshot.agentId);
      this.setAttr(
        span,
        GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_TRUST_LEVEL,
        snapshot.trustLevel,
      );
      this.setAttr(
        span,
        GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_TRUST_REQUIRED,
        snapshot.requiredLevel,
      );
      this.setAttr(
        span,
        GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_TRUST_DECISION,
        snapshot.passed ? "passed" : "failed",
      );

      if (snapshot.auditRecordId !== undefined) {
        this.setAttr(
          span,
          GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_RECORD_ID,
          snapshot.auditRecordId,
        );
      }
      if (snapshot.auditChainHash !== undefined) {
        this.setAttr(
          span,
          GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_CHAIN_HASH,
          snapshot.auditChainHash,
        );
      }

      span.setStatus(
        snapshot.passed
          ? { code: SPAN_STATUS_OK }
          : { code: SPAN_STATUS_ERROR, message: "Trust level insufficient" },
      );
    } finally {
      span.end();
    }
  }

  /**
   * Emit a span representing a standalone budget evaluation.
   *
   * Records the static budget limit, operation cost, and remaining balance —
   * never any adaptive or ML-derived budget values.
   *
   * @param snapshot - Point-in-time budget evaluation data.
   */
  exportBudgetCheck(snapshot: BudgetCheckSnapshot): void {
    const span = this.startSpan(GOVERNANCE_SEMANTIC_CONVENTIONS.SPAN_BUDGET_CHECK);
    if (span === undefined) {
      return;
    }

    try {
      this.setAttr(span, GOVERNANCE_SEMANTIC_CONVENTIONS.AI_AGENT_ID, snapshot.agentId);
      this.setAttr(
        span,
        GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_BUDGET_LIMIT,
        snapshot.budgetLimit,
      );
      this.setAttr(
        span,
        GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_BUDGET_REMAINING,
        snapshot.budgetRemaining,
      );
      this.setAttr(
        span,
        GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_BUDGET_COST,
        snapshot.operationCost,
      );
      this.setAttr(
        span,
        GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_BUDGET_CURRENCY,
        snapshot.currency,
      );

      if (snapshot.auditRecordId !== undefined) {
        this.setAttr(
          span,
          GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_RECORD_ID,
          snapshot.auditRecordId,
        );
      }
      if (snapshot.auditChainHash !== undefined) {
        this.setAttr(
          span,
          GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_CHAIN_HASH,
          snapshot.auditChainHash,
        );
      }

      span.setStatus(
        snapshot.passed
          ? { code: SPAN_STATUS_OK }
          : { code: SPAN_STATUS_ERROR, message: "Budget limit exceeded" },
      );
    } finally {
      span.end();
    }
  }

  /**
   * Emit a span representing a standalone consent evaluation.
   *
   * @param snapshot - Point-in-time consent evaluation data.
   */
  exportConsentCheck(snapshot: ConsentCheckSnapshot): void {
    const span = this.startSpan(GOVERNANCE_SEMANTIC_CONVENTIONS.SPAN_CONSENT_CHECK);
    if (span === undefined) {
      return;
    }

    try {
      this.setAttr(span, GOVERNANCE_SEMANTIC_CONVENTIONS.AI_AGENT_ID, snapshot.agentId);
      this.setAttr(
        span,
        GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_CONSENT_STATUS,
        snapshot.consentStatus,
      );
      this.setAttr(
        span,
        GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_CONSENT_PURPOSE,
        snapshot.purpose,
      );

      if (snapshot.auditRecordId !== undefined) {
        this.setAttr(
          span,
          GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_RECORD_ID,
          snapshot.auditRecordId,
        );
      }
      if (snapshot.auditChainHash !== undefined) {
        this.setAttr(
          span,
          GOVERNANCE_SEMANTIC_CONVENTIONS.AI_GOVERNANCE_AUDIT_CHAIN_HASH,
          snapshot.auditChainHash,
        );
      }

      span.setStatus(
        snapshot.passed
          ? { code: SPAN_STATUS_OK }
          : {
              code: SPAN_STATUS_ERROR,
              message: `Consent not granted for purpose: ${snapshot.purpose}`,
            },
      );
    } finally {
      span.end();
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Start a span if a tracer is configured, otherwise return undefined.
   * The caller must always call `span.end()` in a `finally` block.
   */
  private startSpan(name: string): OTelSpan | undefined {
    return this.tracer?.startSpan(name);
  }

  /**
   * Set a single attribute on a span.
   * The span parameter is never undefined here — callers guard via
   * `startSpan()` returning undefined.
   */
  private setAttr(
    span: OTelSpan,
    key: string,
    value: string | number | boolean,
  ): void {
    span.setAttribute(key, value);
  }
}
