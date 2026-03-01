// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { GovernanceAction, GovernanceDecision } from '../types.js';

/**
 * Minimal OpenTelemetry Span interface.
 *
 * This avoids a hard dependency on @opentelemetry/api.  Any OTel-compatible
 * tracer that produces spans with these methods can be used.
 */
export interface OTelSpanLike {
  setAttribute(key: string, value: string | number | boolean): this;
  setStatus(status: { code: number; message?: string }): this;
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): this;
  end(): void;
}

/**
 * Minimal OpenTelemetry Tracer interface.
 */
export interface OTelTracerLike {
  startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): OTelSpanLike;
}

/**
 * Configuration for the governance OTel instrumentation.
 */
export interface GovernanceOTelConfig {
  /** The OTel tracer instance to use for span creation. */
  tracer: OTelTracerLike;
  /** Service name attribute added to all spans. Defaults to "aumos-governance". */
  serviceName?: string;
  /** Whether to include action metadata in span attributes. Defaults to false. */
  includeMetadata?: boolean;
}

/**
 * OTel span status codes (matching OpenTelemetry SpanStatusCode).
 */
const SPAN_STATUS_OK = 1;
const SPAN_STATUS_ERROR = 2;

/**
 * GovernanceTracer instruments governance evaluations with OpenTelemetry spans.
 *
 * Each governance evaluation creates a parent span with child events for
 * each pipeline step (trust check, budget check, consent check, audit log).
 *
 * Usage:
 * ```typescript
 * import { trace } from '@opentelemetry/api';
 *
 * const tracer = trace.getTracer('aumos-governance');
 * const govTracer = new GovernanceTracer({ tracer });
 *
 * // Wrap an evaluate call
 * const decision = await govTracer.traceEvaluation(action, async () => {
 *   return engine.evaluate(action);
 * });
 * ```
 */
export class GovernanceTracer {
  readonly #tracer: OTelTracerLike;
  readonly #serviceName: string;
  readonly #includeMetadata: boolean;

  constructor(config: GovernanceOTelConfig) {
    this.#tracer = config.tracer;
    this.#serviceName = config.serviceName ?? 'aumos-governance';
    this.#includeMetadata = config.includeMetadata ?? false;
  }

  /**
   * Traces a governance evaluation, creating a span with decision attributes.
   *
   * The span includes:
   *   - aumos.agent_id: the agent being evaluated
   *   - aumos.action: the action name
   *   - aumos.category: the action category
   *   - aumos.decision: "permit" or "deny"
   *   - aumos.protocol: the protocol that produced the verdict
   *   - aumos.cost: the action cost (if present)
   *
   * @param action - The governance action being evaluated.
   * @param evaluateFn - The actual evaluation function to trace.
   * @returns The governance decision.
   */
  async traceEvaluation(
    action: GovernanceAction,
    evaluateFn: () => Promise<GovernanceDecision>,
  ): Promise<GovernanceDecision> {
    const span = this.#tracer.startSpan('aumos.governance.evaluate', {
      attributes: {
        'service.name': this.#serviceName,
        'aumos.agent_id': action.agentId,
        'aumos.action': action.action,
        'aumos.category': action.category,
        'aumos.required_trust_level': action.requiredTrustLevel,
        ...(action.cost !== undefined && { 'aumos.cost': action.cost }),
        ...(action.dataType !== undefined && { 'aumos.data_type': action.dataType }),
        ...(action.scope !== undefined && { 'aumos.scope': action.scope }),
      },
    });

    try {
      const decision = await evaluateFn();

      span.setAttribute('aumos.decision', decision.permitted ? 'permit' : 'deny');
      span.setAttribute('aumos.protocol', decision.protocol);
      span.setAttribute('aumos.reason', decision.reason);

      if (this.#includeMetadata && action.metadata !== undefined) {
        for (const [key, value] of Object.entries(action.metadata)) {
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            span.setAttribute(`aumos.metadata.${key}`, value);
          }
        }
      }

      span.addEvent(decision.permitted ? 'governance.permit' : 'governance.deny', {
        'aumos.protocol': decision.protocol,
      });

      span.setStatus({
        code: decision.permitted ? SPAN_STATUS_OK : SPAN_STATUS_OK,
      });

      return decision;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      span.setStatus({ code: SPAN_STATUS_ERROR, message });
      span.addEvent('governance.error', { 'error.message': message });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Creates a span for an individual pipeline step.
   *
   * @param stepName - Name of the step (e.g., "trust_check", "budget_check").
   * @param agentId - The agent being evaluated.
   * @param executeFn - The step function to trace.
   * @returns The step result.
   */
  async traceStep<T>(
    stepName: string,
    agentId: string,
    executeFn: () => Promise<T>,
  ): Promise<T> {
    const span = this.#tracer.startSpan(`aumos.governance.${stepName}`, {
      attributes: {
        'service.name': this.#serviceName,
        'aumos.agent_id': agentId,
        'aumos.step': stepName,
      },
    });

    try {
      const result = await executeFn();
      span.setStatus({ code: SPAN_STATUS_OK });
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      span.setStatus({ code: SPAN_STATUS_ERROR, message });
      throw error;
    } finally {
      span.end();
    }
  }
}
