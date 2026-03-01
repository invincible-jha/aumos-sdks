// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Retention Policy Engine
 *
 * Evaluates whether a `GovernedMemoryRecord` has expired and whether a
 * given agent has the sharing permissions required to access it.
 *
 * This module contains no behavioral analysis, no scoring, and no adaptive
 * logic.  It performs purely mechanical comparisons against static policy
 * values.
 */

import type {
  GovernedMemoryRecord,
  RetentionPolicy,
} from './types.js';

// ---------------------------------------------------------------------------
// ISO 8601 duration parser (subset — P[n]D, P[n]W, PT[n]H, PT[n]M, PT[n]S)
// ---------------------------------------------------------------------------

/**
 * Parses a subset of ISO 8601 duration strings into milliseconds.
 *
 * Supported patterns (combinable):
 *   P[n]Y  — years (approximated as 365.25 days)
 *   P[n]M  — months (approximated as 30 days)
 *   P[n]W  — weeks
 *   P[n]D  — days
 *   T[n]H  — hours
 *   T[n]M  — minutes
 *   T[n]S  — seconds
 *
 * Returns `undefined` if the input string is invalid or does not match
 * the expected format.
 */
export function parseDurationMs(isoDuration: string): number | undefined {
  // ISO 8601 duration regex: P[nY][nM][nW][nD][T[nH][nM][nS]]
  const pattern =
    /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

  const match = pattern.exec(isoDuration);
  if (match === null) {
    return undefined;
  }

  const years = parseFloat(match[1] ?? '0');
  const months = parseFloat(match[2] ?? '0');
  const weeks = parseFloat(match[3] ?? '0');
  const days = parseFloat(match[4] ?? '0');
  const hours = parseFloat(match[5] ?? '0');
  const minutes = parseFloat(match[6] ?? '0');
  const seconds = parseFloat(match[7] ?? '0');

  const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const MINUTE_MS = 60 * 1000;
  const SECOND_MS = 1000;

  return (
    years * YEAR_MS +
    months * MONTH_MS +
    weeks * WEEK_MS +
    days * DAY_MS +
    hours * HOUR_MS +
    minutes * MINUTE_MS +
    seconds * SECOND_MS
  );
}

// ---------------------------------------------------------------------------
// computeExpiresAt
// ---------------------------------------------------------------------------

/**
 * Computes the ISO 8601 expiry timestamp for a memory slot created at
 * `createdAt`, given a retention policy.
 *
 * Returns `undefined` if the policy has no `maxAge` (slot never expires).
 * Returns `undefined` if `maxAge` cannot be parsed as an ISO 8601 duration.
 *
 * @param createdAt  - ISO 8601 timestamp when the slot was created.
 * @param policy     - Retention policy containing the optional `maxAge`.
 */
export function computeExpiresAt(
  createdAt: string,
  policy: RetentionPolicy,
): string | undefined {
  if (policy.maxAge === undefined) {
    return undefined;
  }

  const durationMs = parseDurationMs(policy.maxAge);
  if (durationMs === undefined) {
    return undefined;
  }

  const createdAtMs = Date.parse(createdAt);
  if (isNaN(createdAtMs)) {
    return undefined;
  }

  return new Date(createdAtMs + durationMs).toISOString();
}

// ---------------------------------------------------------------------------
// RetentionPolicyEngine
// ---------------------------------------------------------------------------

/**
 * Evaluates retention policies against memory records.
 *
 * This class is stateless — all evaluation is performed against the data
 * supplied in the method arguments.  It exists to group related logic and
 * to provide a consistent interface for retention evaluation.
 *
 * Usage:
 * ```ts
 * const engine = new RetentionPolicyEngine();
 *
 * const isExpired = engine.isExpired(record);
 * const canShare  = engine.canShareWith('agent-b', record);
 * const expired   = engine.filterExpired(allRecords);
 * ```
 */
export class RetentionPolicyEngine {
  // -------------------------------------------------------------------------
  // Expiry evaluation
  // -------------------------------------------------------------------------

  /**
   * Returns true if the given memory record has expired.
   *
   * A record is expired when `expiresAt` is present and is at or before
   * `referenceTime`.
   *
   * @param record        - The record to evaluate.
   * @param referenceTime - The time to compare against. Defaults to now.
   */
  isExpired(
    record: Pick<GovernedMemoryRecord, 'expiresAt'>,
    referenceTime: Date = new Date(),
  ): boolean {
    if (record.expiresAt === undefined) {
      return false;
    }
    const expiresAtMs = Date.parse(record.expiresAt);
    if (isNaN(expiresAtMs)) {
      // Unparseable expiry — treat as not expired to avoid false deletions.
      return false;
    }
    return referenceTime.getTime() >= expiresAtMs;
  }

  // -------------------------------------------------------------------------
  // Sharing evaluation
  // -------------------------------------------------------------------------

  /**
   * Returns true if `requestingAgentId` is permitted to access `record`
   * under the sharing rules of its retention policy.
   *
   * Sharing is permitted when:
   *   - `requestingAgentId` is the slot owner (always allowed), OR
   *   - `retentionPolicy.shareable` is true
   *
   * Consent scope validation is intentionally NOT performed here — that is
   * the responsibility of `MemoryGovernor.evaluate()`.  This method only
   * checks the structural sharing permission.
   *
   * @param requestingAgentId - The agent requesting access.
   * @param record            - The record being accessed.
   */
  canShareWith(
    requestingAgentId: string,
    record: Pick<GovernedMemoryRecord, 'ownerAgentId' | 'retentionPolicy'>,
  ): boolean {
    if (requestingAgentId === record.ownerAgentId) {
      return true;
    }
    return record.retentionPolicy.shareable;
  }

  // -------------------------------------------------------------------------
  // Bulk expiry filtering
  // -------------------------------------------------------------------------

  /**
   * Returns the subset of `records` that have expired.
   *
   * Intended to be called by cleanup routines that want to identify stale
   * slots eligible for deletion.
   *
   * @param records       - The records to evaluate.
   * @param referenceTime - The time to compare against. Defaults to now.
   */
  filterExpired(
    records: readonly GovernedMemoryRecord[],
    referenceTime: Date = new Date(),
  ): readonly GovernedMemoryRecord[] {
    return records.filter((record) => this.isExpired(record, referenceTime));
  }

  // -------------------------------------------------------------------------
  // Consent scope validation
  // -------------------------------------------------------------------------

  /**
   * Returns true if the provided set of active consent scopes satisfies the
   * `requiredConsentScopes` of the given retention policy.
   *
   * All required scopes must be present in `activeScopes`.
   *
   * @param policy       - The retention policy whose scopes to validate.
   * @param activeScopes - The set of scopes currently active for the
   *   requesting agent.
   */
  hasRequiredScopes(
    policy: Pick<RetentionPolicy, 'requiredConsentScopes'>,
    activeScopes: readonly string[],
  ): boolean {
    const activeScopeSet = new Set(activeScopes);
    return policy.requiredConsentScopes.every((scope) => activeScopeSet.has(scope));
  }
}
