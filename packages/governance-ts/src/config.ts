// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { z } from 'zod';
import { TrustLevel } from './types.js';
import { InvalidConfigError } from './errors.js';

// ---------------------------------------------------------------------------
// Trust config
// ---------------------------------------------------------------------------

/**
 * Zod schema for trust decay configuration.
 *
 * "cliff" drops the agent to L0_OBSERVER as soon as the assignment expires.
 * "gradual" decrements the level by one tier per review cycle.
 * `intervalMs` specifies the review cycle length in milliseconds.
 */
const TrustDecayConfigSchema = z.object({
  type: z.enum(['cliff', 'gradual']),
  /**
   * Review cycle length in milliseconds.
   * Required when type is "gradual".  Ignored for "cliff" (expiry controls
   * the single drop instead).
   */
  intervalMs: z.number().int().positive().optional(),
});

/**
 * Zod schema for an individual trust requirement entry.
 * Callers use this to declare which trust level a given action demands.
 */
const TrustRequirementSchema = z.object({
  action: z.string().min(1),
  minimumLevel: z.nativeEnum(TrustLevel),
});

/**
 * Zod schema for TrustConfig.
 */
export const TrustConfigSchema = z.object({
  /**
   * Trust level assigned to agents that have no explicit entry in the
   * registry.  Defaults to L0_OBSERVER.
   */
  defaultLevel: z.nativeEnum(TrustLevel).default(TrustLevel.L0_OBSERVER),
  /** Optional decay policy applied to all trust assignments. */
  decay: TrustDecayConfigSchema.optional(),
  /**
   * Optional table of action-level trust requirements.
   * GovernanceEngine uses this table when no per-call `requiredTrustLevel`
   * is specified.
   */
  requirements: z.array(TrustRequirementSchema).optional(),
});

export type TrustConfig = z.infer<typeof TrustConfigSchema>;

// ---------------------------------------------------------------------------
// Budget config
// ---------------------------------------------------------------------------

/**
 * Zod schema for a single pre-configured spending envelope.
 * Envelopes declared here are created automatically by BudgetManager on
 * construction.
 */
const EnvelopePresetSchema = z.object({
  category: z.string().min(1),
  limit: z.number().positive(),
  period: z.enum(['hourly', 'daily', 'weekly', 'monthly', 'total']),
});

/**
 * Zod schema for BudgetConfig.
 */
export const BudgetConfigSchema = z.object({
  /**
   * Pre-seeded spending envelopes.  Additional envelopes can be created at
   * runtime via BudgetManager.createBudget().
   */
  envelopes: z.array(EnvelopePresetSchema).optional(),
  /**
   * Optional aggregate daily cap in USD applied across all categories.
   * When set, no single recordSpending() call may push total daily spend
   * above this value regardless of individual envelope limits.
   */
  dailyLimitUsd: z.number().positive().optional(),
});

export type BudgetConfig = z.infer<typeof BudgetConfigSchema>;

// ---------------------------------------------------------------------------
// Consent config
// ---------------------------------------------------------------------------

/**
 * Zod schema for ConsentConfig.
 */
export const ConsentConfigSchema = z.object({
  /**
   * When true (default: false), every action with a `dataType` field must
   * have a matching active consent record or the request is denied.
   */
  requireConsent: z.boolean().default(false),
  /**
   * Purposes that are automatically accepted without an explicit consent
   * record.  Useful for system-internal purposes like "audit" or "monitoring".
   */
  defaultPurposes: z.array(z.string()).optional(),
});

export type ConsentConfig = z.infer<typeof ConsentConfigSchema>;

// ---------------------------------------------------------------------------
// Audit config
// ---------------------------------------------------------------------------

/**
 * Zod schema for AuditConfig.
 */
export const AuditConfigSchema = z.object({
  /** Whether audit logging is active.  Defaults to true. */
  enabled: z.boolean().default(true),
  /**
   * Maximum number of in-memory audit records before oldest entries are
   * evicted.  Defaults to 10 000.
   */
  maxRecords: z.number().int().positive().default(10_000),
});

export type AuditConfig = z.infer<typeof AuditConfigSchema>;

// ---------------------------------------------------------------------------
// Root governance config
// ---------------------------------------------------------------------------

/**
 * Zod schema for the top-level GovernanceConfig passed to GovernanceEngine.
 */
export const GovernanceConfigSchema = z.object({
  trust: TrustConfigSchema.optional(),
  budget: BudgetConfigSchema.optional(),
  consent: ConsentConfigSchema.optional(),
  audit: AuditConfigSchema.optional(),
});

export type GovernanceConfig = z.infer<typeof GovernanceConfigSchema>;

// ---------------------------------------------------------------------------
// Parsing helper
// ---------------------------------------------------------------------------

/**
 * Parse and validate a raw config object, throwing InvalidConfigError on
 * failure.  Used internally by GovernanceEngine and each sub-manager.
 */
export function parseGovernanceConfig(raw: unknown): GovernanceConfig {
  const result = GovernanceConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new InvalidConfigError(messages);
  }
  return result.data;
}

/**
 * Parse and validate a TrustConfig, throwing InvalidConfigError on failure.
 */
export function parseTrustConfig(raw: unknown): TrustConfig {
  const result = TrustConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new InvalidConfigError(messages);
  }
  return result.data;
}

/**
 * Parse and validate a BudgetConfig, throwing InvalidConfigError on failure.
 */
export function parseBudgetConfig(raw: unknown): BudgetConfig {
  const result = BudgetConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new InvalidConfigError(messages);
  }
  return result.data;
}

/**
 * Parse and validate a ConsentConfig, throwing InvalidConfigError on failure.
 */
export function parseConsentConfig(raw: unknown): ConsentConfig {
  const result = ConsentConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new InvalidConfigError(messages);
  }
  return result.data;
}

/**
 * Parse and validate an AuditConfig, throwing InvalidConfigError on failure.
 */
export function parseAuditConfig(raw: unknown): AuditConfig {
  const result = AuditConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new InvalidConfigError(messages);
  }
  return result.data;
}
