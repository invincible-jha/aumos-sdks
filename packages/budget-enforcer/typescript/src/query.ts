// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { SpendingEnvelope, BudgetUtilization } from './types.js';
import { availableBalance, utilizationPercent } from './envelope.js';

/**
 * Derive a BudgetUtilization snapshot from a live envelope.
 * The snapshot is point-in-time — callers should refresh the period
 * before calling this if they need current values.
 */
export function buildUtilization(envelope: SpendingEnvelope): BudgetUtilization {
  return {
    category: envelope.category,
    envelopeId: envelope.id,
    limit: envelope.limit,
    spent: envelope.spent,
    committed: envelope.committed,
    available: availableBalance(envelope),
    utilizationPercent: utilizationPercent(envelope),
    period: envelope.period,
    periodStart: envelope.periodStart,
    suspended: envelope.suspended,
  };
}

/**
 * Summarize all envelopes into a flat array of utilization snapshots,
 * sorted by utilizationPercent descending (most constrained first).
 */
export function buildAllUtilizations(
  envelopes: readonly SpendingEnvelope[],
): readonly BudgetUtilization[] {
  return envelopes
    .map((envelope) => buildUtilization(envelope))
    .sort((a, b) => b.utilizationPercent - a.utilizationPercent);
}
