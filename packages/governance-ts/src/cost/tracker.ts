// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Cost Tracker
 *
 * `CostTracker` records LLM usage costs across multiple providers and models
 * and generates cost summaries for specified time periods.
 *
 * Cost tracking is RECORDING ONLY.  No spending is adapted, predicted, or
 * optimised automatically.  Budget limits used in `checkBudget()` are static
 * thresholds set at construction time and never modified by the tracker.
 *
 * Usage pattern:
 *   1. Create a `CostTracker` with an optional `CostTrackerConfig`.
 *   2. Optionally register additional model pricing via `registry`.
 *   3. Call `record()` after each LLM invocation.
 *   4. Call `summarize()` to aggregate costs for a time period.
 *   5. Call `checkBudget()` before expensive calls when a budget limit is set.
 *
 * Public API:
 *   record()       — record a completed LLM call
 *   recordRaw()    — record with auto-computed cost from registered pricing
 *   summarize()    — generate a CostSummary for a time range
 *   checkBudget()  — static pre-call budget headroom check
 *   getRecords()   — retrieve all stored usage records
 *   registry       — access the ModelPricingRegistry for custom pricing
 */

import { randomUUID } from 'crypto';
import type {
  LLMUsageRecord,
  CostSummary,
  CostBudgetCheckResult,
  CostTrackerConfig,
  ModelProvider,
} from './types.js';
import { ModelPricingRegistry } from './provider-registry.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CURRENCY = 'USD';
const DEFAULT_MAX_RECORDS = 10_000;

// ---------------------------------------------------------------------------
// CostTracker
// ---------------------------------------------------------------------------

/**
 * Records LLM token usage costs and generates cost summaries.
 *
 * @example
 * ```ts
 * const tracker = new CostTracker({ budgetLimit: 10.00 });
 *
 * // Check before calling.
 * const budgetCheck = tracker.checkBudget('anthropic', 'claude-3-5-sonnet-20241022', 500, 200);
 * if (!budgetCheck.permitted) {
 *   throw new Error(budgetCheck.reason);
 * }
 *
 * // Record after the call.
 * tracker.recordRaw({
 *   agentId: 'agent-alpha',
 *   provider: 'anthropic',
 *   modelId: 'claude-3-5-sonnet-20241022',
 *   inputTokens: 500,
 *   outputTokens: 200,
 * });
 *
 * const summary = tracker.summarize(
 *   '2026-02-01T00:00:00.000Z',
 *   '2026-02-28T23:59:59.999Z',
 * );
 * console.log('Total cost:', summary.totalCost);
 * ```
 */
export class CostTracker {
  readonly #config: Required<CostTrackerConfig>;
  readonly #records: LLMUsageRecord[];
  readonly #registry: ModelPricingRegistry;

