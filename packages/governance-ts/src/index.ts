// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — TypeScript SDK for building governance-aware AI agent applications.
 *
 * Public API surface:
 *
 * Engine
 *   GovernanceEngine   — compose trust, budget, consent, and audit into one pipeline
 *
 * Sub-managers (usable standalone or via GovernanceEngine)
 *   TrustManager       — manage agent trust level assignments
 *   BudgetManager      — manage per-category spending envelopes
 *   ConsentManager     — record and enforce data access consent
 *   AuditLogger        — append-only governance decision log
 *
 * Types
 *   TrustLevel, TrustAssignment, TrustCheckResult
 *   SpendingEnvelope, BudgetCheckResult, BudgetUtilization, BudgetPeriod
 *   ConsentRecord
 *   ActionCategory
 *   GovernanceAction, GovernanceDecision
 *   AuditRecord, AuditFilter, AuditContext
 *
 * Config (Zod schemas + parsed types)
 *   GovernanceConfig, TrustConfig, BudgetConfig, ConsentConfig, AuditConfig
 *   GovernanceConfigSchema, TrustConfigSchema, BudgetConfigSchema,
 *   ConsentConfigSchema, AuditConfigSchema
 *
 * Errors
 *   GovernanceError, TrustDeniedError, BudgetExceededError,
 *   ConsentRequiredError, InvalidConfigError
 */

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
export { GovernanceEngine } from './governance.js';

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------
export { TrustManager } from './trust/manager.js';
export type { SetLevelOptions } from './trust/manager.js';
export { computeEffectiveLevel, isExpired } from './trust/decay.js';
export { validateTrustLevel, assertValidTrustLevel } from './trust/validator.js';

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------
export { BudgetManager } from './budget/manager.js';
export { SpendingTracker, computeNextResetAt } from './budget/tracker.js';
export type { SpendingTransaction } from './budget/tracker.js';
export { isPeriodExpired, resetEnvelope, applyRolloverIfDue } from './budget/policy.js';

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------
export { ConsentManager } from './consent/manager.js';
export type { RecordConsentOptions, ConsentCheckResult } from './consent/manager.js';
export { ConsentStore } from './consent/store.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export { AuditLogger } from './audit/logger.js';
export { createAuditRecord } from './audit/record.js';
export type { AuditRecord, AuditContext } from './audit/record.js';
export { filterRecords } from './audit/query.js';
export type { AuditFilter } from './audit/query.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export {
  TrustLevel,
  TRUST_LEVEL_NAMES,
} from './types.js';
export type {
  Timestamp,
  AgentId,
  TrustAssignment,
  TrustCheckResult,
  BudgetPeriod,
  SpendingEnvelope,
  BudgetCheckResult,
  BudgetUtilization,
  ConsentRecord,
  ActionCategory,
  GovernanceAction,
  GovernanceDecision,
} from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export {
  GovernanceConfigSchema,
  TrustConfigSchema,
  BudgetConfigSchema,
  ConsentConfigSchema,
  AuditConfigSchema,
  parseGovernanceConfig,
  parseTrustConfig,
  parseBudgetConfig,
  parseConsentConfig,
  parseAuditConfig,
} from './config.js';
export type {
  GovernanceConfig,
  TrustConfig,
  BudgetConfig,
  ConsentConfig,
  AuditConfig,
} from './config.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export {
  GovernanceError,
  TrustDeniedError,
  BudgetExceededError,
  ConsentRequiredError,
  InvalidConfigError,
} from './errors.js';
