// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

import { HashChain } from "./chain.js";
import { buildPendingRecord } from "./record.js";
import { exportRecords } from "./export.js";
import { MemoryStorage } from "./storage/memory.js";
import type { AuditStorage } from "./storage/interface.js";
import type {
  AuditConfig,
  AuditFilter,
  AuditRecord,
  ChainVerificationResult,
  ExportFormat,
  GovernanceDecisionInput,
} from "./types.js";

/**
 * Primary entry point for recording and querying governance decisions.
 *
 * AuditLogger coordinates three concerns:
 * 1. Record construction — building a well-typed AuditRecord from caller input.
 * 2. Hash chain maintenance — linking each record cryptographically to the last.
 * 3. Storage delegation — persisting and retrieving records via a pluggable backend.
 *
 * Usage:
 * ```typescript
 * const logger = new AuditLogger();
 * const record = await logger.log({ agentId: 'agent-1', action: 'send_email', permitted: true });
 * const result = await logger.verify();
 * ```
 */
export class AuditLogger {
  private readonly chain: HashChain;
  private readonly storage: AuditStorage;

  constructor(config?: AuditConfig) {
    this.storage = config?.storage ?? new MemoryStorage();
    this.chain = new HashChain();
  }

  /**
   * Record a governance decision.
   *
   * The decision is wrapped in an AuditRecord, linked to the previous record
   * via SHA-256, and persisted to the configured storage backend.
   *
   * @returns The fully-formed, immutable AuditRecord (including its hash).
   */
  async log(decision: GovernanceDecisionInput): Promise<AuditRecord> {
    const pending = buildPendingRecord(decision, this.chain.lastHash());
    const record = this.chain.append(pending);
    await this.storage.append(record);
    return record;
  }

  /**
   * Query the audit log using the supplied filter.
   * Returns records in ascending timestamp order.
   *
   * All filter fields are optional — omitting a field returns all records on
   * that dimension.
   */
  async query(filter: AuditFilter): Promise<AuditRecord[]> {
    return this.storage.query(filter);
  }

  /**
   * Verify the integrity of every record in the log.
   *
   * Walks the complete record set, re-derives each SHA-256 hash from scratch,
   * and compares it against the stored value.  Any discrepancy indicates that
   * a record was altered after it was written.
   *
   * This operation reads the full record corpus from storage and has O(n)
   * time complexity.
   */
  async verify(): Promise<ChainVerificationResult> {
    const records = await this.storage.all();
    return this.chain.verify(records);
  }

  /**
   * Export records to the requested format.
   *
   * Supported formats:
   * - `json` — JSON array of AuditRecord objects.
   * - `csv`  — RFC 4180 CSV with a header row.
   * - `cef`  — Common Event Format for SIEM integration (Splunk / ELK).
   *
   * An optional `filter` narrows the export to a subset of records.
   */
  async exportRecords(format: ExportFormat, filter?: AuditFilter): Promise<string> {
    const records = filter !== undefined
      ? await this.storage.query(filter)
      : await this.storage.all();
    return exportRecords(records, format);
  }

  /**
   * Return the total number of records currently in the store.
   */
  async count(): Promise<number> {
    return this.storage.count();
  }
}
