// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { describe, it, expect } from 'vitest';
import { ConsentManager } from '../src/consent/manager.js';

describe('ConsentManager', () => {
  describe('recordConsent', () => {
    it('returns a ConsentRecord with the supplied fields', () => {
      const manager = new ConsentManager();
      const record = manager.recordConsent('agent-001', 'email', 'marketing', 'user-123');
      expect(record.agentId).toBe('agent-001');
      expect(record.dataType).toBe('email');
      expect(record.purpose).toBe('marketing');
      expect(record.grantedBy).toBe('user-123');
      expect(record.active).toBe(true);
    });

    it('generates a unique id for each consent record', () => {
      const manager = new ConsentManager();
      const r1 = manager.recordConsent('agent-001', 'email', 'marketing', 'user-123');
      const r2 = manager.recordConsent('agent-001', 'email', 'marketing', 'user-123');
      expect(r1.id).not.toBe(r2.id);
    });

    it('stores the optional expiresAt value on the record', () => {
      const manager = new ConsentManager();
      const expiresAt = '2027-01-01T00:00:00.000Z';
      const record = manager.recordConsent('agent-001', 'pii', 'analytics', 'admin', { expiresAt });
      expect(record.expiresAt).toBe(expiresAt);
    });

    it('throws a RangeError for an empty agentId', () => {
      const manager = new ConsentManager();
      expect(() => manager.recordConsent('', 'email', 'marketing', 'user')).toThrow(RangeError);
    });

    it('throws a RangeError for an empty dataType', () => {
      const manager = new ConsentManager();
      expect(() => manager.recordConsent('agent', '', 'marketing', 'user')).toThrow(RangeError);
    });

    it('throws a RangeError for an empty purpose', () => {
      const manager = new ConsentManager();
      expect(() => manager.recordConsent('agent', 'email', '', 'user')).toThrow(RangeError);
    });
  });

  describe('checkConsent — requireConsent: false (default)', () => {
    it('permits access even without any recorded consent', () => {
      const manager = new ConsentManager();
      const result = manager.checkConsent('agent-001', 'email');
      expect(result.permitted).toBe(true);
    });

    it('surfaces the matching record when one exists', () => {
      const manager = new ConsentManager();
      manager.recordConsent('agent-001', 'email', 'marketing', 'user-123');
      const result = manager.checkConsent('agent-001', 'email');
      expect(result.permitted).toBe(true);
      expect(result.record).toBeDefined();
    });
  });

  describe('checkConsent — requireConsent: true', () => {
    it('denies when no consent record exists', () => {
      const manager = new ConsentManager({ requireConsent: true });
      const result = manager.checkConsent('agent-001', 'pii-data');
      expect(result.permitted).toBe(false);
      expect(result.reason).toBeTruthy();
    });

    it('permits when a matching active consent record exists', () => {
      const manager = new ConsentManager({ requireConsent: true });
      manager.recordConsent('agent-001', 'pii-data', 'analytics', 'admin');
      const result = manager.checkConsent('agent-001', 'pii-data');
      expect(result.permitted).toBe(true);
      expect(result.record).toBeDefined();
    });

    it('denies when purpose does not match any active record', () => {
      const manager = new ConsentManager({ requireConsent: true });
      manager.recordConsent('agent-001', 'email', 'marketing', 'user');
      const result = manager.checkConsent('agent-001', 'email', 'analytics');
      expect(result.permitted).toBe(false);
    });

    it('permits when purpose matches an active record', () => {
      const manager = new ConsentManager({ requireConsent: true });
      manager.recordConsent('agent-001', 'email', 'analytics', 'user');
      const result = manager.checkConsent('agent-001', 'email', 'analytics');
      expect(result.permitted).toBe(true);
    });
  });

  describe('revokeConsent', () => {
    it('returns the count of revoked records', () => {
      const manager = new ConsentManager({ requireConsent: true });
      manager.recordConsent('agent-001', 'email', 'marketing', 'user');
      manager.recordConsent('agent-001', 'email', 'analytics', 'user');
      const count = manager.revokeConsent('agent-001', 'email');
      expect(count).toBe(2);
    });

    it('causes subsequent checkConsent to deny after revocation', () => {
      const manager = new ConsentManager({ requireConsent: true });
      manager.recordConsent('agent-001', 'email', 'marketing', 'user');
      manager.revokeConsent('agent-001', 'email');
      const result = manager.checkConsent('agent-001', 'email');
      expect(result.permitted).toBe(false);
    });

    it('revokes only the matching purpose when purpose is specified', () => {
      const manager = new ConsentManager({ requireConsent: true });
      manager.recordConsent('agent-001', 'email', 'marketing', 'user');
      manager.recordConsent('agent-001', 'email', 'analytics', 'user');
      manager.revokeConsent('agent-001', 'email', 'marketing');
      const marketingResult = manager.checkConsent('agent-001', 'email', 'marketing');
      const analyticsResult = manager.checkConsent('agent-001', 'email', 'analytics');
      expect(marketingResult.permitted).toBe(false);
      expect(analyticsResult.permitted).toBe(true);
    });

    it('returns 0 when no matching records exist', () => {
      const manager = new ConsentManager();
      const count = manager.revokeConsent('agent-001', 'no-data-type');
      expect(count).toBe(0);
    });
  });

  describe('listConsents', () => {
    it('returns an empty array for an agent with no consents', () => {
      const manager = new ConsentManager();
      expect(manager.listConsents('agent-001')).toHaveLength(0);
    });

    it('returns all active consents for the agent', () => {
      const manager = new ConsentManager();
      manager.recordConsent('agent-001', 'email', 'marketing', 'user');
      manager.recordConsent('agent-001', 'pii', 'analytics', 'user');
      expect(manager.listConsents('agent-001')).toHaveLength(2);
    });

    it('excludes revoked consents from the list', () => {
      const manager = new ConsentManager();
      manager.recordConsent('agent-001', 'email', 'marketing', 'user');
      manager.revokeConsent('agent-001', 'email');
      expect(manager.listConsents('agent-001')).toHaveLength(0);
    });
  });
});
