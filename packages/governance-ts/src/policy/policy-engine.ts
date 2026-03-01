// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * PolicyEngine — evaluate governance policies against incoming requests.
 *
 * Evaluation semantics:
 *   - Rules are evaluated in declaration order (first-match-wins).
 *   - If no rule matches, the policy's `spec.defaults` applies.
 *   - Multiple policies are tried in the order they are supplied; the first
 *     matching rule across all policies wins.
 *
 * The engine is stateless and safe to use from multiple call sites. Callers
 * are responsible for reloading policies when files change (see PolicyWatcher).
 */

import type {
  GovernancePolicy,
  PolicyAction,
  PolicyDefaults,
  PolicyMatch,
  PolicyRule,
} from './policy-schema.js';

// ---------------------------------------------------------------------------
// Request / Decision types
// ---------------------------------------------------------------------------

/**
 * A governance request submitted to PolicyEngine.evaluate().
 *
 * All fields are optional; the engine only evaluates the match criteria that
 * are present in a given policy rule.
 */
export interface GovernanceRequest {
  /** The agent submitting the request. */
  readonly agentId: string;
  /** The action being performed (e.g. "read", "write", "delete"). */
  readonly action: string;
  /** The resource being acted upon (e.g. "reports/q1", "pii/user-42"). */
  readonly resource?: string;
  /**
   * The agent's current trust level in [0, 5].
   * Callers should resolve this from TrustManager before calling evaluate().
   */
  readonly trustLevel?: number;
  /** Free-form metadata for logging or custom match extensions. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The result of PolicyEngine.evaluate().
 */
export interface PolicyDecision {
  /** The resolved decision: allow, deny, or review. */
  readonly decision: 'allow' | 'deny' | 'review';
  /** Whether the request is permitted (true when decision is "allow"). */
  readonly permitted: boolean;
  /** The matched rule name, or "defaults" when no rule matched. */
  readonly matchedRule: string;
  /** The policy name that produced this decision, or null for defaults. */
  readonly matchedPolicy: string | null;
  /** Budget limit from the matched rule or undefined if not specified. */
  readonly budgetLimit?: number;
  /** Whether explicit consent is required. */
  readonly requireConsent: boolean;
  /** Audit level for this decision. */
  readonly auditLevel: 'minimal' | 'standard' | 'detailed';
  /** Human-readable reason from the matched rule action. */
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Glob matching — minimal implementation (no external dependency)
// ---------------------------------------------------------------------------

/**
 * Tests whether `value` matches a glob pattern.
 * Supports only the `*` wildcard (matches any sequence of non-separator chars).
 */
function globMatch(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === value;

  // Escape regex special chars except * then replace * with .*
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${regexStr}$`).test(value);
}

function matchesPatternList(
  patterns: string[] | undefined,
  value: string | undefined,
): boolean {
  if (patterns === undefined || patterns.length === 0) return true;
  if (value === undefined) return false;
  return patterns.some((p) => globMatch(p, value));
}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

function matchesRule(match: PolicyMatch, request: GovernanceRequest): boolean {
  if (!matchesPatternList(match.agents, request.agentId)) return false;
  if (!matchesPatternList(match.actions, request.action)) return false;
  if (!matchesPatternList(match.resources, request.resource)) return false;

  if (match.trustLevelMin !== undefined) {
    if (request.trustLevel === undefined) return false;
    if (request.trustLevel < match.trustLevelMin) return false;
  }

  if (match.trustLevelMax !== undefined) {
    if (request.trustLevel === undefined) return false;
    if (request.trustLevel > match.trustLevelMax) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Decision builder
// ---------------------------------------------------------------------------

function buildDecisionFromAction(
  action: PolicyAction,
  ruleName: string,
  policyName: string,
  defaults: PolicyDefaults,
): PolicyDecision {
  return {
    decision: action.decision,
    permitted: action.decision === 'allow',
    matchedRule: ruleName,
    matchedPolicy: policyName,
    budgetLimit: action.budgetLimit,
    requireConsent: action.requireConsent ?? false,
    auditLevel: action.auditLevel ?? defaults.auditLevel,
    reason: action.reason,
  };
}

function buildDecisionFromDefaults(
  defaults: PolicyDefaults,
  policyName: string,
): PolicyDecision {
  return {
    decision: defaults.decision,
    permitted: defaults.decision === 'allow',
    matchedRule: 'defaults',
    matchedPolicy: policyName,
    requireConsent: false,
    auditLevel: defaults.auditLevel,
  };
}

// ---------------------------------------------------------------------------
// PolicyEngine
// ---------------------------------------------------------------------------

/**
 * Stateless policy evaluation engine.
 *
 * Usage:
 * ```typescript
 * const engine = new PolicyEngine();
 * const decision = engine.evaluate(request, [myPolicy]);
 * if (!decision.permitted) {
 *   throw new Error(`Denied: ${decision.reason ?? decision.decision}`);
 * }
 * ```
 */
export class PolicyEngine {
  /**
   * Evaluate a governance request against an ordered list of policies.
   *
   * Evaluation proceeds as follows:
   * 1. For each policy (in order), iterate its rules (in declaration order).
   * 2. The first rule whose `match` block matches the request wins.
   * 3. If no rule matches in any policy, the first policy's `defaults` applies.
   * 4. If `policies` is empty, a hard "deny" with rule "no-policies" is returned.
   *
   * @param request - The governance request to evaluate.
   * @param policies - Ordered list of policies to evaluate against.
   * @returns A PolicyDecision describing the outcome.
   */
  evaluate(
    request: GovernanceRequest,
    policies: ReadonlyArray<GovernancePolicy>,
  ): PolicyDecision {
    if (policies.length === 0) {
      return {
        decision: 'deny',
        permitted: false,
        matchedRule: 'no-policies',
        matchedPolicy: null,
        requireConsent: false,
        auditLevel: 'standard',
        reason: 'No governance policies are loaded.',
      };
    }

    for (const policy of policies) {
      const matched = this.#evaluatePolicy(request, policy);
      if (matched !== null) return matched;
    }

    // No rule matched across any policy — apply first policy's defaults.
    const firstPolicy = policies[0];
    return buildDecisionFromDefaults(
      firstPolicy.spec.defaults,
      firstPolicy.metadata.name,
    );
  }

  /**
   * Evaluate a single policy and return the first matching decision, or null
   * if no rule matches (caller should fall through to the next policy).
   */
  #evaluatePolicy(
    request: GovernanceRequest,
    policy: GovernancePolicy,
  ): PolicyDecision | null {
    for (const rule of policy.spec.rules) {
      if (matchesRule(rule.match, request)) {
        return buildDecisionFromAction(
          rule.action,
          rule.name,
          policy.metadata.name,
          policy.spec.defaults,
        );
      }
    }
    return null;
  }

  /**
   * Return all rules from all policies that match a given request, in
   * evaluation order. Useful for debugging and policy authoring tools.
   */
  findMatchingRules(
    request: GovernanceRequest,
    policies: ReadonlyArray<GovernancePolicy>,
  ): ReadonlyArray<{ policyName: string; rule: PolicyRule }> {
    const matches: Array<{ policyName: string; rule: PolicyRule }> = [];
    for (const policy of policies) {
      for (const rule of policy.spec.rules) {
        if (matchesRule(rule.match, request)) {
          matches.push({ policyName: policy.metadata.name, rule });
        }
      }
    }
    return matches;
  }
}
