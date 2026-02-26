// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { GovernanceDecision } from '../types.js';
import type { AuditConfig } from '../config.js';
import { parseAuditConfig } from '../config.js';
import { createAuditRecord } from './record.js';
import type { AuditRecord, AuditContext } from './record.js';
import { filterRecords } from './query.js';
import type { AuditFilter } from './query.js';

/**
 * AuditLogger records governance decisions to an in-memory append-only log.
 *
 * Logging is recording-only.  There is no mechanism for real-time anomaly
 * detection, statistical analysis, or counterfactual generation — those
 * capabilities are exclusively the domain of proprietary AumOS product code.
 *
 * When `enabled` is false in the config, log() is a no-op and query()
 * always returns an empty array.  This allows callers to disable auditing
 * without altering their call sites.
 *
 * When `maxRecords` is reached, the oldest record is evicted before the
 * new record is appended (circular buffer semantics).
 *
 * Public API (Fire Line — do NOT add methods beyond these two core ones):
 *   log()          — record a governance decision
 *   query()        — retrieve records matching a filter
 *
 * Additional read-only helper:
 *   getRecords()   — retrieve all stored records
 */
export class AuditLogger {
  readonly #config: AuditConfig;
  readonly #records: AuditRecord[] = [];

  constructor(config: unknown = {}) {
    this.#config = parseAuditConfig(config);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Records a governance decision as an audit entry.
   *
   * The `context` parameter carries agent and action identifiers plus any
   * additional metadata that the caller wants attached to the record.
   *
   * When auditing is disabled (`enabled: false`), this method is a no-op.
   *
   * @param decision - The GovernanceDecision to log.
   * @param context  - Supplementary context (agentId, action, …).
   * @returns The created AuditRecord, or undefined when logging is disabled.
   */
  log(decision: GovernanceDecision, context: AuditContext = {}): AuditRecord | undefined {
    if (!this.#config.enabled) {
      return undefined;
    }

    const record = createAuditRecord(decision, context);

    // Evict oldest record when at capacity.
    if (this.#records.length >= this.#config.maxRecords) {
      this.#records.shift();
    }

    this.#records.push(record);
    return record;
  }

  /**
   * Queries stored audit records using the provided filter.
   *
   * All filter fields are optional and combined with AND semantics.
   * Results are returned in ascending timestamp order (oldest first).
   *
   * Returns an empty array when auditing is disabled.
   *
   * @param filter - Criteria to narrow the result set.
   */
  query(filter: AuditFilter = {}): AuditRecord[] {
    if (!this.#config.enabled) {
      return [];
    }
    return filterRecords(this.#records, filter);
  }

  /**
   * Returns a copy of all stored audit records in insertion order.
   * Intended for inspection, debugging, and export.
   */
  getRecords(): readonly AuditRecord[] {
    return [...this.#records];
  }

  /**
   * Returns the total number of records currently stored.
   */
  get recordCount(): number {
    return this.#records.length;
  }
}
