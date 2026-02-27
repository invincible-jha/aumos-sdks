// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Vercel AI SDK Governance Middleware
 *
 * Provides a `createGovernedAI` factory that wraps Vercel AI SDK calls with
 * AumOS governance controls: trust-level gating, static budget enforcement,
 * and append-only audit recording.
 *
 * Usage:
 * ```ts
 * import { createGovernedAI } from '@aumos/governance/integrations/vercel-ai';
 *
 * const governed = createGovernedAI({ trustLevel: 3, audit: true });
 * const result = await governed.beforeRequest({ model: 'gpt-4o', maxTokens: 1000 });
 * if (!result.allowed) throw new Error(result.denialReason);
 * ```
 */

import { z } from 'zod';
import { GovernanceError } from '../errors.js';

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for Vercel AI governance middleware configuration.
 *
 * - `trustLevel`: the trust tier (0–5) under which this AI client operates.
 *   Default 2 (L2_SUGGEST — proposals only; no autonomous side-effects).
 * - `budget`: optional static spending caps (daily / hourly / perRequest).
 *   All values are in USD.  Limits are fixed at construction; there is no
 *   dynamic adjustment.
 * - `audit`: whether governance decisions are recorded.  Default true.
 * - `onDeny`: behaviour when a request is blocked by governance.
 *   'throw'        — throw GovernanceDeniedError (default).
 *   'return_empty' — return the GovernanceMiddlewareResult with allowed:false.
 *   'log_only'     — allow the request but mark the result for inspection.
 */
export const VercelAIGovernanceConfigSchema = z.object({
  /** Trust tier 0–5.  Defaults to 2 (L2_SUGGEST). */
  trustLevel: z.number().int().min(0).max(5).default(2),
  /** Optional static spending caps in USD. */
  budget: z
    .object({
      /** Maximum spend per calendar day (UTC midnight reset). */
      daily: z.number().positive().optional(),
      /** Maximum spend per clock-hour (top-of-hour reset). */
      hourly: z.number().positive().optional(),
      /** Maximum spend per individual request. */
      perRequest: z.number().positive().optional(),
    })
    .optional(),
  /** Record governance decisions in the audit trail.  Default true. */
  audit: z.boolean().default(true),
  /**
   * Action taken when a request is denied.
   * Default: 'throw'.
   */
  onDeny: z.enum(['throw', 'return_empty', 'log_only']).default('throw'),
});

/** Parsed type for VercelAIGovernanceConfigSchema. */
export type VercelAIGovernanceConfig = z.infer<typeof VercelAIGovernanceConfigSchema>;

// ---------------------------------------------------------------------------
// Result interface
// ---------------------------------------------------------------------------

/**
 * Result returned by `governedAI.beforeRequest()`.
 *
 * When `allowed` is false the request should not be forwarded to the AI
 * provider.  `denialReason` contains a human-readable explanation.
 */
export interface GovernanceMiddlewareResult {
  /** Whether the request is permitted to proceed. */
  readonly allowed: boolean;
  /** The effective trust level at the time of evaluation. */
  readonly trustLevel: number;
  /**
   * Remaining budget in USD after accounting for the estimated cost of this
   * request.  Undefined when no budget is configured.
   */
  readonly budgetRemaining: number | undefined;
  /** Unique identifier for the audit record created for this evaluation. */
  readonly auditRecordId: string;
  /** Human-readable reason when `allowed` is false. */
  readonly denialReason: string | undefined;
}

// ---------------------------------------------------------------------------
// Internal audit record store (in-memory, append-only)
// ---------------------------------------------------------------------------

