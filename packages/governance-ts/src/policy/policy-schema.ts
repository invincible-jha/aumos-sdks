// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * TypeScript types for declarative governance policy files.
 *
 * Policies are authored in YAML or JSON and evaluated by PolicyEngine at
 * runtime. The schema intentionally mirrors Kubernetes-style manifests so that
 * governance authors have a familiar mental model.
 *
 * Validation at runtime is performed by the Zod schemas exported below.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas (runtime validation)
// ---------------------------------------------------------------------------

export const PolicyMetadataSchema = z.object({
  name: z.string().min(1, 'Policy name must not be empty'),
  namespace: z.string().optional(),
  labels: z.record(z.string()).optional(),
  annotations: z.record(z.string()).optional(),
});

export const PolicyMatchSchema = z.object({
  /** Agent ID patterns (glob-style, e.g. "finance-*"). */
  agents: z.array(z.string()).optional(),
  /** Action type patterns (e.g. "read", "write"). */
  actions: z.array(z.string()).optional(),
  /** Resource patterns (e.g. "pii/*", "reports/*"). */
  resources: z.array(z.string()).optional(),
  /**
   * Minimum trust level (0–5 inclusive) required to enter this rule.
   * The engine reads this from the TrustManager at evaluation time.
   */
  trustLevelMin: z.number().min(0).max(5).optional(),
  /**
   * Maximum trust level (0–5 inclusive) — used for lower-bound rules.
   */
  trustLevelMax: z.number().min(0).max(5).optional(),
});

export const PolicyActionSchema = z.object({
  decision: z.enum(['allow', 'deny', 'review']),
  /** Per-action budget cap in the engine's configured cost unit. */
  budgetLimit: z.number().nonnegative().optional(),
  /** When true, the action requires an active consent record. */
  requireConsent: z.boolean().optional(),
  auditLevel: z.enum(['minimal', 'standard', 'detailed']).optional(),
  /** Human-readable reason included in the governance decision. */
  reason: z.string().optional(),
});

export const PolicyRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  match: PolicyMatchSchema,
  action: PolicyActionSchema,
});

export const PolicyDefaultsSchema = z.object({
  decision: z.enum(['allow', 'deny']),
  /**
   * Minimum trust level an agent must hold to pass the default gate.
   * Expressed as a number in [0, 5] matching the TrustLevel enum.
   */
  trustLevelRequired: z.number().min(0).max(5),
  /** Default per-agent budget in the engine's configured cost unit. */
  budgetPerAgent: z.number().nonnegative(),
  auditLevel: z.enum(['minimal', 'standard', 'detailed']),
});

export const PolicySpecSchema = z.object({
  rules: z.array(PolicyRuleSchema),
  defaults: PolicyDefaultsSchema,
});

export const GovernancePolicySchema = z.object({
  apiVersion: z.string().regex(
    /^aumos\.ai\//,
    'apiVersion must start with "aumos.ai/"',
  ),
  kind: z.literal('GovernancePolicy'),
  metadata: PolicyMetadataSchema,
  spec: PolicySpecSchema,
});

// ---------------------------------------------------------------------------
// TypeScript types (derived from Zod schemas)
// ---------------------------------------------------------------------------

export type PolicyMetadata = z.infer<typeof PolicyMetadataSchema>;
export type PolicyMatch = z.infer<typeof PolicyMatchSchema>;
export type PolicyAction = z.infer<typeof PolicyActionSchema>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type PolicyDefaults = z.infer<typeof PolicyDefaultsSchema>;
export type PolicySpec = z.infer<typeof PolicySpecSchema>;

/**
 * A declarative governance policy document.
 *
 * @example
 * ```yaml
 * apiVersion: aumos.ai/v1alpha1
 * kind: GovernancePolicy
 * metadata:
 *   name: default-governance
 * spec:
 *   defaults:
 *     decision: deny
 *     trustLevelRequired: 0.5
 *     budgetPerAgent: 1000
 *     auditLevel: standard
 *   rules: []
 * ```
 */
export type GovernancePolicy = z.infer<typeof GovernancePolicySchema>;

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<string>;
}
