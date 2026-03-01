// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { describe, it, expect } from 'vitest';
import { AuditLogger } from '../src/audit/logger.js';
import type { GovernanceDecision } from '../src/types.js';

function makeDecision(overrides: Partial<GovernanceDecision> = {}): GovernanceDecision {
  return {
    permitted: true,
    reason: 'All governance checks passed.',
    protocol: 'AUMOS-GOVERNANCE',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('AuditLogger', () => {
  describe('log', () => {
    it('returns an AuditRecord when logging is enabled', () => {
      const logger = new AuditLogger({ enabled: true });
      const record = logger.log(makeDecision(), { agentId: 'agent-001', action: 'read-data' });
      expect(record).toBeDefined();
      expect(record!.agentId).toBe('agent-001');
      expect(record!.action).toBe('read-data');
    });

    it('returns undefined when logging is disabled', () => {
      const logger = new AuditLogger({ enabled: false });
      const record = logger.log(makeDecision(), { agentId: 'agent-001', action: 'read-data' });
      expect(record).toBeUndefined();
    });

    it('sets outcome to "permit" for permitted decisions', () => {
      const logger = new AuditLogger({ enabled: true });
      const record = logger.log(makeDecision({ permitted: true }));
      expect(record!.outcome).toBe('permit');
    });

    it('sets outcome to "deny" for denied decisions', () => {
      const logger = new AuditLogger({ enabled: true });
      const record = logger.log(makeDecision({ permitted: false, reason: 'Trust level insufficient.' }));
      expect(record!.outcome).toBe('deny');
    });

    it('assigns a unique id to each record', () => {
      const logger = new AuditLogger({ enabled: true });
      const r1 = logger.log(makeDecision());
      const r2 = logger.log(makeDecision());
      expect(r1!.id).not.toBe(r2!.id);
    });

    it('stores the protocol from the governance decision', () => {
      const logger = new AuditLogger({ enabled: true });
      const record = logger.log(makeDecision({ protocol: 'ATP' }));
      expect(record!.protocol).toBe('ATP');
    });

    it('evicts the oldest record when maxRecords capacity is reached', () => {
      const logger = new AuditLogger({ enabled: true, maxRecords: 2 });
      logger.log(makeDecision({ reason: 'first' }));
      logger.log(makeDecision({ reason: 'second' }));
      logger.log(makeDecision({ reason: 'third' }));
      const records = logger.getRecords();
      expect(records).toHaveLength(2);
      expect(records[0]!.reason).toBe('second');
      expect(records[1]!.reason).toBe('third');
    });
  });

  describe('query', () => {
    it('returns an empty array when logging is disabled', () => {
      const logger = new AuditLogger({ enabled: false });
      logger.log(makeDecision());
      expect(logger.query()).toHaveLength(0);
    });

    it('returns all records when no filter is specified', () => {
      const logger = new AuditLogger({ enabled: true });
      logger.log(makeDecision(), { agentId: 'agent-001', action: 'read' });
      logger.log(makeDecision(), { agentId: 'agent-002', action: 'write' });
      expect(logger.query()).toHaveLength(2);
    });

    it('filters records by outcome when filter.outcome is set', () => {
      const logger = new AuditLogger({ enabled: true });
      logger.log(makeDecision({ permitted: true }), { agentId: 'agent-001', action: 'read' });
      logger.log(makeDecision({ permitted: false }), { agentId: 'agent-002', action: 'write' });
      const deniedRecords = logger.query({ outcome: 'deny' });
      expect(deniedRecords).toHaveLength(1);
      expect(deniedRecords[0]!.outcome).toBe('deny');
    });

    it('filters records by agentId when filter.agentId is set', () => {
      const logger = new AuditLogger({ enabled: true });
      logger.log(makeDecision(), { agentId: 'agent-001', action: 'read' });
      logger.log(makeDecision(), { agentId: 'agent-002', action: 'write' });
      const records = logger.query({ agentId: 'agent-001' });
      expect(records).toHaveLength(1);
      expect(records[0]!.agentId).toBe('agent-001');
    });
  });

  describe('getRecords', () => {
    it('returns a copy of all records in insertion order', () => {
      const logger = new AuditLogger({ enabled: true });
      logger.log(makeDecision({ reason: 'first' }));
      logger.log(makeDecision({ reason: 'second' }));
      const records = logger.getRecords();
      expect(records).toHaveLength(2);
      expect(records[0]!.reason).toBe('first');
    });
  });

  describe('recordCount', () => {
    it('returns 0 for an empty logger', () => {
      const logger = new AuditLogger({ enabled: true });
      expect(logger.recordCount).toBe(0);
    });

    it('increments after each log call', () => {
      const logger = new AuditLogger({ enabled: true });
      logger.log(makeDecision());
      logger.log(makeDecision());
      expect(logger.recordCount).toBe(2);
    });
  });
});
