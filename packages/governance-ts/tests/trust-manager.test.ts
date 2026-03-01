// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { describe, it, expect } from 'vitest';
import { TrustManager } from '../src/trust/manager.js';
import { TrustLevel } from '../src/types.js';

describe('TrustManager', () => {
  describe('setLevel', () => {
    it('assigns a trust level and returns a TrustAssignment record', () => {
      const manager = new TrustManager();
      const assignment = manager.setLevel('agent-001', TrustLevel.L2_SUGGEST);
      expect(assignment.agentId).toBe('agent-001');
      expect(assignment.level).toBe(TrustLevel.L2_SUGGEST);
      expect(assignment.assignedBy).toBe('owner');
    });

    it('records the previous level when overwriting an existing assignment', () => {
      const manager = new TrustManager();
      manager.setLevel('agent-001', TrustLevel.L1_MONITOR);
      const updated = manager.setLevel('agent-001', TrustLevel.L3_ACT_APPROVE);
      expect(updated.previousLevel).toBe(TrustLevel.L1_MONITOR);
    });

    it('accepts a custom assignedBy value', () => {
      const manager = new TrustManager();
      const assignment = manager.setLevel('agent-001', TrustLevel.L2_SUGGEST, undefined, {
        assignedBy: 'policy',
      });
      expect(assignment.assignedBy).toBe('policy');
    });

    it('stores the optional reason on the assignment', () => {
      const manager = new TrustManager();
      const assignment = manager.setLevel('agent-001', TrustLevel.L3_ACT_APPROVE, undefined, {
        reason: 'Granted after manual review',
      });
      expect(assignment.reason).toBe('Granted after manual review');
    });

    it('throws a RangeError for an empty agentId', () => {
      const manager = new TrustManager();
      expect(() => manager.setLevel('', TrustLevel.L2_SUGGEST)).toThrow(RangeError);
    });

    it('supports scope-specific assignments for the same agent', () => {
      const manager = new TrustManager();
      manager.setLevel('agent-001', TrustLevel.L1_MONITOR, 'read-only');
      manager.setLevel('agent-001', TrustLevel.L4_ACT_REPORT, 'write');
      expect(manager.getLevel('agent-001', 'read-only')).toBe(TrustLevel.L1_MONITOR);
      expect(manager.getLevel('agent-001', 'write')).toBe(TrustLevel.L4_ACT_REPORT);
    });
  });

  describe('getLevel', () => {
    it('returns the configured defaultLevel for unknown agents', () => {
      const manager = new TrustManager({ defaultLevel: TrustLevel.L0_OBSERVER });
      expect(manager.getLevel('unknown-agent')).toBe(TrustLevel.L0_OBSERVER);
    });

    it('returns the assigned level for a known agent', () => {
      const manager = new TrustManager();
      manager.setLevel('agent-001', TrustLevel.L4_ACT_REPORT);
      expect(manager.getLevel('agent-001')).toBe(TrustLevel.L4_ACT_REPORT);
    });

    it('returns L0_OBSERVER by default for agents with no assignment', () => {
      const manager = new TrustManager();
      expect(manager.getLevel('fresh-agent')).toBe(TrustLevel.L0_OBSERVER);
    });
  });

  describe('checkLevel', () => {
    it('permits when effective level meets the requirement exactly', () => {
      const manager = new TrustManager();
      manager.setLevel('agent-001', TrustLevel.L3_ACT_APPROVE);
      const result = manager.checkLevel('agent-001', TrustLevel.L3_ACT_APPROVE);
      expect(result.permitted).toBe(true);
    });

    it('permits when effective level exceeds the requirement', () => {
      const manager = new TrustManager();
      manager.setLevel('agent-001', TrustLevel.L5_AUTONOMOUS);
      const result = manager.checkLevel('agent-001', TrustLevel.L2_SUGGEST);
      expect(result.permitted).toBe(true);
    });

    it('denies when effective level is below the requirement', () => {
      const manager = new TrustManager();
      manager.setLevel('agent-001', TrustLevel.L1_MONITOR);
      const result = manager.checkLevel('agent-001', TrustLevel.L4_ACT_REPORT);
      expect(result.permitted).toBe(false);
      expect(typeof result.reason).toBe('string');
    });

    it('includes currentLevel and requiredLevel in the result', () => {
      const manager = new TrustManager();
      manager.setLevel('agent-001', TrustLevel.L2_SUGGEST);
      const result = manager.checkLevel('agent-001', TrustLevel.L3_ACT_APPROVE);
      expect(result.currentLevel).toBe(TrustLevel.L2_SUGGEST);
      expect(result.requiredLevel).toBe(TrustLevel.L3_ACT_APPROVE);
    });
  });

  describe('listAssignments', () => {
    it('returns an empty array when no assignments have been made', () => {
      const manager = new TrustManager();
      expect(manager.listAssignments()).toHaveLength(0);
    });

    it('lists all stored assignments across agents', () => {
      const manager = new TrustManager();
      manager.setLevel('agent-a', TrustLevel.L1_MONITOR);
      manager.setLevel('agent-b', TrustLevel.L3_ACT_APPROVE);
      expect(manager.listAssignments()).toHaveLength(2);
    });
  });
});
