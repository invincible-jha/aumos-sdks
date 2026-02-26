// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { SpendingEnvelope, BudgetPeriod, BudgetCheckResult, BudgetUtilization } from '../types.js';
import type { BudgetConfig } from '../config.js';
import { parseBudgetConfig } from '../config.js';
import { SpendingTracker, computeNextResetAt } from './tracker.js';
import { applyRolloverIfDue } from './policy.js';

/**
 * BudgetManager tracks per-category spending envelopes and enforces static
 * spending limits.
 *
 * Budget allocation is static — limits are set at construction or via
 * createBudget().  There is no mechanism for dynamic limit adjustment based
 * on spend patterns or ML signals.
 *
 * Storage is an in-memory Map keyed by category name.  Each entry is a
 * mutable SpendingEnvelope; SpendingTracker holds the transaction log.
 *
 * Public API (Fire Line — do NOT add methods beyond these three core ones):
 *   createBudget()    — create or replace a spending envelope
 *   recordSpending()  — record a settled transaction against a category
 *   checkBudget()     — check whether a requested amount fits within limits
 *
 * Additional read-only helper:
 *   getUtilization()  — snapshot of current utilisation for a category
 */
export class BudgetManager {
  readonly #config: BudgetConfig;
  /** Primary storage keyed by category name. */
  readonly #envelopes: Map<string, SpendingEnvelope> = new Map();
  readonly #tracker: SpendingTracker = new SpendingTracker();

  constructor(config: unknown = {}) {
    this.#config = parseBudgetConfig(config);

    // Seed envelopes declared in configuration.
    if (this.#config.envelopes !== undefined) {
      for (const preset of this.#config.envelopes) {
        this.createBudget(preset.category, preset.limit, preset.period);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetches an envelope, applying period rollover first so that limit checks
   * always operate on the current period's spend figures.
   */
  #getActiveEnvelope(category: string): SpendingEnvelope | undefined {
    const envelope = this.#envelopes.get(category);
    if (envelope === undefined) {
      return undefined;
    }
    applyRolloverIfDue(envelope, new Date());
    return envelope;
  }

  /**
   * Computes the aggregate amount spent today across all categories.
   * Used when a dailyLimitUsd is configured.
   */
  #computeTotalDailySpend(): number {
    let total = 0;
    for (const envelope of this.#envelopes.values()) {
      if (envelope.period === 'daily' || envelope.period === 'total') {
        total += envelope.spent;
      }
    }
    return total;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Creates a new spending envelope for the given category.
   *
   * If an envelope already exists for this category it is replaced.
   * The new envelope starts with zero spend.
   *
   * @param category - Unique label for this budget category.
   * @param limit    - Maximum allowable spend in the period.
   * @param period   - Period over which spend accumulates before resetting.
   * @returns The newly created SpendingEnvelope.
   */
  createBudget(category: string, limit: number, period: BudgetPeriod): SpendingEnvelope {
    if (category.trim().length === 0) {
      throw new RangeError('category must be a non-empty string.');
    }
    if (limit <= 0) {
      throw new RangeError('limit must be a positive number.');
    }

    const now = new Date();
    const envelope: SpendingEnvelope = {
      id: crypto.randomUUID(),
      category,
      limit,
      period,
      spent: 0,
      committed: 0,
      resetAt: computeNextResetAt(period, now),
      createdAt: now.toISOString(),
    };

    this.#envelopes.set(category, envelope);
    return envelope;
  }

  /**
   * Records a settled spending transaction against the named category.
   *
   * Throws RangeError when:
   * - The category does not have a registered envelope.
   * - The amount is not a positive finite number.
   *
   * Note: this method records unconditionally — callers should call
   * checkBudget() first and only call recordSpending() when the result
   * is `permitted: true`.
   *
   * @param category    - The budget category to debit.
   * @param amount      - Amount to record (must be positive).
   * @param description - Optional human-readable description.
   */
  recordSpending(category: string, amount: number, description?: string): void {
    if (!isFinite(amount) || amount <= 0) {
      throw new RangeError('amount must be a positive finite number.');
    }

    const envelope = this.#getActiveEnvelope(category);
    if (envelope === undefined) {
      throw new RangeError(
        `No spending envelope found for category "${category}". ` +
          `Call createBudget() first.`,
      );
    }

    this.#tracker.recordTransaction(envelope, amount, description);
  }

  /**
   * Checks whether a requested spend amount is within budget for the
   * given category.
   *
   * Returns `permitted: false` when:
   * - No envelope exists for the category.
   * - The amount would exceed the envelope limit.
   * - A global `dailyLimitUsd` is configured and would be exceeded.
   *
   * This method never mutates state — it is safe to call repeatedly without
   * side effects.
   *
   * @param category  - The budget category to check.
   * @param amount    - The prospective spend amount.
   * @returns BudgetCheckResult with full context for audit logging.
   */
  checkBudget(category: string, amount: number): BudgetCheckResult {
    const envelope = this.#getActiveEnvelope(category);

    if (envelope === undefined) {
      return {
        permitted: false,
        available: 0,
        requested: amount,
        limit: 0,
        spent: 0,
        reason: `No spending envelope registered for category "${category}".`,
      };
    }

    const available = envelope.limit - envelope.spent - envelope.committed;
    const withinEnvelope = amount <= available;

    if (!withinEnvelope) {
      return {
        permitted: false,
        available: Math.max(0, available),
        requested: amount,
        limit: envelope.limit,
        spent: envelope.spent,
        reason:
          `Requested amount ${amount} exceeds available budget ${Math.max(0, available)} ` +
          `for category "${category}" (limit: ${envelope.limit}, spent: ${envelope.spent}).`,
      };
    }

    // Check global daily limit if configured.
    if (this.#config.dailyLimitUsd !== undefined) {
      const totalDailySpend = this.#computeTotalDailySpend();
      const dailyAvailable = this.#config.dailyLimitUsd - totalDailySpend;

      if (amount > dailyAvailable) {
        return {
          permitted: false,
          available: Math.max(0, dailyAvailable),
          requested: amount,
          limit: envelope.limit,
          spent: envelope.spent,
          reason:
            `Requested amount ${amount} would exceed the global daily limit. ` +
            `Daily available: ${Math.max(0, dailyAvailable)}.`,
        };
      }
    }

    return {
      permitted: true,
      available: Math.max(0, available),
      requested: amount,
      limit: envelope.limit,
      spent: envelope.spent,
    };
  }

  /**
   * Returns a read-only utilisation snapshot for the named category.
   *
   * Returns undefined when no envelope exists for the category.
   */
  getUtilization(category: string): BudgetUtilization | undefined {
    const envelope = this.#getActiveEnvelope(category);
    if (envelope === undefined) {
      return undefined;
    }

    const available = Math.max(0, envelope.limit - envelope.spent - envelope.committed);
    const utilizationPercent =
      envelope.limit > 0 ? Math.min(100, (envelope.spent / envelope.limit) * 100) : 0;

    return {
      category: envelope.category,
      limit: envelope.limit,
      spent: envelope.spent,
      committed: envelope.committed,
      available,
      utilizationPercent,
      period: envelope.period,
      resetAt: envelope.resetAt,
    };
  }

  /**
   * Returns utilisation snapshots for all registered categories.
   */
  listUtilizations(): readonly BudgetUtilization[] {
    return Array.from(this.#envelopes.keys())
      .map((category) => this.getUtilization(category))
      .filter((u): u is BudgetUtilization => u !== undefined);
  }
}
