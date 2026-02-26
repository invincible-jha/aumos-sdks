// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { BudgetStorage } from './interface.js';
import type { SpendingEnvelope, Transaction, PendingCommit } from '../types.js';

/**
 * In-process memory store — suitable for single-agent processes and testing.
 * All state is lost when the process exits. For durable enforcement across
 * restarts, provide a persistent BudgetStorage implementation.
 */
export class MemoryStorage implements BudgetStorage {
  private readonly envelopesById = new Map<string, SpendingEnvelope>();
  private readonly envelopesByCategory = new Map<string, string>(); // category -> id
  private readonly transactions: Transaction[] = [];
  private readonly commits = new Map<string, PendingCommit>();

  async getEnvelope(id: string): Promise<SpendingEnvelope | null> {
    return this.envelopesById.get(id) ?? null;
  }

  async getEnvelopeByCategory(category: string): Promise<SpendingEnvelope | null> {
    const id = this.envelopesByCategory.get(category);
    if (id === undefined) return null;
    return this.envelopesById.get(id) ?? null;
  }

  async saveEnvelope(envelope: SpendingEnvelope): Promise<void> {
    this.envelopesById.set(envelope.id, { ...envelope });
    this.envelopesByCategory.set(envelope.category, envelope.id);
  }

  async listEnvelopes(): Promise<readonly SpendingEnvelope[]> {
    return Array.from(this.envelopesById.values()).map((envelope) => ({ ...envelope }));
  }

  async saveTransaction(transaction: Transaction): Promise<void> {
    this.transactions.push({ ...transaction });
  }

  async listTransactions(): Promise<readonly Transaction[]> {
    return this.transactions.map((transaction) => ({ ...transaction }));
  }

  async saveCommit(commit: PendingCommit): Promise<void> {
    this.commits.set(commit.id, { ...commit });
  }

  async getCommit(id: string): Promise<PendingCommit | null> {
    return this.commits.get(id) ?? null;
  }

  async deleteCommit(id: string): Promise<void> {
    this.commits.delete(id);
  }

  async listCommits(): Promise<readonly PendingCommit[]> {
    return Array.from(this.commits.values()).map((commit) => ({ ...commit }));
  }
}
