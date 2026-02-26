// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { AuditRecord } from './record.js';

/**
 * Filter criteria for AuditLogger.query().
 *
 * All fields are optional and combined with AND semantics.  Omitting a field
 * means "any value" for that dimension.
 */
export interface AuditFilter {
  /** Restrict to records at or after this ISO 8601 timestamp. */
  fromTimestamp?: string;
  /** Restrict to records strictly before this ISO 8601 timestamp. */
  toTimestamp?: string;
  /** Restrict to records for the named agent. */
  agentId?: string;
  /** Restrict to records for the named action. */
  action?: string;
  /** Restrict to records with this outcome. */
  outcome?: 'permit' | 'deny';
  /** Restrict to records produced by the named protocol. */
  protocol?: string;
  /** Maximum number of records to return.  Defaults to all matching. */
  limit?: number;
}

/**
 * Applies an AuditFilter to an array of AuditRecord objects.
 *
 * Returns matching records in ascending timestamp order (oldest first).
 * If `filter.limit` is set, the result is truncated to that many records
 * after sorting.
 *
 * This function is pure and does not mutate the input array.
 */
export function filterRecords(
  records: readonly AuditRecord[],
  filter: AuditFilter,
): AuditRecord[] {
  const fromMs = filter.fromTimestamp !== undefined ? new Date(filter.fromTimestamp).getTime() : -Infinity;
  const toMs = filter.toTimestamp !== undefined ? new Date(filter.toTimestamp).getTime() : Infinity;

  const matched = records.filter((record) => {
    const recordMs = new Date(record.timestamp).getTime();

    if (recordMs < fromMs) return false;
    if (recordMs >= toMs) return false;
    if (filter.agentId !== undefined && record.agentId !== filter.agentId) return false;
    if (filter.action !== undefined && record.action !== filter.action) return false;
    if (filter.outcome !== undefined && record.outcome !== filter.outcome) return false;
    if (filter.protocol !== undefined && record.protocol !== filter.protocol) return false;

    return true;
  });

  // Sort ascending by timestamp.
  matched.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (filter.limit !== undefined && filter.limit > 0) {
    return matched.slice(0, filter.limit);
  }

  return matched;
}
