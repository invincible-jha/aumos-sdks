// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * Policy-as-code module for @aumos/governance.
 *
 * Re-exports all public types, schemas, and classes from the policy sub-system.
 */

export {
  // Zod schemas
  GovernancePolicySchema,
  PolicyMetadataSchema,
  PolicyMatchSchema,
  PolicyActionSchema,
  PolicyRuleSchema,
  PolicyDefaultsSchema,
  PolicySpecSchema,
} from './policy-schema.js';
export type {
  // TypeScript types
  GovernancePolicy,
  PolicyMetadata,
  PolicyMatch,
  PolicyAction,
  PolicyRule,
  PolicyDefaults,
  PolicySpec,
  ValidationResult,
} from './policy-schema.js';

export {
  loadPolicy,
  loadPolicyAsync,
  loadPolicySync,
  loadPolicyFromString,
  validatePolicy,
  PolicyParseError,
} from './policy-loader.js';

export { PolicyEngine } from './policy-engine.js';
export type {
  GovernanceRequest,
  PolicyDecision,
} from './policy-engine.js';

export { PolicyWatcher } from './policy-watcher.js';
export type {
  PolicyChangeCallback,
  PolicyErrorCallback,
} from './policy-watcher.js';
