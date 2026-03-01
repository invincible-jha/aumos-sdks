// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { describe, it, expect } from 'vitest';
import { BudgetManager } from '../src/budget/manager.js';

describe('BudgetManager', () => {
  describe('createBudget', () => {
    it('creates a spending envelope and returns it', () => {
      const manager = new BudgetManager();
      const envelope = manager.createBudget('api-calls', 100, 'daily');
      expect(envelope.category).toBe('api-calls');
      expect(envelope.limit).toBe(100);
      expect(envelope.period).toBe('daily');
      expect(envelope.spent).toBe(0);
    });

    it('replaces an existing envelope for the same category', () => {
      const manager = new BudgetManager();
      manager.createBudget('api-calls', 100, 'daily');
      const updated = manager.createBudget('api-calls', 500, 'monthly');
      expect(updated.limit).toBe(500);
      expect(updated.period).toBe('monthly');
    });

    it('throws a RangeError for an empty category string', () => {
      const manager = new BudgetManager();
      expect(() => manager.createBudget('', 100, 'daily')).toThrow(RangeError);
    });

    it('throws a RangeError when limit is zero or negative', () => {
      const manager = new BudgetManager();
      expect(() => manager.createBudget('cat', 0, 'daily')).toThrow(RangeError);
      expect(() => manager.createBudget('cat', -10, 'daily')).toThrow(RangeError);
    });

    it('assigns a unique id to each new envelope', () => {
      const manager = new BudgetManager();
      const envA = manager.createBudget('category-a', 100, 'daily');
      const envB = manager.createBudget('category-b', 200, 'daily');
      expect(envA.id).not.toBe(envB.id);
    });
  });

  describe('checkBudget', () => {
    it('permits a spend within the envelope limit', () => {
      const manager = new BudgetManager();
      manager.createBudget('api-calls', 100, 'daily');
      const result = manager.checkBudget('api-calls', 50);
      expect(result.permitted).toBe(true);
      expect(result.available).toBe(100);
    });

    it('permits a spend that exactly equals the available amount', () => {
      const manager = new BudgetManager();
      manager.createBudget('api-calls', 100, 'daily');
      const result = manager.checkBudget('api-calls', 100);
      expect(result.permitted).toBe(true);
    });

    it('denies a spend that would exceed the envelope limit', () => {
      const manager = new BudgetManager();
      manager.createBudget('api-calls', 50, 'daily');
      const result = manager.checkBudget('api-calls', 100);
      expect(result.permitted).toBe(false);
      expect(result.reason).toBeTruthy();
    });

    it('denies when no envelope is registered for the category', () => {
      const manager = new BudgetManager();
      const result = manager.checkBudget('nonexistent-category', 10);
      expect(result.permitted).toBe(false);
      expect(result.available).toBe(0);
    });

    it('checkBudget does not mutate the envelope state', () => {
      const manager = new BudgetManager();
      manager.createBudget('api-calls', 100, 'daily');
      manager.checkBudget('api-calls', 50);
      manager.checkBudget('api-calls', 50);
      const utilization = manager.getUtilization('api-calls');
      expect(utilization!.spent).toBe(0);
    });
  });

  describe('recordSpending', () => {
    it('records a spend and updates the envelope spent amount', () => {
      const manager = new BudgetManager();
      manager.createBudget('api-calls', 100, 'daily');
      manager.recordSpending('api-calls', 30);
      const utilization = manager.getUtilization('api-calls');
      expect(utilization!.spent).toBe(30);
    });

    it('accumulates multiple spending records', () => {
      const manager = new BudgetManager();
      manager.createBudget('api-calls', 200, 'daily');
      manager.recordSpending('api-calls', 50);
      manager.recordSpending('api-calls', 75);
      const utilization = manager.getUtilization('api-calls');
      expect(utilization!.spent).toBe(125);
    });

    it('throws a RangeError for a non-positive amount', () => {
      const manager = new BudgetManager();
      manager.createBudget('api-calls', 100, 'daily');
      expect(() => manager.recordSpending('api-calls', 0)).toThrow(RangeError);
      expect(() => manager.recordSpending('api-calls', -5)).toThrow(RangeError);
    });

    it('throws a RangeError when no envelope exists for the category', () => {
      const manager = new BudgetManager();
      expect(() => manager.recordSpending('missing', 10)).toThrow(RangeError);
    });
  });

  describe('getUtilization', () => {
    it('returns undefined for a category with no envelope', () => {
      const manager = new BudgetManager();
      expect(manager.getUtilization('missing')).toBeUndefined();
    });

    it('returns a utilization snapshot with correct fields', () => {
      const manager = new BudgetManager();
      manager.createBudget('api-calls', 200, 'daily');
      manager.recordSpending('api-calls', 80);
      const utilization = manager.getUtilization('api-calls');
      expect(utilization).not.toBeUndefined();
      expect(utilization!.limit).toBe(200);
      expect(utilization!.spent).toBe(80);
      expect(utilization!.available).toBe(120);
      expect(utilization!.utilizationPercent).toBe(40);
    });
  });

  describe('listUtilizations', () => {
    it('returns an empty array when no envelopes are registered', () => {
      const manager = new BudgetManager();
      expect(manager.listUtilizations()).toHaveLength(0);
    });

    it('returns one entry per registered envelope', () => {
      const manager = new BudgetManager();
      manager.createBudget('cat-a', 100, 'daily');
      manager.createBudget('cat-b', 200, 'weekly');
      expect(manager.listUtilizations()).toHaveLength(2);
    });
  });

  describe('constructor — config presets', () => {
    it('seeds envelopes declared in config without additional createBudget calls', () => {
      const manager = new BudgetManager({
        envelopes: [{ category: 'preconfigured', limit: 500, period: 'monthly' }],
      });
      const result = manager.checkBudget('preconfigured', 100);
      expect(result.permitted).toBe(true);
    });
  });
});
