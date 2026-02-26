// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { SpendingEnvelope, BudgetPeriod } from '../types.js';

/** An individual spending transaction recorded against a category. */
export interface SpendingTransaction {
  readonly id: string;
  readonly category: string;
  readonly amount: number;
  readonly description?: string;
  readonly recordedAt: string;
}

/**
 * Per-category spending tracker.
 *
 * Tracks the accumulated spend and outstanding committed amounts for a
 * single envelope.  Committed amounts reserve headroom without yet being
 * settled as definitive spend — useful when an agent must confirm a
 * cost-incurring operation succeeded before recording the final amount.
 *
 * Storage is an in-memory array of SpendingTransaction records plus
 * running totals kept directly on the envelope object.
 */
export class SpendingTracker {
  readonly #transactions: SpendingTransaction[] = [];

  /**
   * Records a new settled spend against the envelope.
   * Mutates `envelope.spent` in place (envelope objects are stored by
   * reference in BudgetManager's Map).
   */
  recordTransaction(envelope: SpendingEnvelope, amount: number, description?: string): void {
    const transaction: SpendingTransaction = {
      id: crypto.randomUUID(),
      category: envelope.category,
      amount,
      description,
      recordedAt: new Date().toISOString(),
    };
    this.#transactions.push(transaction);
    envelope.spent += amount;
  }

  /**
   * Returns all transactions for a given category, sorted oldest-first.
   */
  getTransactions(category: string): readonly SpendingTransaction[] {
    return this.#transactions.filter((tx) => tx.category === category);
  }

  /**
   * Returns a summary of total spend per category across all recorded
   * transactions.  Useful for aggregate daily-limit enforcement.
   */
  getTotalSpentByCategory(): Map<string, number> {
    const totals = new Map<string, number>();
    for (const tx of this.#transactions) {
      totals.set(tx.category, (totals.get(tx.category) ?? 0) + tx.amount);
    }
    return totals;
  }

  /**
   * Returns the total amount spent across all categories since tracker
   * was initialised.  Used for global daily limit enforcement.
   */
  getTotalSpent(): number {
    return this.#transactions.reduce((sum, tx) => sum + tx.amount, 0);
  }
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

/**
 * Computes the ISO 8601 datetime at which a new period begins based on the
 * current time and the requested period type.  Returns undefined for "total"
 * periods which never reset.
 */
export function computeNextResetAt(period: BudgetPeriod, now: Date = new Date()): string | undefined {
  if (period === 'total') {
    return undefined;
  }

  const next = new Date(now);

  switch (period) {
    case 'hourly':
      next.setHours(next.getHours() + 1, 0, 0, 0);
      break;
    case 'daily':
      next.setDate(next.getDate() + 1);
      next.setHours(0, 0, 0, 0);
      break;
    case 'weekly': {
      const dayOfWeek = next.getDay();
      const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
      next.setDate(next.getDate() + daysUntilMonday);
      next.setHours(0, 0, 0, 0);
      break;
    }
    case 'monthly':
      next.setMonth(next.getMonth() + 1, 1);
      next.setHours(0, 0, 0, 0);
      break;
  }

  return next.toISOString();
}
