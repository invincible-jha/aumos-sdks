// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { randomUUID } from 'crypto';
import {
  BudgetEnforcerConfigSchema,
  type BudgetEnforcerConfig,
  type BudgetCheckResult,
  type BudgetUtilization,
  type CommitResult,
  type EnvelopeConfig,
  type SpendingEnvelope,
  type Transaction,
  type TransactionFilter,
} from './types.js';
import {
  createEnvelope,
  refreshEnvelopePeriod,
  availableBalance,
} from './envelope.js';
import { buildTransaction, filterTransactions } from './transaction.js';
import { buildUtilization } from './query.js';
import type { BudgetStorage } from './storage/interface.js';
import { MemoryStorage } from './storage/memory.js';

/**
 * BudgetEnforcer — synchronous-first budget gate for AI agent spending.
 *
 * Design contract:
 *  - Limits are STATIC. Only the caller sets them; this class never adjusts them.
 *  - `check()` is read-only. It does NOT record a transaction or modify state.
 *  - `record()` deducts from the envelope. Call it only after the operation completes.
 *  - `commit()` pre-authorises an amount, reducing `available` without touching `spent`.
 *  - `release()` cancels a commit (e.g., if the operation was aborted).
 *  - Period reset is automatic and happens on the first access after a window expires.
 *
 * The synchronous `check()` / `record()` / `commit()` / `release()` methods are the
 * hot path. Async storage is only touched when state needs to be persisted.
 */
export class BudgetEnforcer {
  private readonly config: BudgetEnforcerConfig;
  private readonly storage: BudgetStorage;

  // Hot-path in-memory mirrors — kept in sync with storage on every write.
  private readonly envelopes = new Map<string, SpendingEnvelope>();        // id -> envelope
  private readonly envelopesByCategory = new Map<string, string>();        // category -> id
  private readonly transactions: Transaction[] = [];
  private readonly commits = new Map<string, { category: string; amount: number }>();

  constructor(config?: BudgetEnforcerConfig, storage?: BudgetStorage) {
    this.config = BudgetEnforcerConfigSchema.parse(config ?? {});
    this.storage = storage ?? new MemoryStorage();
  }

  // ─── Envelope management ──────────────────────────────────────────────────

  /**
   * Create a spending envelope (a budget limit for a category + period).
   * Overwrites any existing envelope for the same category.
   */
  createEnvelope(config: EnvelopeConfig): SpendingEnvelope {
    const envelope = createEnvelope(config);

    this.envelopes.set(envelope.id, envelope);
    this.envelopesByCategory.set(envelope.category, envelope.id);

    // Fire-and-forget — storage persistence is best-effort for in-memory default.
    void this.storage.saveEnvelope(envelope);

    return { ...envelope };
  }

  /** Suspend an envelope — all checks return 'suspended' until resumed. */
  suspendEnvelope(category: string): void {
    const envelope = this.requireEnvelope(category);
    envelope.suspended = true;
    void this.storage.saveEnvelope(envelope);
  }

  /** Resume a previously suspended envelope. */
  resumeEnvelope(category: string): void {
    const envelope = this.requireEnvelope(category);
    envelope.suspended = false;
    void this.storage.saveEnvelope(envelope);
  }

  // ─── Check ────────────────────────────────────────────────────────────────

  /**
   * Check whether a transaction is within budget.
   *
   * This method is PURELY READ-ONLY. It does not record a transaction,
   * does not modify `spent`, and does not create a commit. The caller
   * is responsible for deciding whether to proceed and then calling
   * `record()` once the operation completes.
   */
  check(category: string, amount: number): BudgetCheckResult {
    const envelope = this.getEnvelopeByCategory(category);

    if (envelope === null) {
      return {
        permitted: false,
        available: 0,
        requested: amount,
        limit: 0,
        spent: 0,
        committed: 0,
        reason: 'no_envelope',
      };
    }

    this.refreshPeriod(envelope);

    if (envelope.suspended) {
      return {
        permitted: false,
        available: 0,
        requested: amount,
        limit: envelope.limit,
        spent: envelope.spent,
        committed: envelope.committed,
        reason: 'suspended',
      };
    }

    const available = availableBalance(envelope);
    const permitted = amount <= available;

    return {
      permitted,
      available,
      requested: amount,
      limit: envelope.limit,
      spent: envelope.spent,
      committed: envelope.committed,
      reason: permitted ? 'within_budget' : 'exceeds_budget',
    };
  }