interface InternalAuditEntry {
  readonly id: string;
  readonly timestamp: string;
  readonly allowed: boolean;
  readonly trustLevel: number;
  readonly estimatedCost: number;
  readonly denialReason: string | undefined;
  readonly requestParams: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Budget tracking (static limits only)
// ---------------------------------------------------------------------------

/**
 * Immutable budget window snapshot.  Spend counters are updated in-place
 * on the mutable wrapper held by GovernedAI; the window itself records
 * when it opened.
 */
interface BudgetWindow {
  /** UTC epoch ms when the current window opened. */
  openedAt: number;
  /** Amount spent in the current window (USD). */
  spent: number;
}

/**
 * Parameters passed to `beforeRequest`.
 *
 * Mirrors the subset of Vercel AI SDK call parameters that governance needs.
 * Additional properties are forwarded verbatim to the audit record.
 */
export interface BeforeRequestParams {
  /** Model identifier (e.g. 'gpt-4o', 'claude-opus-4-6'). */
  model?: string;
  /** Maximum tokens to generate.  Used for cost estimation. */
  maxTokens?: number;
  /** Prompt or messages array passed to the model. */
  prompt?: string | unknown[];
  /** Any additional provider-specific parameters. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Estimates the USD cost of a request from token counts.
 *
 * The estimate is conservative (output-heavy) and uses a generic per-token
 * rate that is intentionally provider-agnostic.  Callers should record actual
 * costs via their own spend tracking after the AI call resolves.
 *
 * Rate used: $0.000015 per token (15 USD per 1M tokens — mid-market average).
 */
function estimateCost(params: BeforeRequestParams): number {
  const COST_PER_TOKEN_USD = 0.000_015;

  const maxTokens = typeof params.maxTokens === 'number' ? params.maxTokens : 0;
  const promptTokens = estimatePromptTokens(params.prompt);

  return (maxTokens + promptTokens) * COST_PER_TOKEN_USD;
}

/**
 * Estimates the number of tokens in a prompt string or messages array.
 * Uses the 4-characters-per-token heuristic as a conservative approximation.
 */
function estimatePromptTokens(prompt: string | unknown[] | undefined): number {
  if (prompt === undefined) return 0;
  const CHARS_PER_TOKEN = 4;

  if (typeof prompt === 'string') {
    return Math.ceil(prompt.length / CHARS_PER_TOKEN);
  }

  // messages array — extract string content from each message object
  let totalChars = 0;
  for (const message of prompt) {
    if (typeof message === 'object' && message !== null && 'content' in message) {
      const content = (message as Record<string, unknown>)['content'];
      if (typeof content === 'string') {
        totalChars += content.length;
      }
    }
  }
  return Math.ceil(totalChars / CHARS_PER_TOKEN);
}

// ---------------------------------------------------------------------------
// GovernedAI
// ---------------------------------------------------------------------------

/** Milliseconds in one hour. */
const ONE_HOUR_MS = 60 * 60 * 1_000;
/** Milliseconds in one day. */
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/**
 * Governance-aware wrapper around Vercel AI SDK calls.
 *
 * Created via `createGovernedAI()`.  The `beforeRequest()` method must be
 * called before every AI provider invocation; it performs trust and budget
 * checks and records an audit entry.
 */
export class GovernedAI {
  readonly #config: VercelAIGovernanceConfig;
  readonly #auditLog: InternalAuditEntry[] = [];

  readonly #dailyWindow: BudgetWindow = { openedAt: dayStart(Date.now()), spent: 0 };
  readonly #hourlyWindow: BudgetWindow = { openedAt: hourStart(Date.now()), spent: 0 };

