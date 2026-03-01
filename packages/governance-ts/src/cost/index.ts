// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Multi-Model Cost Tracking — barrel exports
 *
 * Re-exports all public types, classes, and functions from the cost
 * tracking submodule.
 *
 * Usage:
 * ```ts
 * import {
 *   CostTracker,
 *   ModelPricingRegistry,
 * } from '@aumos/governance/cost';
 * ```
 *
 * Or via the root package:
 * ```ts
 * import { CostTracker, ModelPricingRegistry } from '@aumos/governance';
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type {
  ModelProvider,
  ModelPricing,
  LLMUsageRecord,
  CostSummary,
  CostBudgetCheckResult,
  CostTrackerConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------
export { CostTracker } from './tracker.js';
export type { RecordRawParams } from './tracker.js';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export { ModelPricingRegistry } from './provider-registry.js';
