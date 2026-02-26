// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

// ─── Core class ──────────────────────────────────────────────────────────────
export { BudgetEnforcer } from './enforcer.js';

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  Period,
  EnvelopeConfig,
  SpendingEnvelope,
  BudgetCheckResult,
  CheckReason,
  CommitResult,
  PendingCommit,
  Transaction,
  TransactionFilter,
  BudgetUtilization,
  BudgetEnforcerConfig,
} from './types.js';

// ─── Zod schemas (for downstream validation) ─────────────────────────────────
export {
  PeriodSchema,
  EnvelopeConfigSchema,
  TransactionFilterSchema,
  BudgetEnforcerConfigSchema,
  PERIOD_MS,
} from './types.js';

// ─── Storage ─────────────────────────────────────────────────────────────────
export type { BudgetStorage } from './storage/interface.js';
export { MemoryStorage } from './storage/memory.js';

// ─── Utilities ───────────────────────────────────────────────────────────────
export {
  createEnvelope,
  periodDurationMs,
  isPeriodExpired,
  refreshEnvelopePeriod,
  availableBalance,
  utilizationPercent,
} from './envelope.js';

export { buildTransaction, filterTransactions } from './transaction.js';
export { buildUtilization, buildAllUtilizations } from './query.js';