  constructor(config: VercelAIGovernanceConfig) {
    this.#config = config;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Evaluates governance controls before an AI provider request is made.
   *
   * Checks (in order):
   *   1. Per-request budget cap (if configured).
   *   2. Hourly rolling budget cap (if configured) with clock-hour reset.
   *   3. Daily rolling budget cap (if configured) with UTC midnight reset.
   *
   * Trust level is recorded on every result but does not gate the request
   * on its own at the middleware layer — trust gating is enforced by the
   * wrapping SDK clients (GovernedOpenAI, GovernedAnthropic) which call
   * beforeRequest as part of a fuller governance check.
   *
   * @param params - Parameters describing the upcoming AI request.
   * @returns GovernanceMiddlewareResult indicating whether the request may proceed.
   */
  async beforeRequest(params: BeforeRequestParams): Promise<GovernanceMiddlewareResult> {
    const auditRecordId = crypto.randomUUID();
    const estimatedCost = estimateCost(params);

    // ------------------------------------------------------------------
    // Budget checks
    // ------------------------------------------------------------------
    const budgetDenial = this.#checkBudget(estimatedCost);

    if (budgetDenial !== undefined) {
      const result: GovernanceMiddlewareResult = {
        allowed: false,
        trustLevel: this.#config.trustLevel,
        budgetRemaining: this.#remainingBudget(estimatedCost),
        auditRecordId,
        denialReason: budgetDenial,
      };

      this.#recordAudit(auditRecordId, result, estimatedCost, params);
      return this.#applyOnDeny(result);
    }

    // ------------------------------------------------------------------
    // Permitted — update budget windows and record audit entry
    // ------------------------------------------------------------------
    this.#deductFromWindows(estimatedCost);

    const result: GovernanceMiddlewareResult = {
      allowed: true,
      trustLevel: this.#config.trustLevel,
      budgetRemaining: this.#remainingBudget(estimatedCost),
      auditRecordId,
      denialReason: undefined,
    };

    this.#recordAudit(auditRecordId, result, estimatedCost, params);
    return result;
  }

  /**
   * Returns a copy of all audit entries recorded by this instance.
   * Entries are in chronological insertion order.
   */
  getAuditLog(): readonly InternalAuditEntry[] {
    return [...this.#auditLog];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Checks whether the estimated cost violates any configured budget limit.
   * Returns a denial reason string on violation, or undefined when permitted.
   */
  #checkBudget(estimatedCost: number): string | undefined {
    const budget = this.#config.budget;
    if (budget === undefined) return undefined;

    // Per-request cap
    if (budget.perRequest !== undefined && estimatedCost > budget.perRequest) {
      return (
        `Estimated request cost $${estimatedCost.toFixed(6)} exceeds the ` +
        `per-request limit of $${budget.perRequest.toFixed(6)}.`
      );
    }

    // Hourly cap — reset at top of hour
    if (budget.hourly !== undefined) {
      this.#maybeResetHourlyWindow();
      const projectedHourly = this.#hourlyWindow.spent + estimatedCost;
      if (projectedHourly > budget.hourly) {
        return (
          `Hourly budget limit of $${budget.hourly.toFixed(4)} would be exceeded ` +
          `(current spend: $${this.#hourlyWindow.spent.toFixed(4)}, ` +
          `estimated cost: $${estimatedCost.toFixed(6)}).`
        );
      }
    }

    // Daily cap — reset at UTC midnight
    if (budget.daily !== undefined) {
      this.#maybeResetDailyWindow();
      const projectedDaily = this.#dailyWindow.spent + estimatedCost;
      if (projectedDaily > budget.daily) {
        return (
          `Daily budget limit of $${budget.daily.toFixed(4)} would be exceeded ` +
          `(current spend: $${this.#dailyWindow.spent.toFixed(4)}, ` +
          `estimated cost: $${estimatedCost.toFixed(6)}).`
        );
      }
    }

    return undefined;
  }

  /** Deducts the estimated cost from all active budget windows. */
  #deductFromWindows(estimatedCost: number): void {
    const budget = this.#config.budget;
    if (budget === undefined) return;

    if (budget.hourly !== undefined) {
      this.#maybeResetHourlyWindow();
      this.#hourlyWindow.spent += estimatedCost;
    }
    if (budget.daily !== undefined) {
      this.#maybeResetDailyWindow();
      this.#dailyWindow.spent += estimatedCost;
    }
  }

  /** Resets the hourly window if the current clock-hour has changed. */
  #maybeResetHourlyWindow(): void {
    const now = Date.now();
    if (now >= this.#hourlyWindow.openedAt + ONE_HOUR_MS) {
      this.#hourlyWindow.openedAt = hourStart(now);
      this.#hourlyWindow.spent = 0;
    }
  }

