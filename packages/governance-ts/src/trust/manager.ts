// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { TrustAssignment, TrustCheckResult } from '../types.js';
import { TrustLevel } from '../types.js';
import type { TrustConfig } from '../config.js';
import { parseTrustConfig } from '../config.js';
import { computeEffectiveLevel } from './decay.js';
import { validateTrustLevel } from './validator.js';

/** Options accepted by TrustManager.setLevel(). */
export interface SetLevelOptions {
  /** Human-readable rationale recorded on the assignment. */
  reason?: string;
  /** ISO 8601 datetime after which the assignment expires. */
  expiresAt?: string;
  /** Who is making the assignment. Defaults to "owner". */
  assignedBy?: 'owner' | 'system' | 'policy';
}

/**
 * TrustManager is the authoritative runtime registry for agent trust levels.
 *
 * All trust changes are manual — there is no mechanism for automatic
 * level promotion based on agent behaviour.  Operators or policy engines
 * call setLevel() explicitly to raise or lower trust.
 *
 * Storage is an in-memory Map keyed by a composite of `agentId + scope`.
 * Records are never purged automatically; expired assignments remain in
 * the map but return L0_OBSERVER via computeEffectiveLevel().
 *
 * Public API (Fire Line — do NOT add methods beyond these three):
 *   setLevel()   — assign a trust level to an agent
 *   getLevel()   — retrieve effective level accounting for decay/expiry
 *   checkLevel() — evaluate whether an agent meets a required level
 */
export class TrustManager {
  readonly #config: TrustConfig;
  /** Primary storage keyed by `agentId:scope` (scope defaults to "default"). */
  readonly #assignments: Map<string, TrustAssignment> = new Map();

  constructor(config: unknown = {}) {
    this.#config = parseTrustConfig(config);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds the map key for a given agentId + optional scope string.
   * Using a composite key means an agent can hold different trust levels
   * in different scopes simultaneously.
   */
  #makeKey(agentId: string, scope?: string): string {
    return `${agentId}:${scope ?? 'default'}`;
  }

  /**
   * Looks up the stored assignment for an agent/scope pair.
   * Returns undefined when no record exists.
   */
  #getAssignment(agentId: string, scope?: string): TrustAssignment | undefined {
    return this.#assignments.get(this.#makeKey(agentId, scope));
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Assigns a trust level to an agent.
   *
   * The previous level (if any) is captured on the new assignment record
   * for audit trail purposes.  Callers may supply an expiry via `options.expiresAt`
   * to create time-bounded grants.
   *
   * @param agentId  - The agent receiving the assignment.
   * @param level    - The trust level to assign.
   * @param scope    - Optional scope label narrowing where this applies.
   * @param options  - Additional metadata for the assignment record.
   * @returns The newly created TrustAssignment.
   */
  setLevel(
    agentId: string,
    level: TrustLevel,
    scope?: string,
    options: SetLevelOptions = {},
  ): TrustAssignment {
    if (agentId.trim().length === 0) {
      throw new RangeError('agentId must be a non-empty string.');
    }

    const existing = this.#getAssignment(agentId, scope);
    const previousLevel = existing !== undefined ? existing.level : undefined;

    const assignment: TrustAssignment = {
      agentId,
      level,
      assignedAt: new Date().toISOString(),
      assignedBy: options.assignedBy ?? 'owner',
      reason: options.reason,
      previousLevel,
      scope,
      expiresAt: options.expiresAt,
    };

    this.#assignments.set(this.#makeKey(agentId, scope), assignment);
    return assignment;
  }

  /**
   * Returns the effective trust level for an agent, accounting for any
   * configured decay policy and expiry on the stored assignment.
   *
   * When no assignment exists the configured `defaultLevel` is returned.
   *
   * @param agentId - The agent to query.
   * @param scope   - Optional scope label.  Must match the scope used in setLevel().
   */
  getLevel(agentId: string, scope?: string): TrustLevel {
    const assignment = this.#getAssignment(agentId, scope);
    if (assignment === undefined) {
      return this.#config.defaultLevel;
    }
    return computeEffectiveLevel(assignment, this.#config, new Date());
  }

  /**
   * Checks whether an agent's current effective trust level meets or
   * exceeds the specified minimum requirement.
   *
   * This is the primary gate method used by GovernanceEngine and MCP
   * middleware.  It never throws — callers should inspect `permitted`
   * on the returned object.
   *
   * @param agentId       - The agent to evaluate.
   * @param requiredLevel - Minimum level the action demands.
   * @param scope         - Optional scope label.
   */
  checkLevel(agentId: string, requiredLevel: TrustLevel, scope?: string): TrustCheckResult {
    const effectiveLevel = this.getLevel(agentId, scope);
    return validateTrustLevel(agentId, effectiveLevel, requiredLevel);
  }

  /**
   * Returns a snapshot of all stored assignments.
   * Intended for inspection and debugging — not part of the governance gate API.
   */
  listAssignments(): readonly TrustAssignment[] {
    return Array.from(this.#assignments.values());
  }
}
