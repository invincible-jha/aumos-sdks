// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Agent Memory Governance (AMGP) — barrel exports
 *
 * Re-exports all public types, classes, and functions from the memory
 * governance submodule.
 *
 * Usage:
 * ```ts
 * import {
 *   MemoryGovernor,
 *   RetentionPolicyEngine,
 *   computeExpiresAt,
 *   parseDurationMs,
 * } from '@aumos/governance/memory';
 * ```
 *
 * Or via the root package:
 * ```ts
 * import { MemoryGovernor } from '@aumos/governance';
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type {
  MemoryCategory,
  MemoryAccessRequest,
  MemoryGovernanceDecision,
  RetentionPolicy,
  GovernedMemoryRecord,
  MemoryAccessLogEntry,
  MemoryGovernorConfig,
  ForgetRequest,
  ForgetResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Governor
// ---------------------------------------------------------------------------
export { MemoryGovernor } from './governor.js';
export type { CreateMemorySlotParams } from './governor.js';

// ---------------------------------------------------------------------------
// Retention engine
// ---------------------------------------------------------------------------
export { RetentionPolicyEngine, parseDurationMs, computeExpiresAt } from './retention.js';
