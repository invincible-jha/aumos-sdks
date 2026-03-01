// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { GovernanceAction, GovernanceDecision } from './types.js';
import type { StorageAdapter } from './storage/adapter.js';
import { MemoryStorageAdapter } from './storage/memory.js';
import { GovernanceEngine } from './governance.js';

/**
 * Configuration for the OSS reference GovernanceEngine.
 */
export interface ReferenceEngineConfig {
  /** Storage backend. Defaults to MemoryStorageAdapter. */
  storage?: StorageAdapter;
  /** Engine configuration passed to GovernanceEngine. */
  engineConfig?: Record<string, unknown>;
  /** Whether to auto-connect storage on first evaluate(). Defaults to true. */
  autoConnect?: boolean;
}

/**
 * ReferenceGovernanceEngine is the OSS-ready, storage-pluggable wrapper
 * around GovernanceEngine.
 *
 * This is the recommended entry point for community users who need a
 * complete governance evaluation pipeline with pluggable persistence.
 *
 * Key differences from raw GovernanceEngine:
 *   1. Accepts a StorageAdapter for persistent state (default: in-memory)
 *   2. Provides connect()/disconnect() lifecycle methods
 *   3. Wraps evaluate() with storage read/write hooks
 *   4. Exposes the underlying managers for direct access
 *
 * All four governance primitives are included:
 *   - Trust: manual level assignment, scope-aware, expiry-aware
 *   - Budget: per-category spending envelopes with period reset
 *   - Consent: explicit data access grants with revocation
 *   - Audit: append-only decision log
 *
 * @example
 * ```typescript
 * import { ReferenceGovernanceEngine } from '@aumos/governance';
 * import { RedisStorageAdapter } from '@aumos/governance';
 *
 * const engine = new ReferenceGovernanceEngine({
 *   storage: new RedisStorageAdapter({ client: redisClient }),
 * });
 *
 * await engine.connect();
 *
 * // Set up trust and budget
 * engine.core.trust.setLevel('agent-1', TrustLevel.L3_ACT_APPROVE);
 * engine.core.budget.createBudget('api_calls', 1000, 'daily');
 *
 * // Evaluate
 * const decision = await engine.evaluate({
 *   agentId: 'agent-1',
 *   action: 'send_email',
 *   category: 'communication',
 *   requiredTrustLevel: TrustLevel.L3_ACT_APPROVE,
 *   cost: 1,
 * });
 * ```
 */
export class ReferenceGovernanceEngine {
  readonly core: GovernanceEngine;
  readonly storage: StorageAdapter;
  readonly #autoConnect: boolean;
  #connected = false;

  constructor(config: ReferenceEngineConfig = {}) {
    this.storage = config.storage ?? new MemoryStorageAdapter();
    this.core = new GovernanceEngine(config.engineConfig ?? {});
    this.#autoConnect = config.autoConnect ?? true;
  }

  /**
   * Initialize the storage backend.
   * Must be called before evaluate() unless autoConnect is true.
   */
  async connect(): Promise<void> {
    if (this.#connected) return;
    if (this.storage.connect !== undefined) {
      await this.storage.connect();
    }
    this.#connected = true;
  }

  /**
   * Tear down the storage backend.
   */
  async disconnect(): Promise<void> {
    if (!this.#connected) return;
    if (this.storage.disconnect !== undefined) {
      await this.storage.disconnect();
    }
    this.#connected = false;
  }

  /**
   * Check if the storage backend is healthy.
   */
  async isHealthy(): Promise<boolean> {
    if (this.storage.isHealthy !== undefined) {
      return this.storage.isHealthy();
    }
    return this.#connected;
  }

  /**
   * Evaluate a governance action through the full pipeline.
   *
   * The pipeline runs: trust check → budget check → consent check → audit log.
   * Any failed check short-circuits and returns a denied decision.
   *
   * When a storage adapter is configured, the audit record is also persisted
   * to the storage backend after logging to the in-memory audit trail.
   *
   * @param action - The governance action to evaluate.
   * @returns The governance decision.
   */
  async evaluate(action: GovernanceAction): Promise<GovernanceDecision> {
    if (this.#autoConnect && !this.#connected) {
      await this.connect();
    }

    const decision = await this.core.evaluate(action);

    // Persist the audit record to storage if connected
    if (this.#connected) {
      const records = this.core.audit.getRecords();
      const latestRecord = records[records.length - 1];
      if (latestRecord !== undefined) {
        await this.storage.appendAuditRecord(latestRecord);
      }
    }

    return decision;
  }
}
