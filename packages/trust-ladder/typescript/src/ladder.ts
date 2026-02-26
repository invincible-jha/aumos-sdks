// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { TRUST_LEVEL_MIN } from "./levels.js";
import type { TrustLevelValue } from "./levels.js";
import { resolveConfig } from "./config.js";
import type { DecayConfig, TrustLadderConfig } from "./config.js";
import { AssignmentStore, validateAgentId, validateLevel } from "./assignment.js";
import { DecayEngine } from "./decay.js";
import type {
  TrustAssignment,
  TrustChangeKind,
  TrustChangeRecord,
  TrustCheckResult,
  AssignOptions,
} from "./types.js";

/**
 * TrustLadder — the primary entry point for the @aumos/trust-ladder package.
 *
 * Manages 6-level graduated trust assignments for AI agents across
 * independent named scopes. Trust changes are strictly manual: the ladder
 * never automatically promotes or alters trust based on agent behaviour.
 * Decay (if configured) can only lower the effective level over time — it
 * never increases it.
 *
 * ## Usage
 *
 * ```typescript
 * const ladder = new TrustLadder({ decay: { enabled: false } });
 *
 * // Assign trust manually
 * ladder.assign("agent-1", 3, "payments", { reason: "Approved by ops team" });
 *
 * // Check effective level
 * const result = ladder.check("agent-1", 3, "payments");
 * if (result.permitted) {
 *   // proceed with action
 * }
 * ```
 */
export class TrustLadder {
  private readonly store: AssignmentStore;
  private readonly decayEngine: DecayEngine;
  private readonly decayConfig: DecayConfig;
  private readonly defaultScope: string;

