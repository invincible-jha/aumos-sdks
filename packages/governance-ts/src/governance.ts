// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { GovernanceAction, GovernanceDecision } from './types.js';
import type { GovernanceConfig } from './config.js';
import { parseGovernanceConfig } from './config.js';
import { TrustManager } from './trust/manager.js';
import { BudgetManager } from './budget/manager.js';
import { ConsentManager } from './consent/manager.js';
import { AuditLogger } from './audit/logger.js';

/**
 * GovernanceEngine composes TrustManager, BudgetManager, ConsentManager,
 * and AuditLogger into a single sequential evaluation pipeline.
 *
 * Evaluation order is fixed and non-configurable:
 *   1. Trust check   — is the agent's level sufficient?
 *   2. Budget check  — is there headroom in the spending envelope?
 *   3. Consent check — does active consent exist for the data type?
 *   4. Audit log     — record the final decision regardless of outcome.
 *
 * Any failed check short-circuits the pipeline and returns a denied decision
 * immediately.  All decisions (permit and deny) are always logged.
 *
 * There is no cross-protocol optimisation, no parallel evaluation, and no
 * conditional skipping of protocol steps.  Sequential evaluation is the
 * only mode this engine supports.
 *
 * Public API:
 *   evaluate()         — evaluate an action and return a GovernanceDecision
 *   readonly trust     — the TrustManager instance
 *   readonly budget    — the BudgetManager instance
 *   readonly consent   — the ConsentManager instance
 *   readonly audit     — the AuditLogger instance
 */
export class GovernanceEngine {
  readonly trust: TrustManager;
  readonly budget: BudgetManager;
  readonly consent: ConsentManager;
  readonly audit: AuditLogger;

  readonly #config: GovernanceConfig;

  constructor(config: unknown = {}) {
    this.#config = parseGovernanceConfig(config);

    this.trust = new TrustManager(this.#config.trust ?? {});
    this.budget = new BudgetManager(this.#config.budget ?? {});
    this.consent = new ConsentManager(this.#config.consent ?? {});
    this.audit = new AuditLogger(this.#config.audit ?? {});
  }

  // ---------------------------------------------------------------------------
  // Core evaluation pipeline
  // ---------------------------------------------------------------------------

  /**
   * Evaluates a governance action against all configured protocols.
   *
   * The pipeline is sequential:
   *   - Step 1: Trust gate.  The agent's effective trust level must meet or
   *     exceed `action.requiredTrustLevel`.
   *   - Step 2: Budget gate.  If `action.cost` is provided, the spending
   *     envelope for `action.category` must have sufficient headroom.
   *   - Step 3: Consent gate.  If `action.dataType` is provided and
   *     consent is required, a matching active consent record must exist.
   *   - Step 4: Record the final decision in the audit log.
   *
   * The method is declared async to allow future implementations to await
   * external policy services without breaking the call-site contract.
   *
   * @param action - The action to evaluate.
   * @returns A GovernanceDecision with `permitted: true` if all checks pass,
   *          or `permitted: false` with a descriptive `reason` on first failure.
   */
  async evaluate(action: GovernanceAction): Promise<GovernanceDecision> {
    // ------------------------------------------------------------------
    // Step 1: Trust check
    // ------------------------------------------------------------------
    const trustResult = this.trust.checkLevel(
      action.agentId,
      action.requiredTrustLevel,
      action.scope,
    );

    if (!trustResult.permitted) {
      const decision: GovernanceDecision = {
        permitted: false,
        reason: trustResult.reason ?? 'Trust level insufficient.',
        protocol: 'ATP',
        timestamp: new Date().toISOString(),
        details: {
          currentLevel: trustResult.currentLevel,
          requiredLevel: trustResult.requiredLevel,
        },
      };
      this.#logDecision(decision, action);
      return decision;
    }

    // ------------------------------------------------------------------
    // Step 2: Budget check (only when the action carries a cost)
    // ------------------------------------------------------------------
    if (action.cost !== undefined && action.cost > 0) {
      const budgetResult = this.budget.checkBudget(action.category, action.cost);

      if (!budgetResult.permitted) {
        const decision: GovernanceDecision = {
          permitted: false,
          reason: budgetResult.reason ?? 'Budget limit exceeded.',
          protocol: 'AEAP',
          timestamp: new Date().toISOString(),
          details: {
            category: action.category,
            requested: budgetResult.requested,
            available: budgetResult.available,
            limit: budgetResult.limit,
            spent: budgetResult.spent,
          },
        };
        this.#logDecision(decision, action);
        return decision;
      }
    }

    // ------------------------------------------------------------------
    // Step 3: Consent check (only when the action references a data type)
    // ------------------------------------------------------------------
    if (action.dataType !== undefined) {
      const consentResult = this.consent.checkConsent(
        action.agentId,
        action.dataType,
        action.purpose,
      );

      if (!consentResult.permitted) {
        const decision: GovernanceDecision = {
          permitted: false,
          reason: consentResult.reason ?? 'Consent not granted.',
          protocol: 'ASP',
          timestamp: new Date().toISOString(),
          details: {
            dataType: action.dataType,
            purpose: action.purpose,
          },
        };
        this.#logDecision(decision, action);
        return decision;
      }
    }

    // ------------------------------------------------------------------
    // Step 4: All checks passed — permit
    // ------------------------------------------------------------------
    const decision: GovernanceDecision = {
      permitted: true,
      reason: 'All governance checks passed.',
      protocol: 'AUMOS-GOVERNANCE',
      timestamp: new Date().toISOString(),
      details: {
        trustLevel: trustResult.currentLevel,
        category: action.category,
        ...(action.cost !== undefined && { cost: action.cost }),
        ...(action.dataType !== undefined && { dataType: action.dataType }),
      },
    };

    this.#logDecision(decision, action);
    return decision;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Logs a governance decision to the audit trail.
   * Called after every evaluation regardless of outcome.
   */
  #logDecision(decision: GovernanceDecision, action: GovernanceAction): void {
    this.audit.log(decision, {
      agentId: action.agentId,
      action: action.action,
      category: action.category,
      ...(action.metadata ?? {}),
    });
  }
}
