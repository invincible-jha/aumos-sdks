// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { z } from 'zod';

// ─── Period ─────────────────────────────────────────────────────────────────

export const PeriodSchema = z.enum(['hourly', 'daily', 'weekly', 'monthly', 'total']);
export type Period = z.infer<typeof PeriodSchema>;

export const PERIOD_MS: Record<Exclude<Period, 'total'>, number> = {
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
  monthly: 2_592_000_000,
};

// ─── Envelope ────────────────────────────────────────────────────────────────

export const EnvelopeConfigSchema = z.object({
  id: z.string().optional(),
  category: z.string().min(1),
  limit: z.number().positive(),
  period: PeriodSchema,
});
export type EnvelopeConfig = z.infer<typeof EnvelopeConfigSchema>;

export interface SpendingEnvelope {
  readonly id: string;
  readonly category: string;
  readonly limit: number;
  readonly period: Period;
  spent: number;
  committed: number;
  periodStart: Date;
  suspended: boolean;
}

// ─── Check result ────────────────────────────────────────────────────────────

export type CheckReason = 'within_budget' | 'exceeds_budget' | 'no_envelope' | 'suspended';

export interface BudgetCheckResult {
  readonly permitted: boolean;
  readonly available: number;
  readonly requested: number;
  readonly limit: number;
  readonly spent: number;
  readonly committed: number;
  readonly reason: CheckReason;
}

// ─── Commit ──────────────────────────────────────────────────────────────────

export interface CommitResult {
  readonly permitted: boolean;
  readonly commitId: string | null;
  readonly available: number;
  readonly requested: number;
  readonly reason: CheckReason;
}

export interface PendingCommit {
  readonly id: string;
  readonly category: string;
  readonly amount: number;
  readonly createdAt: Date;
}

// ─── Transaction ─────────────────────────────────────────────────────────────

export interface Transaction {
  readonly id: string;
  readonly category: string;
  readonly amount: number;
  readonly description?: string;
  readonly timestamp: Date;
  readonly envelopeId?: string;
}

export const TransactionFilterSchema = z.object({
  category: z.string().optional(),
  since: z.date().optional(),
  until: z.date().optional(),
  minAmount: z.number().optional(),
  maxAmount: z.number().optional(),
}).optional();
export type TransactionFilter = z.infer<typeof TransactionFilterSchema>;

// ─── Utilization ─────────────────────────────────────────────────────────────

export interface BudgetUtilization {
  readonly category: string;
  readonly envelopeId: string;
  readonly limit: number;
  readonly spent: number;
  readonly committed: number;
  readonly available: number;
  readonly utilizationPercent: number;
  readonly period: Period;
  readonly periodStart: Date;
  readonly suspended: boolean;
}

// ─── Enforcer config ─────────────────────────────────────────────────────────

export const BudgetEnforcerConfigSchema = z.object({
  /** Optional namespace / agent ID for storage key isolation */
  namespace: z.string().optional(),
}).optional();
export type BudgetEnforcerConfig = z.infer<typeof BudgetEnforcerConfigSchema>;
