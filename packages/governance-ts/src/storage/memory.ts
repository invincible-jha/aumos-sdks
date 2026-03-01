// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { TrustAssignment, SpendingEnvelope, ConsentRecord } from '../types.js';
import type { AuditRecord } from '../audit/record.js';
import type { StorageAdapter, AuditStorageFilter } from './adapter.js';

/**
 * In-memory implementation of StorageAdapter.
 *
 * This is the default backend and matches the storage behaviour of the
 * original TrustManager, BudgetManager, ConsentManager, and AuditLogger
 * classes.  All data is lost when the process exits.
 *
 * Suitable for development, testing, edge runtimes, and single-process
 * deployments where durability is not required.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  readonly #trustAssignments = new Map<string, TrustAssignment>();
  readonly #spendingEnvelopes = new Map<string, SpendingEnvelope>();
  readonly #consentRecords = new Map<string, ConsentRecord[]>();
  readonly #auditRecords: AuditRecord[] = [];
  readonly #maxAuditRecords: number;

  constructor(options?: { maxAuditRecords?: number }) {
    this.#maxAuditRecords = options?.maxAuditRecords ?? 10_000;
  }

  // -------------------------------------------------------------------------
  // Trust
  // -------------------------------------------------------------------------

  async setTrustAssignment(key: string, assignment: TrustAssignment): Promise<void> {
    this.#trustAssignments.set(key, assignment);
  }

  async getTrustAssignment(key: string): Promise<TrustAssignment | undefined> {
    return this.#trustAssignments.get(key);
  }

  async listTrustAssignments(): Promise<readonly TrustAssignment[]> {
    return Array.from(this.#trustAssignments.values());
  }

  // -------------------------------------------------------------------------
  // Budget
  // -------------------------------------------------------------------------

  async setSpendingEnvelope(category: string, envelope: SpendingEnvelope): Promise<void> {
    this.#spendingEnvelopes.set(category, envelope);
  }

  async getSpendingEnvelope(category: string): Promise<SpendingEnvelope | undefined> {
    return this.#spendingEnvelopes.get(category);
  }

  async listSpendingEnvelopes(): Promise<readonly SpendingEnvelope[]> {
    return Array.from(this.#spendingEnvelopes.values());
  }

  // -------------------------------------------------------------------------
  // Consent
  // -------------------------------------------------------------------------

  async addConsentRecord(record: ConsentRecord): Promise<void> {
    const existing = this.#consentRecords.get(record.agentId);
    if (existing !== undefined) {
      existing.push(record);
    } else {
      this.#consentRecords.set(record.agentId, [record]);
    }
  }

  async getConsentRecords(agentId: string): Promise<readonly ConsentRecord[]> {
    return this.#consentRecords.get(agentId) ?? [];
  }

  async revokeConsentRecords(
    agentId: string,
    dataType: string,
    purpose?: string,
  ): Promise<number> {
    const records = this.#consentRecords.get(agentId);
    if (records === undefined) {
      return 0;
    }

    let count = 0;
    for (const record of records) {
      if (!record.active) continue;
      if (record.dataType !== dataType) continue;
      if (purpose !== undefined && record.purpose !== purpose) continue;
      (record as { active: boolean }).active = false;
      count++;
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  async appendAuditRecord(record: AuditRecord): Promise<void> {
    if (this.#auditRecords.length >= this.#maxAuditRecords) {
      this.#auditRecords.shift();
    }
    this.#auditRecords.push(record);
  }

  async queryAuditRecords(filter?: AuditStorageFilter): Promise<readonly AuditRecord[]> {
    if (filter === undefined) {
      return [...this.#auditRecords];
    }

    let results = this.#auditRecords.filter((record) => {
      if (filter.agentId !== undefined && record.agentId !== filter.agentId) return false;
      if (filter.action !== undefined && record.action !== filter.action) return false;
      if (filter.outcome !== undefined && record.outcome !== filter.outcome) return false;
      if (filter.protocol !== undefined && record.protocol !== filter.protocol) return false;
      if (filter.since !== undefined && record.timestamp < filter.since) return false;
      if (filter.until !== undefined && record.timestamp > filter.until) return false;
      return true;
    });

    if (filter.offset !== undefined && filter.offset > 0) {
      results = results.slice(filter.offset);
    }
    if (filter.limit !== undefined && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async auditRecordCount(): Promise<number> {
    return this.#auditRecords.length;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    // No-op for in-memory storage.
  }

  async disconnect(): Promise<void> {
    // No-op for in-memory storage.
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}
