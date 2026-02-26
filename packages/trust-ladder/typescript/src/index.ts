// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/trust-ladder
 *
 * 6-level graduated autonomy for AI agents with formal trust decay.
 *
 * Key invariants enforced by this package:
 * - Trust changes are MANUAL ONLY — no automatic promotion or behavioural scoring.
 * - Decay is strictly one-directional — effective levels only decrease over time.
 * - Each (agentId, scope) pair holds a single integer trust level [0, 5].
 * - Scopes are independent — no inference across scope boundaries.
 *
 * @module @aumos/trust-ladder
 */

// Core ladder class
export { TrustLadder } from "./ladder.js";

// Level constants and helpers
export {
  TRUST_LEVELS,
  TRUST_LEVEL_NAMES,
  TRUST_LEVEL_DESCRIPTIONS,
  TRUST_LEVEL_MIN,
  TRUST_LEVEL_MAX,
  TRUST_LEVEL_COUNT,
  isValidTrustLevel,
  trustLevelName,
  trustLevelDescription,
  clampTrustLevel,
} from "./levels.js";
export type { TrustLevelValue } from "./levels.js";

// Configuration
export { TrustLadderConfigSchema, DecayConfigSchema, resolveConfig } from "./config.js";
export type { TrustLadderConfig, DecayConfig, ResolvedTrustLadderConfig } from "./config.js";

// Types
export type {
  TrustAssignment,
  TrustChangeRecord,
  TrustChangeKind,
  TrustCheckResult,
  AssignOptions,
  ScopeKey,
} from "./types.js";
export { buildScopeKey } from "./types.js";

// Assignment store and helpers
export { AssignmentStore, validateAgentId, validateLevel, coerceRequiredLevel } from "./assignment.js";

// Decay engine and helpers
export { DecayEngine, computeEffectiveLevel, timeUntilNextDecay } from "./decay.js";
export type { DecayResult } from "./decay.js";

// Scope query helpers
export {
  assignmentsForAgent,
  assignmentsForScope,
  distinctScopes,
  distinctAgentIds,
  maxLevelPerScope,
  historyInWindow,
  historyByKind,
} from "./scope.js";
