// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from '../src/governance.js';
import { TrustLevel } from '../src/types.js';
import type { GovernanceAction } from '../src/types.js';

function makeAction(overrides: Partial<GovernanceAction> = {}): GovernanceAction {
  return {
    agentId: 'agent-001',
    action: 'read-data',
    requiredTrustLevel: TrustLevel.L1_MONITOR,
    category: 'api',
    ...overrides,
  };
}

describe('GovernanceEngine', () => {
  describe('evaluate — trust gate', () => {
    it('denies when agent has no trust assignment and required level > L0', async () => {
      const engine = new GovernanceEngine();
      const decision = await engine.evaluate(makeAction({ requiredTrustLevel: TrustLevel.L3_ACT_APPROVE }));
      expect(decision.permitted).toBe(false);
      expect(decision.protocol).toBe('ATP');
      expect(decision.reason).toBeTruthy();
    });

    it('permits when agent has a sufficient trust assignment', async () => {
      const engine = new GovernanceEngine();
      engine.trust.setLevel('agent-001', TrustLevel.L3_ACT_APPROVE);
      const decision = await engine.evaluate(makeAction({ requiredTrustLevel: TrustLevel.L2_SUGGEST }));
      expect(decision.permitted).toBe(true);
    });

    it('permits when required level is L0_OBSERVER for any agent', async () => {
      const engine = new GovernanceEngine();
      const decision = await engine.evaluate(makeAction({ requiredTrustLevel: TrustLevel.L0_OBSERVER }));
      expect(decision.permitted).toBe(true);
    });
  });

  describe('evaluate — budget gate', () => {
    it('denies when budget is exceeded (trust check passes)', async () => {
      const engine = new GovernanceEngine();
      engine.trust.setLevel('agent-001', TrustLevel.L3_ACT_APPROVE);
      engine.budget.createBudget('api', 10, 'daily');
      engine.budget.recordSpending('api', 9);

      const decision = await engine.evaluate(
        makeAction({ requiredTrustLevel: TrustLevel.L0_OBSERVER, cost: 5, category: 'api' }),
      );
      expect(decision.permitted).toBe(false);
      expect(decision.protocol).toBe('AEAP');
    });

    it('permits when cost fits within the budget envelope', async () => {
      const engine = new GovernanceEngine();
      engine.trust.setLevel('agent-001', TrustLevel.L2_SUGGEST);
      engine.budget.createBudget('api', 100, 'daily');

      const decision = await engine.evaluate(
        makeAction({ requiredTrustLevel: TrustLevel.L0_OBSERVER, cost: 20, category: 'api' }),
      );
      expect(decision.permitted).toBe(true);
    });

    it('skips budget check when action has no cost', async () => {
      const engine = new GovernanceEngine();
      engine.trust.setLevel('agent-001', TrustLevel.L2_SUGGEST);
      engine.budget.createBudget('api', 0.001, 'daily');

      // No cost — budget gate is bypassed
      const decision = await engine.evaluate(
        makeAction({ requiredTrustLevel: TrustLevel.L0_OBSERVER, category: 'api' }),
      );
      expect(decision.permitted).toBe(true);
    });
  });

  describe('evaluate — consent gate', () => {
    it('denies when requireConsent is true and no consent exists for the data type', async () => {
      const engine = new GovernanceEngine({ consent: { requireConsent: true } });
      engine.trust.setLevel('agent-001', TrustLevel.L3_ACT_APPROVE);

      const decision = await engine.evaluate(
        makeAction({ requiredTrustLevel: TrustLevel.L0_OBSERVER, dataType: 'pii' }),
      );
      expect(decision.permitted).toBe(false);
      expect(decision.protocol).toBe('ASP');
    });

    it('permits when valid consent is on record', async () => {
      const engine = new GovernanceEngine({ consent: { requireConsent: true } });
      engine.trust.setLevel('agent-001', TrustLevel.L3_ACT_APPROVE);
      engine.consent.recordConsent('agent-001', 'pii', 'analytics', 'admin');

      const decision = await engine.evaluate(
        makeAction({
          requiredTrustLevel: TrustLevel.L0_OBSERVER,
          dataType: 'pii',
          purpose: 'analytics',
        }),
      );
      expect(decision.permitted).toBe(true);
    });

    it('skips consent check when no dataType is provided', async () => {
      const engine = new GovernanceEngine({ consent: { requireConsent: true } });
      engine.trust.setLevel('agent-001', TrustLevel.L3_ACT_APPROVE);

      const decision = await engine.evaluate(
        makeAction({ requiredTrustLevel: TrustLevel.L0_OBSERVER }),
      );
      expect(decision.permitted).toBe(true);
    });
  });

  describe('evaluate — audit logging', () => {
    it('records a permit decision in the audit log', async () => {
      const engine = new GovernanceEngine();
      await engine.evaluate(makeAction({ requiredTrustLevel: TrustLevel.L0_OBSERVER }));
      expect(engine.audit.recordCount).toBeGreaterThan(0);
    });

    it('records a deny decision in the audit log', async () => {
      const engine = new GovernanceEngine();
      await engine.evaluate(makeAction({ requiredTrustLevel: TrustLevel.L5_AUTONOMOUS }));
      expect(engine.audit.recordCount).toBeGreaterThan(0);
      const records = engine.audit.getRecords();
      expect(records[records.length - 1]!.outcome).toBe('deny');
    });
  });

  describe('evaluate — sequential pipeline order', () => {
    it('short-circuits at trust gate without checking budget', async () => {
      const engine = new GovernanceEngine();
      // No trust assignment means L0; we require L4
      engine.budget.createBudget('api', 100, 'daily');

      const decision = await engine.evaluate(
        makeAction({ requiredTrustLevel: TrustLevel.L4_ACT_REPORT, cost: 1, category: 'api' }),
      );
      // Should fail at ATP not AEAP
      expect(decision.protocol).toBe('ATP');
      expect(decision.permitted).toBe(false);
    });
  });

  describe('engine public API properties', () => {
    it('exposes trust, budget, consent, and audit as readonly properties', () => {
      const engine = new GovernanceEngine();
      expect(engine.trust).toBeDefined();
      expect(engine.budget).toBeDefined();
      expect(engine.consent).toBeDefined();
      expect(engine.audit).toBeDefined();
    });
  });
});