  constructor(config?: TrustLadderConfig) {
    const resolved = resolveConfig(config);
    this.store = new AssignmentStore(resolved.maxHistoryPerScope);
    this.decayConfig = resolved.decay;
    this.decayEngine = new DecayEngine(resolved.decay);
    this.defaultScope = resolved.defaultScope;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Manually assign a trust level to an agent within an optional scope.
   *
   * This is the ONLY way trust levels change. The ladder never automatically
   * adjusts levels based on agent behaviour or any other signal.
   *
   * @param agentId       Non-empty identifier for the agent.
   * @param level         Trust level integer in [0, 5].
   * @param scope         Named scope for the assignment. Defaults to the
   *                      ladder's defaultScope (empty string = global).
   * @param options       Optional reason and operator identifier for audit.
   * @returns             The created TrustAssignment record.
   * @throws TypeError    If agentId is not a non-empty string.
   * @throws RangeError   If level is not an integer in [0, 5].
   */
  assign(
    agentId: string,
    level: number,
    scope?: string,
    options?: AssignOptions
  ): TrustAssignment {
    validateAgentId(agentId);
    validateLevel(level);

    const resolvedScope = scope ?? this.defaultScope;
    const resolvedOptions: AssignOptions = options ?? {};

    return this.store.record(
      agentId,
      resolvedScope,
      level as TrustLevelValue,
      resolvedOptions,
      Date.now()
    );
  }

  /**
   * Get the effective trust level for an agent in a scope, accounting for
   * any configured decay.
   *
   * If no assignment exists, returns TRUST_LEVEL_MIN (0 — OBSERVER).
   *
   * @param agentId  Non-empty identifier for the agent.
   * @param scope    Named scope. Defaults to the ladder's defaultScope.
   * @returns        Effective trust level in [0, 5].
   */
  getLevel(agentId: string, scope?: string): number {
    validateAgentId(agentId);

    const resolvedScope = scope ?? this.defaultScope;
    const assignment = this.store.get(agentId, resolvedScope);

    if (assignment === undefined) {
      return TRUST_LEVEL_MIN;
    }

    const now = Date.now();
    const result = this.decayEngine.compute(assignment, now);

    // Record a history entry when decay has lowered the effective level and
    // it has not already been recorded at this level. This prevents duplicate
    // history entries on repeated getLevel() calls at the same effective level.
    if (result.effectiveLevel !== assignment.assignedLevel) {
      const lastRecorded = this.store.getLastRecordedLevel(agentId, resolvedScope);
      if (lastRecorded === undefined || lastRecorded !== result.effectiveLevel) {
        const changeKind: TrustChangeKind =
          this.decayConfig.enabled && this.decayConfig.type === "cliff"
            ? "decay_cliff"
            : "decay_step";
        // Use the last recorded level (or the assigned level if no prior record)
        // as the previousLevel for accurate history continuity.
        const previousLevel = lastRecorded ?? assignment.assignedLevel;
        this.store.recordDecayStep(
          agentId,
          resolvedScope,
          previousLevel,
          result.effectiveLevel,
          changeKind,
          now
        );
      }
    }

    return result.effectiveLevel;
  }

  /**
   * Check whether an agent's effective trust level satisfies a required minimum.
   *
   * @param agentId        Non-empty identifier for the agent.
   * @param requiredLevel  Minimum required trust level integer in [0, 5].
   * @param scope          Named scope. Defaults to the ladder's defaultScope.
   * @returns              TrustCheckResult with permitted flag and context.
   * @throws RangeError    If requiredLevel is not in [0, 5].
   */
  check(agentId: string, requiredLevel: number, scope?: string): TrustCheckResult {
    validateAgentId(agentId);
    validateLevel(requiredLevel);

    const resolvedScope = scope ?? this.defaultScope;
    const effectiveLevel = this.getLevel(agentId, resolvedScope) as TrustLevelValue;
    const required = requiredLevel as TrustLevelValue;

    return {
      permitted: effectiveLevel >= required,
      effectiveLevel,
      requiredLevel: required,
      scope: resolvedScope,
      checkedAt: Date.now(),
    };
  }

  /**
   * Retrieve the immutable history of trust changes for an agent in a scope.
   *
   * The history includes manual assignments, decay events, and revocations.
   *
   * @param agentId  Non-empty identifier for the agent.
   * @param scope    Named scope. Defaults to the ladder's defaultScope.
   * @returns        Read-only array of TrustChangeRecord, oldest first.
   */
  getHistory(agentId: string, scope?: string): readonly TrustChangeRecord[] {
    validateAgentId(agentId);
    const resolvedScope = scope ?? this.defaultScope;
    return this.store.getHistory(agentId, resolvedScope);
  }

  /**
   * Remove all assignments for an agent in a scope (or all scopes if no scope
   * is given). Records a revocation entry in history.
   *
   * After revocation, getLevel() returns TRUST_LEVEL_MIN for that scope.
   *
   * @param agentId  Non-empty identifier for the agent.
   * @param scope    Named scope. If omitted, revokes all scopes for the agent.
   */
  revoke(agentId: string, scope?: string): void {
    validateAgentId(agentId);

    if (scope !== undefined) {
      this.store.revoke(agentId, scope, Date.now());
      return;
    }

    // Revoke all scopes for this agent
    const all = this.store.listAll();
    const agentAssignments = all.filter((a) => a.agentId === agentId);
    const now = Date.now();
    for (const assignment of agentAssignments) {
      this.store.revoke(assignment.agentId, assignment.scope, now);
    }
  }

  /**
   * List all current (non-revoked) assignments managed by this ladder instance.
   *
   * @returns  Read-only array of TrustAssignment.
   */
  listAssignments(): readonly TrustAssignment[] {
    return this.store.listAll();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Apply time-based gradual decay to a single assignment and return the
   * effective level. This is an internal computation method; history
   * recording is handled by getLevel().
   *
   * @private
   */
  private applyGradualDecay(assignment: TrustAssignment): number {
    return this.decayEngine.compute(assignment, Date.now()).effectiveLevel;
  }
}
