// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/security-bundle — the complete AI agent security stack.
 *
 * One install gives you trust gating, budget enforcement, and audit logging.
 * All components enforce static, operator-configured policies only.
 * Trust levels are set manually. Budget limits are fixed at creation time.
 * Audit logs are write-only records — no analysis or anomaly detection.
 */

// Re-export trust gate
export { TrustGate } from '@aumos/mcp-trust-gate';
export type { TrustGateConfig } from '@aumos/mcp-trust-gate';

// Re-export budget enforcer
export { BudgetEnforcer } from '@aumos/budget-enforcer';
export type { BudgetEnforcerConfig, SpendingEnvelope } from '@aumos/budget-enforcer';

// Re-export audit trail
export { AuditLogger, HashChain } from '@aumos/audit-trail';
export type { AuditRecord, AuditQuery } from '@aumos/audit-trail';

// Re-export shared types
export type { GovernanceDecision, TrustLevel } from '@aumos/types';

// ─── Security Stack ───────────────────────────────────────────────────────────

import { TrustGate } from '@aumos/mcp-trust-gate';
import type { TrustGateConfig } from '@aumos/mcp-trust-gate';
import { BudgetEnforcer } from '@aumos/budget-enforcer';
import type { BudgetEnforcerConfig } from '@aumos/budget-enforcer';
import { AuditLogger } from '@aumos/audit-trail';
import type { AuditQuery } from '@aumos/audit-trail';

/**
 * Configuration for the full security stack.
 * All limits are static — set by the operator at creation time and never
 * adjusted automatically.
 */
export interface SecurityStackConfig {
  /** Trust gate configuration. Trust levels are set manually by operators. */
  readonly trustGate: TrustGateConfig;
  /** Budget enforcer configuration. All spending limits are fixed at creation. */
  readonly budget: BudgetEnforcerConfig;
  /**
   * Optional namespace for the audit logger.
   * Defaults to "aumos.security-bundle".
   */
  readonly auditNamespace?: string;
}

/**
 * The assembled security stack.
 * Exposes each component directly so callers can use the full API of each.
 */
export interface SecurityStack {
  readonly trustGate: TrustGate;
  readonly budget: BudgetEnforcer;
  readonly audit: AuditLogger;
}

/**
 * Create a fully-configured security stack in a single call.
 *
 * Each component is independent — they share no state and make no cross-calls.
 * Callers wire the components together in their own governance layer.
 *
 * @example
 * ```typescript
 * const stack = createSecurityStack({
 *   trustGate: { requiredLevel: 'verified', toolName: 'file-reader' },
 *   budget: { tokenLimit: 10_000, callLimit: 100 },
 * });
 *
 * // Use each component through its own typed API
 * const decision = stack.trustGate.check(request);
 * const allowed  = stack.budget.checkBudget(sessionId);
 * stack.audit.log({ event: 'tool-call', sessionId });
 * ```
 */
export function createSecurityStack(config: SecurityStackConfig): SecurityStack {
  const trustGate = new TrustGate(config.trustGate);
  const budget = new BudgetEnforcer(config.budget);
  const audit = new AuditLogger({
    namespace: config.auditNamespace ?? 'aumos.security-bundle',
  });

  return { trustGate, budget, audit } as const;
}
