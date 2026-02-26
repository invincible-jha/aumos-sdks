// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { ConsentRecord } from '../types.js';

/**
 * In-memory consent store backed by a Map keyed on agentId.
 *
 * Each agent maps to an array of ConsentRecord objects.  Records are never
 * physically deleted — revokeConsent() marks a record's `active` field false.
 * This gives auditors a complete history of consent grants and revocations.
 *
 * This class is intentionally low-level.  ConsentManager owns all validation
 * and business logic; ConsentStore handles only raw storage operations.
 */
export class ConsentStore {
  readonly #records: Map<string, ConsentRecord[]> = new Map();

  /**
   * Persists a new consent record for the given agent.
   * Does not deduplicate — callers must check existence first if desired.
   */
  add(record: ConsentRecord): void {
    const existing = this.#records.get(record.agentId);
    if (existing !== undefined) {
      existing.push(record);
    } else {
      this.#records.set(record.agentId, [record]);
    }
  }

  /**
   * Returns all records for an agent (active and revoked).
   */
  getAll(agentId: string): readonly ConsentRecord[] {
    return this.#records.get(agentId) ?? [];
  }

  /**
   * Returns only active records for an agent.
   * Expired records (where `expiresAt` < now) are excluded.
   */
  getActive(agentId: string, now: Date = new Date()): readonly ConsentRecord[] {
    return this.getAll(agentId).filter((record) => {
      if (!record.active) {
        return false;
      }
      if (record.expiresAt === undefined) {
        return true;
      }
      return now.getTime() < new Date(record.expiresAt).getTime();
    });
  }

  /**
   * Finds active records matching both `dataType` and `purpose`.
   * When `purpose` is omitted only `dataType` is matched.
   */
  findActive(
    agentId: string,
    dataType: string,
    purpose?: string,
    now: Date = new Date(),
  ): readonly ConsentRecord[] {
    return this.getActive(agentId, now).filter((record) => {
      const dataTypeMatch = record.dataType === dataType;
      const purposeMatch = purpose === undefined || record.purpose === purpose;
      return dataTypeMatch && purposeMatch;
    });
  }

  /**
   * Marks matching active records as revoked.
   * When `purpose` is provided only records with that purpose are revoked.
   * When `purpose` is omitted all active records for the dataType are revoked.
   *
   * @returns The number of records that were revoked.
   */
  revoke(agentId: string, dataType: string, purpose?: string): number {
    const agentRecords = this.#records.get(agentId);
    if (agentRecords === undefined) {
      return 0;
    }

    let revokedCount = 0;
    for (const record of agentRecords) {
      if (!record.active) {
        continue;
      }
      if (record.dataType !== dataType) {
        continue;
      }
      if (purpose !== undefined && record.purpose !== purpose) {
        continue;
      }
      // Mutate active field — records are plain objects stored by reference.
      (record as { active: boolean }).active = false;
      revokedCount++;
    }
    return revokedCount;
  }

  /**
   * Returns the total number of records across all agents (active + revoked).
   * Useful for monitoring store size.
   */
  totalRecordCount(): number {
    let count = 0;
    for (const records of this.#records.values()) {
      count += records.length;
    }
    return count;
  }
}
