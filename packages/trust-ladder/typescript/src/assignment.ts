// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { isValidTrustLevel, TRUST_LEVEL_MIN, clampTrustLevel } from "./levels.js";
import type { TrustLevelValue } from "./levels.js";
import type {
  TrustAssignment,
  TrustChangeRecord,
  AssignOptions,
  ScopeKey,
} from "./types.js";
import { buildScopeKey } from "./types.js";

/**
 * Manages the storage and retrieval of trust assignments and their
 * associated change-history records.
 *
 * All writes are append-only for the history log. The current assignment
 * per (agentId, scope) key is kept in a separate Map for O(1) lookup.
 */
export class AssignmentStore {
  private readonly assignments: Map<ScopeKey, TrustAssignment> = new Map();
  private readonly history: Map<ScopeKey, TrustChangeRecord[]> = new Map();
  private readonly maxHistoryPerScope: number;

  constructor(maxHistoryPerScope: number) {
    this.maxHistoryPerScope = maxHistoryPerScope;
  }

  /**
   * Record a new manual trust assignment.
   * Returns the created TrustAssignment.
   */
  record(
    agentId: string,
    scope: string,
    level: TrustLevelValue,
    options: AssignOptions,
    now: number
  ): TrustAssignment {
    const key = buildScopeKey(agentId, scope);
    const previous = this.assignments.get(key);

    const assignment: TrustAssignment = {
      agentId,
      scope,
      assignedLevel: level,
      assignedAt: now,
      reason: options.reason,
      assignedBy: options.assignedBy,
    };

    this.assignments.set(key, assignment);

    const changeRecord: TrustChangeRecord = {
      agentId,
      scope,
      previousLevel: previous?.assignedLevel,
      newLevel: level,
      changedAt: now,
      changeKind: "manual",
      reason: options.reason,
      changedBy: options.assignedBy,
    };

    this.appendHistory(key, changeRecord);
    return assignment;
  }

  /**
   * Record an internal decay step, appending to history but not changing
   * the stored assignment (the assignment preserves the original operator intent).
   */
  recordDecayStep(
    agentId: string,
    scope: string,
    previousLevel: TrustLevelValue,
    newLevel: TrustLevelValue,
    changeKind: "decay_cliff" | "decay_step",
    now: number
  ): TrustChangeRecord {
    const key = buildScopeKey(agentId, scope);

    const record: TrustChangeRecord = {
      agentId,
      scope,
      previousLevel,
      newLevel,
      changedAt: now,
      changeKind,
      reason:
        changeKind === "decay_cliff"
          ? "Assignment TTL expired; trust reset to OBSERVER."
          : "Gradual decay step; trust decreased by one level.",
    };

    this.appendHistory(key, record);
    return record;
  }

  /**
   * Remove the current assignment for (agentId, scope) and record a
   * revocation entry in history.
   */
  revoke(agentId: string, scope: string, now: number): boolean {
    const key = buildScopeKey(agentId, scope);
    const existing = this.assignments.get(key);
    if (existing === undefined) {
      return false;
    }

    this.assignments.delete(key);

    const record: TrustChangeRecord = {
      agentId,
      scope,
      previousLevel: existing.assignedLevel,
      newLevel: TRUST_LEVEL_MIN,
      changedAt: now,
      changeKind: "revocation",
      reason: "Assignment explicitly revoked.",
    };

    this.appendHistory(key, record);
    return true;
  }

  /** Retrieve the current TrustAssignment for (agentId, scope), or undefined. */
  get(agentId: string, scope: string): TrustAssignment | undefined {
    return this.assignments.get(buildScopeKey(agentId, scope));
  }

  /** Retrieve all current assignments as a read-only array. */
  listAll(): readonly TrustAssignment[] {
    return Array.from(this.assignments.values());
  }

  /** Retrieve the change history for (agentId, scope) as a read-only array. */
  getHistory(agentId: string, scope: string): readonly TrustChangeRecord[] {
    return this.history.get(buildScopeKey(agentId, scope)) ?? [];
  }

  /**
   * Return the newLevel from the most recent history entry for (agentId, scope),
   * or undefined if there is no history yet. Used to detect whether a decay
   * step has already been recorded for the current effective level.
   */
  getLastRecordedLevel(agentId: string, scope: string): TrustLevelValue | undefined {
    const records = this.history.get(buildScopeKey(agentId, scope));
    if (records === undefined || records.length === 0) return undefined;
    return records[records.length - 1]!.newLevel;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private appendHistory(key: ScopeKey, record: TrustChangeRecord): void {
    if (!this.history.has(key)) {
      this.history.set(key, []);
    }
    const records = this.history.get(key)!;
    records.push(record);

    if (this.maxHistoryPerScope > 0 && records.length > this.maxHistoryPerScope) {
      records.splice(0, records.length - this.maxHistoryPerScope);
    }
  }
}

// ---------------------------------------------------------------------------
// Input validation helpers (used by TrustLadder)
// ---------------------------------------------------------------------------

/**
 * Validates that agentId is a non-empty string.
 * Throws TypeError on failure.
 */
export function validateAgentId(agentId: unknown): asserts agentId is string {
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    throw new TypeError("agentId must be a non-empty string.");
  }
}

/**
 * Validates that a level value is a valid trust level integer [0, 5].
 * Throws RangeError on failure.
 */
export function validateLevel(level: unknown): asserts level is TrustLevelValue {
  if (!isValidTrustLevel(level)) {
    throw new RangeError(
      `Trust level must be an integer in the range [0, 5]. Received: ${String(level)}`
    );
  }
}

/**
 * Coerces a required-level argument and ensures it is within range.
 */
export function coerceRequiredLevel(level: number): TrustLevelValue {
  validateLevel(level);
  return clampTrustLevel(level);
}