  constructor(config: CostTrackerConfig = {}) {
    this.#config = {
      currency: config.currency ?? DEFAULT_CURRENCY,
      budgetLimit: config.budgetLimit ?? Infinity,
      maxRecords: config.maxRecords ?? DEFAULT_MAX_RECORDS,
    };
    this.#records = [];
    this.#registry = new ModelPricingRegistry();
  }

  // -------------------------------------------------------------------------
  // Registry access
  // -------------------------------------------------------------------------

  /**
   * The `ModelPricingRegistry` used by this tracker.
   *
   * Access this to register custom model pricing before calling `recordRaw()`.
   *
   * @example
   * ```ts
   * tracker.registry.register({
   *   provider: 'custom',
   *   modelId: 'my-model',
   *   inputCostPer1kTokens: 0.001,
   *   outputCostPer1kTokens: 0.003,
   *   currency: 'USD',
   * });
   * ```
   */
  get registry(): ModelPricingRegistry {
    return this.#registry;
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  /**
   * Records a completed LLM call with a pre-computed cost.
   *
   * Use this when you have cost data from the provider's response, or when
   * you have already called `registry.computeCost()`.
   *
   * When `record.id` is absent, a UUID is generated automatically.
   * When `record.timestamp` is absent, the current time is used.
   *
   * @param record - The usage record to append.
   * @returns The stored `LLMUsageRecord` (with `id` and `timestamp` filled in).
   */
  record(record: Omit<LLMUsageRecord, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): LLMUsageRecord {
    const stored: LLMUsageRecord = {
      id: record.id ?? randomUUID(),
      agentId: record.agentId,
      provider: record.provider,
      modelId: record.modelId,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      estimatedCost: record.estimatedCost,
      currency: record.currency,
      timestamp: record.timestamp ?? new Date().toISOString(),
    };

    this.#evictIfAtCapacity();
    this.#records.push(stored);
    return stored;
  }

  /**
   * Records a completed LLM call, computing the cost automatically from
   * the registered pricing for the given provider + model.
   *
   * When no pricing is found for the model, `estimatedCost` is set to `0`
   * and a warning-level note is embedded in the record's `currency` field
   * as "UNKNOWN" to signal that the cost was not computed.  Callers that
   * need accurate cost data must ensure the model is registered in the
   * `registry` before calling this method.
   *
   * @param params - Token counts and call metadata.
   * @returns The stored `LLMUsageRecord`.
   */
  recordRaw(params: RecordRawParams): LLMUsageRecord {
    const computedCost =
      this.#registry.computeCost(
        params.provider,
        params.modelId,
        params.inputTokens,
        params.outputTokens,
      ) ?? 0;

    const hasPricing = this.#registry.has(params.provider, params.modelId);
    const currency = hasPricing ? this.#config.currency : 'UNKNOWN';

    return this.record({
      id: params.id,
      agentId: params.agentId,
      provider: params.provider,
      modelId: params.modelId,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      estimatedCost: computedCost,
      currency,
      timestamp: params.timestamp,
    });
  }

  // -------------------------------------------------------------------------
  // Budget check
  // -------------------------------------------------------------------------

  /**
   * Checks whether executing a planned LLM call would exceed the configured
   * static budget limit.
   *
   * This is a read-only check — it does not modify any state.  The caller
   * is responsible for respecting the `permitted` flag.
   *
   * When no `budgetLimit` was configured (defaults to `Infinity`), this
   * method always returns `permitted: true`.
   *
   * @param provider      - The provider for the planned call.
   * @param modelId       - The model for the planned call.
   * @param inputTokens   - Estimated input tokens.
   * @param outputTokens  - Estimated output tokens.
   */
  checkBudget(
    provider: ModelProvider | string,
    modelId: string,
    inputTokens: number,
    outputTokens: number,
  ): CostBudgetCheckResult {
    const estimatedCost =
      this.#registry.computeCost(provider, modelId, inputTokens, outputTokens) ?? 0;

    const totalSpentSoFar = this.#computeTotalCost(this.#records);
    const projectedTotal = totalSpentSoFar + estimatedCost;
    const budgetLimit = this.#config.budgetLimit;
    const remaining = Math.max(0, budgetLimit - totalSpentSoFar);
    const permitted = projectedTotal <= budgetLimit;

    return {
      permitted,
      estimatedCost,
      budgetLimit,
      totalSpentSoFar,
      remaining,
      currency: this.#config.currency,
      reason: permitted
        ? undefined
        : `Projected total cost ${projectedTotal.toFixed(6)} ${this.#config.currency} would exceed budget limit ${budgetLimit} ${this.#config.currency}.`,
    };
  }

  // -------------------------------------------------------------------------
  // Summarization
  // -------------------------------------------------------------------------

  /**
   * Generates a `CostSummary` for usage records within the specified period.
   *
   * Records are filtered by `timestamp` — only records with a timestamp
   * between `periodStart` and `periodEnd` (inclusive) are included.
   *
   * @param periodStart - ISO 8601 start of the period (inclusive).
   * @param periodEnd   - ISO 8601 end of the period (inclusive).
   */
  summarize(periodStart: string, periodEnd: string): CostSummary {
    const startMs = Date.parse(periodStart);
    const endMs = Date.parse(periodEnd);

    const periodRecords = this.#records.filter((record) => {
      const ts = Date.parse(record.timestamp);
      return ts >= startMs && ts <= endMs;
    });

    const byProvider: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    let totalCost = 0;

    for (const record of periodRecords) {
      totalCost += record.estimatedCost;

      byProvider[record.provider] =
        (byProvider[record.provider] ?? 0) + record.estimatedCost;

      byModel[record.modelId] =
        (byModel[record.modelId] ?? 0) + record.estimatedCost;

      byAgent[record.agentId] =
        (byAgent[record.agentId] ?? 0) + record.estimatedCost;
    }

    return {
      totalCost,
      currency: this.#config.currency,
      byProvider,
      byModel,
      byAgent,
      recordCount: periodRecords.length,
      periodStart,
      periodEnd,
    };
  }

  /**
   * Generates a `CostSummary` for all recorded usage (no date filter).
   */
  summarizeAll(): CostSummary {
    if (this.#records.length === 0) {
      const now = new Date().toISOString();
      return {
        totalCost: 0,
        currency: this.#config.currency,
        byProvider: {},
        byModel: {},
        byAgent: {},
        recordCount: 0,
        periodStart: now,
        periodEnd: now,
      };
    }

    const timestamps = this.#records.map((record) => record.timestamp).sort();
    const periodStart = timestamps[0] as string;
    const periodEnd = timestamps[timestamps.length - 1] as string;
    return this.summarize(periodStart, periodEnd);
  }

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  /**
   * Returns a copy of all stored usage records in insertion order.
   */
  getRecords(): readonly LLMUsageRecord[] {
    return [...this.#records];
  }

  /**
   * Returns all records for a specific agent.
   *
   * @param agentId - The agent to filter by.
   */
  getRecordsByAgent(agentId: string): readonly LLMUsageRecord[] {
    return this.#records.filter((record) => record.agentId === agentId);
  }

  /**
   * Returns all records for a specific provider.
   *
   * @param provider - The provider to filter by.
   */
  getRecordsByProvider(provider: ModelProvider | string): readonly LLMUsageRecord[] {
    return this.#records.filter((record) => record.provider === provider);
  }

  /**
   * Returns the total number of stored records.
   */
  get recordCount(): number {
    return this.#records.length;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  #evictIfAtCapacity(): void {
    if (this.#records.length >= this.#config.maxRecords) {
      this.#records.shift();
    }
  }

  #computeTotalCost(records: readonly LLMUsageRecord[]): number {
    return records.reduce((sum, record) => sum + record.estimatedCost, 0);
  }
}

// ---------------------------------------------------------------------------
// RecordRawParams
// ---------------------------------------------------------------------------

/**
 * Parameters for `CostTracker.recordRaw()`.
 *
 * Omits `estimatedCost` and `currency` because the tracker computes them
 * from the registered pricing.
 */
export interface RecordRawParams {
  /** Optional pre-generated ID. A UUID is generated if absent. */
  readonly id?: string;
  /** The agent that triggered this LLM call. */
  readonly agentId: string;
  /** The provider that served the request. */
  readonly provider: ModelProvider | string;
  /** The model that was used. */
  readonly modelId: string;
  /** Number of tokens in the prompt / context. */
  readonly inputTokens: number;
  /** Number of tokens in the completion / response. */
  readonly outputTokens: number;
  /** ISO 8601 timestamp. Defaults to now. */
  readonly timestamp?: string;
}
