// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { SpendingEnvelope, Transaction, PendingCommit } from '../types.js';

/**
 * Minimal persistence contract for the budget enforcer.
 * Implementors may back this with Redis, SQLite, Postgres, or any KV store.
 */
export interface BudgetStorage {
  // Envelopes
  getEnvelope(id: string): Promise<SpendingEnvelope | null>;
  getEnvelopeByCategory(category: string): Promise<SpendingEnvelope | null>;
  saveEnvelope(envelope: SpendingEnvelope): Promise<void>;
  listEnvelopes(): Promise<readonly SpendingEnvelope[]>;

  // Transactions
  saveTransaction(transaction: Transaction): Promise<void>;
  listTransactions(): Promise<readonly Transaction[]>;

  // Pending commits (pre-authorizations)
  saveCommit(commit: PendingCommit): Promise<void>;
  getCommit(id: string): Promise<PendingCommit | null>;
  deleteCommit(id: string): Promise<void>;
  listCommits(): Promise<readonly PendingCommit[]>;
}
