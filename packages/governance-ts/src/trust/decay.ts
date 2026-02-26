// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { TrustAssignment } from '../types.js';
import { TrustLevel } from '../types.js';
import type { TrustConfig } from '../config.js';

/**
 * Computes the effective trust level of an assignment, accounting for
 * expiry and decay policy.
 *
 * Two decay modes are supported:
 *
 * - **cliff** — the assignment expires atomically at `expiresAt`, dropping
 *   the agent to L0_OBSERVER.  No intermediate steps.
 *
 * - **gradual** — on each elapsed review interval after `expiresAt`, the
 *   level decrements by one tier.  The agent bottoms out at L0_OBSERVER and
 *   stays there until a new setLevel() call is made.
 *
 * If neither expiry nor a decay config is present, the original assignment
 * level is returned unchanged.
 *
 * This function is pure and has no side effects.
 */
export function computeEffectiveLevel(
  assignment: TrustAssignment,
  config: TrustConfig,
  now: Date = new Date(),
): TrustLevel {
  // No expiry — assignment is perpetual.
  if (assignment.expiresAt === undefined) {
    return assignment.level;
  }

  const expiryTime = new Date(assignment.expiresAt).getTime();
  const nowTime = now.getTime();

  // Assignment has not yet expired.
  if (nowTime < expiryTime) {
    return assignment.level;
  }

  // Assignment has expired.  Apply decay mode.
  const decayConfig = config.decay;

  if (decayConfig === undefined || decayConfig.type === 'cliff') {
    // Cliff mode: drop immediately to the floor level.
    return TrustLevel.L0_OBSERVER;
  }

  // Gradual mode: decrement one level per elapsed interval.
  const intervalMs = decayConfig.intervalMs;
  if (intervalMs === undefined || intervalMs <= 0) {
    // No valid interval configured; treat as cliff.
    return TrustLevel.L0_OBSERVER;
  }

  const elapsedMs = nowTime - expiryTime;
  const elapsedIntervals = Math.floor(elapsedMs / intervalMs);

  const decayedLevel = (assignment.level as number) - elapsedIntervals;
  const floorLevel = TrustLevel.L0_OBSERVER as number;

  return Math.max(decayedLevel, floorLevel) as TrustLevel;
}

/**
 * Returns true when the assignment's expiry has passed as of `now`.
 * Used by TrustManager to distinguish live versus expired records.
 */
export function isExpired(assignment: TrustAssignment, now: Date = new Date()): boolean {
  if (assignment.expiresAt === undefined) {
    return false;
  }
  return now.getTime() >= new Date(assignment.expiresAt).getTime();
}