  // ─── Record ───────────────────────────────────────────────────────────────

  /**
   * Record a completed transaction and deduct its amount from the envelope.
   *
   * Call this AFTER the underlying operation has succeeded. If you need
   * to reserve capacity before the operation runs, use `commit()` instead
   * and then call `record()` with the actual amount once done.
   *
   * Throws if the category has no envelope.
   */
  record(category: string, amount: number, description?: string): Transaction {
    const envelope = this.requireEnvelope(category);
    this.refreshPeriod(envelope);

    const transaction = buildTransaction({
      category,
      amount,
      description,
      envelopeId: envelope.id,
    });

    envelope.spent += amount;
    void this.storage.saveEnvelope(envelope);
    void this.storage.saveTransaction(transaction);

    this.transactions.push(transaction);

    return { ...transaction };
  }

  // ─── Commit / Release ─────────────────────────────────────────────────────

  /**
   * Pre-authorise an amount against the envelope.
   *
   * The committed amount reduces `available` immediately but does not
   * increase `spent`. Use this to hold capacity for an in-flight operation.
   * Call `record()` with the actual cost on completion, and `release()` if
   * the operation is cancelled before executing.
   */
  commit(category: string, amount: number): CommitResult {
    const checkResult = this.check(category, amount);

    if (!checkResult.permitted) {
      return {
        permitted: false,
        commitId: null,
        available: checkResult.available,
        requested: amount,
        reason: checkResult.reason,
      };
    }

    const commitId = randomUUID();
    const envelope = this.getEnvelopeByCategory(category)!;

    envelope.committed += amount;
    this.commits.set(commitId, { category, amount });

    void this.storage.saveEnvelope(envelope);
    void this.storage.saveCommit({
      id: commitId,
      category,
      amount,
      createdAt: new Date(),
    });

    return {
      permitted: true,
      commitId,
      available: availableBalance(envelope),
      requested: amount,
      reason: 'within_budget',
    };
  }

  /**
   * Release a previously committed amount back to available.
   *
   * Use this when a pre-authorised operation is cancelled or fails before
   * any actual spending occurs. If spending did occur, call `record()` with
   * the actual amount instead (or in addition) to `release()`.
   */
  release(commitId: string): void {
    const commit = this.commits.get(commitId);
    if (commit === undefined) return;

    const envelope = this.getEnvelopeByCategory(commit.category);
    if (envelope !== null) {
      envelope.committed = Math.max(0, envelope.committed - commit.amount);
      void this.storage.saveEnvelope(envelope);
    }

    this.commits.delete(commitId);
    void this.storage.deleteCommit(commitId);
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  /**
   * Return a point-in-time utilization snapshot for one category.
   * Throws if no envelope exists for the category.
   */
  utilization(category: string): BudgetUtilization {
    const envelope = this.requireEnvelope(category);
    this.refreshPeriod(envelope);
    return buildUtilization(envelope);
  }

  /** Return all envelopes (copies — mutation has no effect). */
  listEnvelopes(): readonly SpendingEnvelope[] {
    return Array.from(this.envelopes.values()).map((envelope) => ({ ...envelope }));
  }

  /**
   * Return transaction history, optionally filtered.
   *
   * All filter fields are AND-ed together. Pass undefined to return all records.
   */
  getTransactions(filter?: TransactionFilter): readonly Transaction[] {
    return filterTransactions(this.transactions, filter);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private getEnvelopeByCategory(category: string): SpendingEnvelope | null {
    const id = this.envelopesByCategory.get(category);
    if (id === undefined) return null;
    return this.envelopes.get(id) ?? null;
  }

  private requireEnvelope(category: string): SpendingEnvelope {
    const envelope = this.getEnvelopeByCategory(category);
    if (envelope === null) {
      throw new Error(
        `No spending envelope found for category "${category}". ` +
          'Call createEnvelope() before recording transactions.',
      );
    }
    return envelope;
  }

  /**
   * Reset the envelope's period accumulators if the current window has elapsed.
   * Mutates the in-memory envelope and persists the update.
   */
  private refreshPeriod(envelope: SpendingEnvelope): void {
    const periodStartBefore = envelope.periodStart.getTime();
    refreshEnvelopePeriod(envelope);
    if (envelope.periodStart.getTime() !== periodStartBefore) {
      // Period was refreshed — persist the reset state.
      void this.storage.saveEnvelope(envelope);
    }
  }
}
