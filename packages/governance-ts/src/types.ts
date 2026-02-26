// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * Local type definitions for @aumos/governance.
 *
 * These mirror the canonical types in @aumos/types (aumos-core) so that
 * this SDK can be used as a standalone package without requiring the full
 * aumos-core workspace.  When used inside the aumos monorepo, consumers
 * may cast between these types and @aumos/types because they share the
 * same structural shape.
 */

// ---------------------------------------------------------------------------
// Primitive branded aliases
// ---------------------------------------------------------------------------

/** ISO 8601 timestamp string, e.g. "2026-01-01T00:00:00.000Z". */
export type Timestamp = string;

/** Stable identifier for an AI agent instance. */
export type AgentId = string;

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

/**
 * Six-level graduated trust hierarchy for AI agent authorisation.
 * Each numeric value strictly supersedes the one below it.
 */
export enum TrustLevel {
  /** Read-only observer. No side-effecting actions permitted. */
  L0_OBSERVER = 0,
  /** Active monitoring with alerting capability. No mutations. */
  L1_MONITOR = 1,
  /** Proposals and suggestions only; all outputs require human review. */
  L2_SUGGEST = 2,
  /** Can act but every action requires explicit human approval. */
  L3_ACT_APPROVE = 3,
  /** Can act autonomously; all actions must be reported post-hoc. */
  L4_ACT_REPORT = 4,
  /** Fully autonomous within defined scope. */
  L5_AUTONOMOUS = 5,
}

/** Display names for each TrustLevel value, suitable for logging and UI. */
export const TRUST_LEVEL_NAMES: Record<TrustLevel, string> = {
  [TrustLevel.L0_OBSERVER]: 'Observer',
  [TrustLevel.L1_MONITOR]: 'Monitor',
  [TrustLevel.L2_SUGGEST]: 'Suggest',
  [TrustLevel.L3_ACT_APPROVE]: 'Act-with-Approval',
  [TrustLevel.L4_ACT_REPORT]: 'Act-and-Report',
  [TrustLevel.L5_AUTONOMOUS]: 'Autonomous',
};

/**
 * Immutable record of a trust level being assigned to an agent.
 * Every call to TrustManager.setLevel() produces one of these.
 */
export interface TrustAssignment {
  readonly agentId: AgentId;
  readonly level: TrustLevel;
  readonly assignedAt: Timestamp;
  readonly assignedBy: 'owner' | 'system' | 'policy';
  readonly reason?: string;
  readonly previousLevel?: TrustLevel;
  /** Optional scope label narrowing the domain of this assignment. */
  readonly scope?: string;
  /** ISO 8601 datetime after which this assignment is no longer valid. */
  readonly expiresAt?: Timestamp;
}

/** Result returned by TrustManager.checkLevel(). */
export interface TrustCheckResult {
  readonly permitted: boolean;
  readonly currentLevel: TrustLevel;
  readonly requiredLevel: TrustLevel;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/** Period over which a spending envelope's limit resets. */
export type BudgetPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'total';

/**
 * A bounded spending allocation for a cost category.
 * Managed by BudgetManager and stored in memory.
 */
export interface SpendingEnvelope {
  readonly id: string;
  readonly category: string;
  readonly limit: number;
  readonly period: BudgetPeriod;
  /** Cumulative amount spent in the current period. */
  spent: number;
  /** Amount committed but not yet settled (reserved). */
  committed: number;
  /** When the current period resets (absent for "total" period). */
  resetAt?: Timestamp;
  readonly createdAt: Timestamp;
}

/** Result returned by BudgetManager.checkBudget(). */
export interface BudgetCheckResult {
  readonly permitted: boolean;
  readonly available: number;
  readonly requested: number;
  readonly limit: number;
  readonly spent: number;
  readonly reason?: string;
}

/** Read-only utilisation snapshot for a spending envelope. */
export interface BudgetUtilization {
  readonly category: string;
  readonly limit: number;
  readonly spent: number;
  readonly committed: number;
  readonly available: number;
  readonly utilizationPercent: number;
  readonly period: BudgetPeriod;
  readonly resetAt?: Timestamp;
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/** A single recorded consent grant. */
export interface ConsentRecord {
  readonly id: string;
  readonly agentId: AgentId;
  readonly dataType: string;
  readonly purpose: string;
  readonly grantedBy: string;
  readonly grantedAt: Timestamp;
  /** When consent expires; absent means indefinite. */
  readonly expiresAt?: Timestamp;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Action categories
// ---------------------------------------------------------------------------

/**
 * Categorises agent actions for governance policy matching.
 * Determines which trust tiers are applicable per action class.
 */
export type ActionCategory =
  | 'communication'
  | 'financial'
  | 'data_access'
  | 'system'
  | 'external_api'
  | 'content_creation';

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

/** An action submitted to GovernanceEngine.evaluate(). */
export interface GovernanceAction {
  /** The agent requesting the action. */
  readonly agentId: AgentId;
  /** Unique action identifier or human-readable name (e.g., "send_email"). */
  readonly action: string;
  /** Broad category used for trust and budget routing. */
  readonly category: ActionCategory;
  /** Minimum trust level required to perform this action. */
  readonly requiredTrustLevel: TrustLevel;
  /** Optional cost amount if the action has an economic dimension. */
  readonly cost?: number;
  /** Optional data type for consent gating (e.g., "pii", "medical"). */
  readonly dataType?: string;
  /** Optional purpose label for consent matching. */
  readonly purpose?: string;
  /** Optional scope label forwarded to the trust check. */
  readonly scope?: string;
  /** Free-form metadata forwarded to the audit record. */
  readonly metadata?: Record<string, unknown>;
}

/** Unified result of a GovernanceEngine.evaluate() call. */
export interface GovernanceDecision {
  readonly permitted: boolean;
  readonly reason: string;
  /** The protocol or sub-system that produced the final verdict. */
  readonly protocol: string;
  readonly timestamp: Timestamp;
  /** Supplementary details keyed by protocol component. */
  readonly details?: Record<string, unknown>;
}
