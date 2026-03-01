// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Multi-Model Cost Tracking Types
 *
 * Defines the data structures for recording and summarising LLM token usage
 * costs across multiple providers and models.
 *
 * Cost tracking is RECORDING ONLY — costs are measured and reported but
 * never used to adapt budgets, predict spending, or modify governance
 * decisions automatically.  Budget enforcement is static (see BudgetManager
 * / BudgetEnforcer) and is kept strictly separate from cost tracking.
 *
 * Supported providers (as of early 2026):
 *   openai | anthropic | google | azure | cohere | mistral | custom
 *
 * Custom provider support allows enterprise deployments with private or
 * fine-tuned models to register their own pricing.
 */

// ---------------------------------------------------------------------------
// Model providers
// ---------------------------------------------------------------------------

/**
 * Supported model provider identifiers.
 *
 * Use `'custom'` for any provider not covered by the built-in list.
 */
export type ModelProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'azure'
  | 'cohere'
  | 'mistral'
  | 'custom';

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Token-level pricing for a specific model.
 *
 * Prices are expressed per 1,000 tokens.  All monetary values are in the
 * currency specified by `currency` (default: "USD").
 *
 * Pricing data is static and must be updated manually when providers change
 * their rates.  No automated price fetching is performed.
 */
export interface ModelPricing {
  /** The provider offering this model. */
  readonly provider: ModelProvider;
  /** Provider-specific model identifier (e.g., "gpt-4o", "claude-3-5-sonnet-20241022"). */
  readonly modelId: string;
  /** Cost in `currency` per 1,000 input tokens. */
  readonly inputCostPer1kTokens: number;
  /** Cost in `currency` per 1,000 output tokens. */
  readonly outputCostPer1kTokens: number;
  /** ISO 4217 currency code. Default: "USD". */
  readonly currency: string;
}

// ---------------------------------------------------------------------------
// Usage records
// ---------------------------------------------------------------------------

/**
 * A single LLM call usage record.
 *
 * Callers create these records after each model invocation and pass them
 * to `CostTracker.record()`.  The `estimatedCost` field is computed by
 * `CostTracker` using the registered pricing, but callers may pre-compute
 * it themselves if they have cost data from the provider's response.
 */
export interface LLMUsageRecord {
  /** Unique identifier for this usage record. */
  readonly id: string;
  /** The agent that triggered this LLM call. */
  readonly agentId: string;
  /** The provider that served the request. */
  readonly provider: ModelProvider;
  /** The model that was used. */
  readonly modelId: string;
  /** Number of tokens in the prompt / context. */
  readonly inputTokens: number;
  /** Number of tokens in the completion / response. */
  readonly outputTokens: number;
  /** Estimated monetary cost for this call. */
  readonly estimatedCost: number;
  /** ISO 4217 currency code. */
  readonly currency: string;
  /** ISO 8601 timestamp when this call was made. */
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Cost summary
// ---------------------------------------------------------------------------

/**
 * Aggregated cost summary for a set of usage records.
 *
 * All monetary values use the tracker's base currency.  When multiple
 * currencies are recorded, the tracker converts them at registration time
 * (conversion is not supported — records with non-base currencies are
 * stored but may not aggregate correctly unless all records share the same
 * currency).
 *
 * `byProvider`, `byModel`, and `byAgent` are keyed by the respective
 * identifier string and contain the total cost across all records in that
 * group within the summary period.
 */
export interface CostSummary {
  /** Total cost across all records in the period. */
  readonly totalCost: number;
  /** ISO 4217 currency code for all monetary values in this summary. */
  readonly currency: string;
  /** Costs grouped by provider. */
  readonly byProvider: Readonly<Record<string, number>>;
  /** Costs grouped by model ID. */
  readonly byModel: Readonly<Record<string, number>>;
  /** Costs grouped by agent ID. */
  readonly byAgent: Readonly<Record<string, number>>;
  /** Total number of usage records in the period. */
  readonly recordCount: number;
  /** ISO 8601 start of the summary period (inclusive). */
  readonly periodStart: string;
  /** ISO 8601 end of the summary period (inclusive). */
  readonly periodEnd: string;
}

// ---------------------------------------------------------------------------
// Budget check result
// ---------------------------------------------------------------------------

/**
 * Result of a pre-call budget check.
 *
 * Callers can call `CostTracker.checkBudget()` before executing an LLM call
 * to verify whether the estimated cost would exceed a static budget threshold.
 *
 * This is a static check — it does not modify any state or reserve funds.
 * It is the caller's responsibility to respect the `permitted` flag.
 */
export interface CostBudgetCheckResult {
  /** Whether the estimated cost is within the configured budget threshold. */
  readonly permitted: boolean;
  /** Estimated cost of the planned call. */
  readonly estimatedCost: number;
  /** The budget threshold that was checked against. */
  readonly budgetLimit: number;
  /** Total cost already recorded in the current tracking window. */
  readonly totalSpentSoFar: number;
  /** Remaining headroom before the budget limit would be hit. */
  readonly remaining: number;
  /** ISO 4217 currency code. */
  readonly currency: string;
  /** Human-readable reason when `permitted` is false. */
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// CostTracker configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for `CostTracker`.
 */
export interface CostTrackerConfig {
  /**
   * ISO 4217 base currency for all cost calculations.
   * Default: "USD".
   */
  readonly currency?: string;
  /**
   * Optional static budget limit.  Used by `checkBudget()` to determine
   * whether a planned call would exceed the limit.
   *
   * This is a static threshold — it is never modified automatically.
   */
  readonly budgetLimit?: number;
  /**
   * Maximum number of usage records to retain in memory.
   * When exceeded, the oldest records are evicted.
   * Default: 10000.
   */
  readonly maxRecords?: number;
}
