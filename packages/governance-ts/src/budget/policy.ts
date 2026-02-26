// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { SpendingEnvelope } from '../types.js';
import { computeNextResetAt } from './tracker.js';

/**
 * Determines whether a spending envelope's period has elapsed and it is
 * due for a reset.
 *
 * Returns true when:
 * - The envelope has a non-null `resetAt` field.
 * - The current time is at or past that reset point.
 *
 * "total" envelopes never have a resetAt and therefore always return false.
 */
export function isPeriodExpired(envelope: SpendingEnvelope, now: Date = new Date()): boolean {
  if (envelope.resetAt === undefined) {
    return false;
  }
  return now.getTime() >= new Date(envelope.resetAt).getTime();
}

/**
 * Resets a spending envelope for the next period.
 *
 * Zeroes `spent` and `committed`, and advances `resetAt` to the start of
 * the next period.  Mutates the envelope in place — callers hold a direct
 * reference from BudgetManager's Map so the mutation is visible immediately.
 *
 * No-op on envelopes whose period is "total".
 */
export function resetEnvelope(envelope: SpendingEnvelope, now: Date = new Date()): void {
  if (envelope.period === 'total') {
    return;
  }
  envelope.spent = 0;
  envelope.committed = 0;
  envelope.resetAt = computeNextResetAt(envelope.period, now);
}

/**
 * Applies period rollover to an envelope if its current period has elapsed.
 * Calls resetEnvelope() and returns true when a rollover occurred.
 * Returns false when the period is still active.
 */
export function applyRolloverIfDue(envelope: SpendingEnvelope, now: Date = new Date()): boolean {
  if (!isPeriodExpired(envelope, now)) {
    return false;
  }
  resetEnvelope(envelope, now);
  return true;
}
