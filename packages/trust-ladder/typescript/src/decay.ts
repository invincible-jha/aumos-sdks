// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { TRUST_LEVEL_MIN, clampTrustLevel } from "./levels.js";
import type { TrustLevelValue } from "./levels.js";
import type { TrustAssignment } from "./types.js";
import type { DecayConfig } from "./config.js";

/**
 * The result of computing the current effective trust level for an assignment,
 * taking decay into account.
 */
export interface DecayResult {
  /** Effective trust level after applying decay. */
  readonly effectiveLevel: TrustLevelValue;

  /**
   * Whether decay has fully consumed the assignment (cliff drop to L0 from L0,
   * or gradual decay that has already reached L0 at the previous check).
   */
  readonly decayedToFloor: boolean;

  /**
   * Number of decay steps that have occurred since the last recorded check.
   * For cliff decay this is always 0 or 1 (the cliff event).
   * For gradual decay this is the integer number of new steps.
   */
  readonly newStepCount: number;
}

/**
 * Stateless decay engine.
 *
 * All methods are pure functions of (assignment, config, nowMs).
 * The engine does NOT mutate state — callers must call AssignmentStore
 * methods to record the resulting decay history entries.
 *
 * Decay is strictly one-directional: effective levels only decrease.
 * There is no pathway for the engine to increase trust.
 */
export class DecayEngine {
  private readonly config: DecayConfig;

  constructor(config: DecayConfig) {
    this.config = config;
  }

  /**
   * Compute the effective trust level for an assignment at time nowMs.
   * If decay is disabled, returns the assignment's assignedLevel unchanged.
   */
  compute(assignment: TrustAssignment, nowMs: number): DecayResult {
    if (!this.config.enabled) {
      return {
        effectiveLevel: assignment.assignedLevel,
        decayedToFloor: false,
        newStepCount: 0,
      };
    }

    if (this.config.type === "cliff") {
      return this.applyCliffDecay(assignment, nowMs);
    }

    return this.applyGradualDecay(assignment, nowMs);
  }

  // ---------------------------------------------------------------------------
  // Private decay strategies
  // ---------------------------------------------------------------------------

  /**
   * Cliff decay: if the elapsed time since assignment exceeds ttlMs,
   * the effective level immediately drops to TRUST_LEVEL_MIN (L0_OBSERVER).
   */
  private applyCliffDecay(assignment: TrustAssignment, nowMs: number): DecayResult {
    const config = this.config as Extract<DecayConfig, { type: "cliff" }>;
    const elapsedMs = nowMs - assignment.assignedAt;

    if (elapsedMs >= config.ttlMs) {
      return {
        effectiveLevel: TRUST_LEVEL_MIN,
        decayedToFloor: true,
        newStepCount: assignment.assignedLevel > TRUST_LEVEL_MIN ? 1 : 0,
      };
    }

    return {
      effectiveLevel: assignment.assignedLevel,
      decayedToFloor: false,
      newStepCount: 0,
    };
  }

  /**
   * Gradual decay: the effective level decreases by one for each complete
   * stepIntervalMs that has elapsed since assignment.
   *
   * effectiveLevel = max(TRUST_LEVEL_MIN, assignedLevel - floor(elapsed / stepIntervalMs))
   *
   * The floor is always TRUST_LEVEL_MIN; the level never increases.
   */
  private applyGradualDecay(assignment: TrustAssignment, nowMs: number): DecayResult {
    const config = this.config as Extract<DecayConfig, { type: "gradual" }>;
    const elapsedMs = nowMs - assignment.assignedAt;

    const stepsElapsed = Math.floor(elapsedMs / config.stepIntervalMs);
    const rawLevel = assignment.assignedLevel - stepsElapsed;
    const effectiveLevel = clampTrustLevel(Math.max(TRUST_LEVEL_MIN, rawLevel));

    return {
      effectiveLevel,
      decayedToFloor: effectiveLevel === TRUST_LEVEL_MIN,
      newStepCount: Math.min(stepsElapsed, assignment.assignedLevel),
    };
  }
}

// ---------------------------------------------------------------------------
// Exported pure helper
// ---------------------------------------------------------------------------

/**
 * Convenience function: compute the effective level for one assignment
 * without constructing a DecayEngine instance.
 */
export function computeEffectiveLevel(
  assignment: TrustAssignment,
  config: DecayConfig,
  nowMs: number
): TrustLevelValue {
  const engine = new DecayEngine(config);
  return engine.compute(assignment, nowMs).effectiveLevel;
}

/**
 * Returns the milliseconds remaining until the trust level decreases by at
 * least one step (or drops to floor via cliff), given the current time.
 *
 * Returns null if decay is disabled, or if the assignment is already at the
 * floor level (no further decay is possible).
 */
export function timeUntilNextDecay(
  assignment: TrustAssignment,
  config: DecayConfig,
  nowMs: number
): number | null {
  if (!config.enabled) return null;
  if (assignment.assignedLevel === TRUST_LEVEL_MIN) return null;

  const elapsedMs = nowMs - assignment.assignedAt;

  if (config.type === "cliff") {
    const remaining = config.ttlMs - elapsedMs;
    return remaining > 0 ? remaining : 0;
  }

  // Gradual: find when the next full step completes
  const stepsElapsed = Math.floor(elapsedMs / config.stepIntervalMs);
  const nextStepAt = (stepsElapsed + 1) * config.stepIntervalMs;
  const remaining = nextStepAt - elapsedMs;

  // If all levels have already decayed, return null
  const currentEffective = clampTrustLevel(
    Math.max(TRUST_LEVEL_MIN, assignment.assignedLevel - stepsElapsed)
  );
  if (currentEffective === TRUST_LEVEL_MIN) return null;

  return remaining > 0 ? remaining : 0;
}