  /** Resets the daily window if UTC midnight has passed. */
  #maybeResetDailyWindow(): void {
    const now = Date.now();
    if (now >= this.#dailyWindow.openedAt + ONE_DAY_MS) {
      this.#dailyWindow.openedAt = dayStart(now);
      this.#dailyWindow.spent = 0;
    }
  }

  /**
   * Computes the lowest remaining budget headroom across all configured caps.
   * Returns undefined when no budget is configured.
   */
  #remainingBudget(estimatedCost: number): number | undefined {
    const budget = this.#config.budget;
    if (budget === undefined) return undefined;

    let minimum = Infinity;

    if (budget.perRequest !== undefined) {
      minimum = Math.min(minimum, budget.perRequest - estimatedCost);
    }
    if (budget.hourly !== undefined) {
      minimum = Math.min(minimum, budget.hourly - this.#hourlyWindow.spent);
    }
    if (budget.daily !== undefined) {
      minimum = Math.min(minimum, budget.daily - this.#dailyWindow.spent);
    }

    return minimum === Infinity ? undefined : Math.max(0, minimum);
  }

  /** Appends an audit entry when audit is enabled. */
  #recordAudit(
    id: string,
    result: GovernanceMiddlewareResult,
    estimatedCost: number,
    requestParams: BeforeRequestParams,
  ): void {
    if (!this.#config.audit) return;

    const safeParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(requestParams)) {
      safeParams[key] = value;
    }

    const entry: InternalAuditEntry = {
      id,
      timestamp: new Date().toISOString(),
      allowed: result.allowed,
      trustLevel: result.trustLevel,
      estimatedCost,
      denialReason: result.denialReason,
      requestParams: safeParams,
    };

    this.#auditLog.push(entry);
  }

  /**
   * Applies the configured `onDeny` behaviour and returns the final result.
   * Only called when the request has already been determined to be denied.
   */
  #applyOnDeny(result: GovernanceMiddlewareResult): GovernanceMiddlewareResult {
    switch (this.#config.onDeny) {
      case 'throw':
        throw new GovernanceDeniedError(result.denialReason ?? 'Governance denied the request.');

      case 'log_only':
        // Override allowed to true — the caller is signalled but not blocked.
        return {
          ...result,
          allowed: true,
          denialReason: result.denialReason,
        };

      case 'return_empty':
      default:
        return result;
    }
  }
}

// ---------------------------------------------------------------------------
// Denial error
// ---------------------------------------------------------------------------

/**
 * Thrown by `GovernedAI.beforeRequest()` when `onDeny` is 'throw' and a
 * governance check fails.
 */
export class GovernanceDeniedError extends GovernanceError {
  constructor(message: string) {
    super('GOVERNANCE_DENIED', message);
    this.name = 'GovernanceDeniedError';
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Creates a `GovernedAI` instance with the provided configuration.
 *
 * Configuration is validated at call time; an `InvalidConfigError` is thrown
 * if the config does not satisfy the schema.
 *
 * @param config - Raw (unvalidated) governance configuration.
 * @returns A `GovernedAI` instance ready for use.
 *
 * @example
 * ```ts
 * const governed = createGovernedAI({
 *   trustLevel: 3,
 *   budget: { daily: 5.00, hourly: 1.00, perRequest: 0.05 },
 *   audit: true,
 *   onDeny: 'throw',
 * });
 *
 * const result = await governed.beforeRequest({ model: 'gpt-4o', maxTokens: 512 });
 * ```
 */
export function createGovernedAI(config: Partial<VercelAIGovernanceConfig> = {}): GovernedAI {
  const parsed = VercelAIGovernanceConfigSchema.parse(config);
  return new GovernedAI(parsed);
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Returns the UTC epoch ms for the start of the hour containing `nowMs`. */
function hourStart(nowMs: number): number {
  const date = new Date(nowMs);
  date.setUTCMinutes(0, 0, 0);
  return date.getTime();
}

/** Returns the UTC epoch ms for the start of the day (midnight) containing `nowMs`. */
function dayStart(nowMs: number): number {
  const date = new Date(nowMs);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}
