// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { randomUUID } from 'crypto';
import { EnvelopeConfigSchema } from './types.js';
import type { SpendingEnvelope, EnvelopeConfig, Period } from './types.js';
import { PERIOD_MS } from './types.js';

/**
 * Build a new SpendingEnvelope from caller-supplied config.
 * Validates inputs via Zod before constructing the envelope.
 */
export function createEnvelope(config: EnvelopeConfig): SpendingEnvelope {
  const validated = EnvelopeConfigSchema.parse(config);
  return {
    id: validated.id ?? randomUUID(),
    category: validated.category,
    limit: validated.limit,
    period: validated.period,
    spent: 0,
    committed: 0,
    periodStart: new Date(),
    suspended: false,
  };
}

/**
 * Return how many milliseconds the given period spans.
 * Returns Infinity for 'total' (never resets).
 */
export function periodDurationMs(period: Period): number {
  if (period === 'total') return Infinity;
  return PERIOD_MS[period];
}

/**
 * Determine whether an envelope's period window has elapsed.
 */
export function isPeriodExpired(envelope: SpendingEnvelope, now: Date = new Date()): boolean {
  if (envelope.period === 'total') return false;
  const elapsed = now.getTime() - envelope.periodStart.getTime();
  return elapsed >= PERIOD_MS[envelope.period];
}

/**
 * Reset an envelope's accumulators and advance periodStart.
 * Mutates the envelope in place — callers must re-persist it.
 */
export function refreshEnvelopePeriod(envelope: SpendingEnvelope, now: Date = new Date()): void {
  if (envelope.period === 'total') return;
  const durationMs = PERIOD_MS[envelope.period];
  const elapsed = now.getTime() - envelope.periodStart.getTime();
  if (elapsed < durationMs) return;

  // Step periodStart forward by whole periods so we don't drift.
  const periodsElapsed = Math.floor(elapsed / durationMs);
  const newStart = new Date(envelope.periodStart.getTime() + periodsElapsed * durationMs);

  envelope.spent = 0;
  envelope.committed = 0;
  envelope.periodStart = newStart;
}

/**
 * Compute how much of the limit remains available for new spending.
 */
export function availableBalance(envelope: SpendingEnvelope): number {
  return Math.max(0, envelope.limit - envelope.spent - envelope.committed);
}

/**
 * Compute utilization as a percentage (0–100+).
 */
export function utilizationPercent(envelope: SpendingEnvelope): number {
  if (envelope.limit === 0) return 100;
  return ((envelope.spent + envelope.committed) / envelope.limit) * 100;
}
