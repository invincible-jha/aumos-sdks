// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { TrustLevelValue } from "./levels.js";

// ---------------------------------------------------------------------------
// Assignment types
// ---------------------------------------------------------------------------

/**
 * A point-in-time record of a trust assignment made by a human operator.
 * All trust changes are manual — this record is immutable once written.
 */
export interface TrustAssignment {
  /** Unique identifier of the agent being assigned a trust level. */
  readonly agentId: string;

  /**
   * Scope under which this assignment applies.
   * Defaults to the empty string representing the global scope.
   */
  readonly scope: string;

  /**
   * The raw trust level assigned by the operator (before any decay).
   * Integer in the range [0, 5].
   */
  readonly assignedLevel: TrustLevelValue;

  /**
   * Wall-clock timestamp (ms since Unix epoch) when the assignment was made.
   */
  readonly assignedAt: number;

  /**
   * Human-readable reason for the assignment, supplied by the operator.
   * Optional but strongly recommended for audit purposes.
   */
  readonly reason?: string;

  /**
   * Identifier of the human operator who made this assignment.
   * Optional but strongly recommended for audit purposes.
   */
  readonly assignedBy?: string;
}

// ---------------------------------------------------------------------------
// Change history types
// ---------------------------------------------------------------------------

/** A single entry in the immutable history of trust changes for an agent. */
export interface TrustChangeRecord {
  /** Unique identifier of the agent. */
  readonly agentId: string;

  /** Scope under which this change occurred. */
  readonly scope: string;

  /** Trust level before this change (undefined for the first assignment). */
  readonly previousLevel: TrustLevelValue | undefined;

  /** Trust level after this change. */
  readonly newLevel: TrustLevelValue;

  /** Wall-clock timestamp (ms since Unix epoch) of the change. */
  readonly changedAt: number;

  /** Machine-readable reason category for the change. */
  readonly changeKind: TrustChangeKind;

  /** Free-text reason from the operator, or a generated decay message. */
  readonly reason?: string;

  /** Operator identifier (present only for manual assignments). */
  readonly changedBy?: string;
}

/**
 * Machine-readable categories that explain why a trust level changed.
 * - "manual"   — an operator explicitly called assign()
 * - "decay_cliff"   — TTL expired and trust dropped to L0
 * - "decay_step"    — one gradual decay step occurred
 * - "revocation"    — the assignment was revoked entirely
 */
export type TrustChangeKind = "manual" | "decay_cliff" | "decay_step" | "revocation";

// ---------------------------------------------------------------------------
// Check result types
// ---------------------------------------------------------------------------

/**
 * The result of a trust level check for a specific action requirement.
 */
export interface TrustCheckResult {
  /** Whether the agent's effective level satisfies the required level. */
  readonly permitted: boolean;

  /** The agent's effective trust level at the time of the check. */
  readonly effectiveLevel: TrustLevelValue;

  /** The minimum level that was required. */
  readonly requiredLevel: TrustLevelValue;

  /** The scope under which the check was evaluated. */
  readonly scope: string;

  /** Wall-clock timestamp (ms since Unix epoch) when the check was performed. */
  readonly checkedAt: number;
}

// ---------------------------------------------------------------------------
// Assignment options
// ---------------------------------------------------------------------------

/**
 * Optional parameters for a manual trust assignment.
 */
export interface AssignOptions {
  /**
   * Human-readable reason for the assignment.
   * Persisted in history for audit purposes.
   */
  reason?: string;

  /**
   * Identifier of the human operator performing the assignment.
   * Persisted in history for audit purposes.
   */
  assignedBy?: string;
}

// ---------------------------------------------------------------------------
// Scope key helper
// ---------------------------------------------------------------------------

/**
 * Canonical string key used to look up assignments in Maps.
 * Combines agentId and scope separated by a null byte so neither
 * field can accidentally produce a collision.
 */
export type ScopeKey = string;

/** Build a canonical scope key from an agentId and scope string. */
export function buildScopeKey(agentId: string, scope: string): ScopeKey {
  return `${agentId}\0${scope}`;
}
