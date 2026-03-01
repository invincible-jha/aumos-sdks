// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Memory Governor
 *
 * `MemoryGovernor` is the central policy-enforcement point for agent memory
 * access under the Agent Memory Governance Protocol (AMGP).
 *
 * It evaluates `MemoryAccessRequest`s against:
 *   1. Retention policies (expiry, sharing rules)
 *   2. Consent-based access (required scopes)
 *
 * All access attempts are recorded in an append-only in-memory audit log.
 * Recording is purely observational — no behavioral analysis is performed.
 *
 * GDPR-style right-to-be-forgotten is supported via the `forget()` method.
 *
 * Trust changes are MANUAL ONLY.
 * Budget allocation is STATIC ONLY.
 * Audit logging is RECORDING ONLY.
 *
 * Public API:
 *   evaluate()    — check a MemoryAccessRequest and record the decision
 *   register()    — register a new memory slot with its retention policy
 *   getRecord()   — retrieve a slot's GovernedMemoryRecord
 *   listRecords() — retrieve all records, optionally filtered by owner
 *   forget()      — permanently delete slots (GDPR right-to-be-forgotten)
 */

import type {
  MemoryAccessRequest,
  MemoryGovernanceDecision,
  GovernedMemoryRecord,
  MemoryAccessLogEntry,
  RetentionPolicy,
  MemoryGovernorConfig,
  ForgetRequest,
  ForgetResult,
} from './types.js';
import { RetentionPolicyEngine, computeExpiresAt } from './retention.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ACCESS_LOG_ENTRIES = 1000;

// ---------------------------------------------------------------------------
// MemoryGovernor
// ---------------------------------------------------------------------------

/**
 * Evaluates and records memory access decisions for AI agents.
 *
 * `MemoryGovernor` maintains an in-memory registry of `GovernedMemoryRecord`s.
 * In production deployments, callers should persist records externally and
 * use `register()` to reload them on startup.
 *
 * @example
 * ```ts
 * const governor = new MemoryGovernor({
 *   categoryDefaults: {
 *     episodic: {
 *       maxAge: 'P30D',
 *       shareable: false,
 *       requiredConsentScopes: [],
 *     },
 *   },
 * });
 *
 * governor.register({
 *   memoryKey: 'session-2026-02-28',
 *   category: 'episodic',
 *   ownerAgentId: 'agent-alpha',
 *   createdAt: '2026-02-28T00:00:00.000Z',
 *   retentionPolicy: {
 *     maxAge: 'P7D',
 *     shareable: false,
 *     requiredConsentScopes: [],
 *   },
 *   accessLog: [],
 * });
 *
 * const decision = governor.evaluate(
 *   {
 *     agentId: 'agent-alpha',
 *     memoryCategory: 'episodic',
 *     operation: 'read',
 *     memoryKey: 'session-2026-02-28',
 *   },
 *   [], // no active consent scopes required for this slot
 * );
 * ```
 */
export class MemoryGovernor {
  readonly #config: MemoryGovernorConfig;
  readonly #retentionEngine: RetentionPolicyEngine;
  /** Registry of memory records, keyed by memoryKey. */
  readonly #records: Map<string, MutableGovernedMemoryRecord>;

  constructor(config: MemoryGovernorConfig = {}) {
    this.#config = config;
    this.#retentionEngine = new RetentionPolicyEngine();
    this.#records = new Map();
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Registers a memory slot with the governor.
   *
   * If a slot with the same `memoryKey` already exists, it is replaced.
   * Callers are responsible for ensuring uniqueness when that is required.
   *
   * @param record - The slot record to register.  The `expiresAt` field is
   *   computed from the retention policy's `maxAge` if not already set.
   */
  register(record: GovernedMemoryRecord): void {
    const mutable: MutableGovernedMemoryRecord = {
      memoryKey: record.memoryKey,
      category: record.category,
      ownerAgentId: record.ownerAgentId,
      createdAt: record.createdAt,
      expiresAt:
        record.expiresAt ??
        computeExpiresAt(record.createdAt, record.retentionPolicy),
      retentionPolicy: record.retentionPolicy,
      accessLog: [...record.accessLog],
    };
    this.#records.set(record.memoryKey, mutable);
  }

  /**
   * Creates and registers a new memory slot, computing `expiresAt`
   * automatically from the retention policy.
   *
   * The `createdAt` timestamp defaults to now.  An explicit `retentionPolicy`
   * is required unless `config.categoryDefaults` or `config.globalDefault`
   * covers the category.
   *
   * @param params   - Slot creation parameters.
   * @returns The created `GovernedMemoryRecord`.
   */
  create(params: CreateMemorySlotParams): GovernedMemoryRecord {
    const createdAt = params.createdAt ?? new Date().toISOString();
    const retentionPolicy =
      params.retentionPolicy ??
      this.#resolveDefaultPolicy(params.category);

    const expiresAt = computeExpiresAt(createdAt, retentionPolicy);

    const record: MutableGovernedMemoryRecord = {
      memoryKey: params.memoryKey,
      category: params.category,
      ownerAgentId: params.ownerAgentId,
      createdAt,
      expiresAt,
      retentionPolicy,
      accessLog: [],
    };

    this.#records.set(params.memoryKey, record);
    return this.#toImmutable(record);
  }

  // -------------------------------------------------------------------------
  // Evaluation
  // -------------------------------------------------------------------------

  /**
   * Evaluates a memory access request against retention and consent policies.
   *
   * Decision logic (in order):
   *   1. Slot not found — deny with NOT_FOUND.
   *   2. Slot expired — deny with EXPIRED.
   *   3. Sharing violation (agent is not owner and shareable=false) — deny.
   *   4. Missing consent scopes — deny.
   *   5. All checks pass — permit.
   *
   * The decision is always recorded in the slot's access log regardless of
   * outcome.
   *
   * @param request      - The access request to evaluate.
   * @param activeScopes - Consent scopes currently active for the requesting
   *   agent.  Pass an empty array if no scopes are active.
   * @returns `MemoryGovernanceDecision` with `permitted` and optional `reason`.
   */
  evaluate(
    request: MemoryAccessRequest,
    activeScopes: readonly string[] = [],
  ): MemoryGovernanceDecision {
    const record = this.#records.get(request.memoryKey);
    const timestamp = new Date().toISOString();

    // --- Slot not found ---
    if (record === undefined) {
      // No log entry to append — the slot does not exist.
      return {
        permitted: false,
        reason: `Memory slot "${request.memoryKey}" not found.`,
      };
    }

    // --- Expiry check ---
    if (this.#retentionEngine.isExpired(record)) {
      this.#appendAccessLog(record, {
        agentId: request.agentId,
        operation: request.operation,
        timestamp,
        permitted: false,
      });
      return {
        permitted: false,
        reason: `Memory slot "${request.memoryKey}" has expired.`,
      };
    }

    // --- Sharing check ---
    if (!this.#retentionEngine.canShareWith(request.agentId, record)) {
      this.#appendAccessLog(record, {
        agentId: request.agentId,
        operation: request.operation,
        timestamp,
        permitted: false,
      });
      return {
        permitted: false,
        reason: `Memory slot "${request.memoryKey}" is private to owner "${record.ownerAgentId}".`,
      };
    }

    // --- Consent scope check ---
    if (
      !this.#retentionEngine.hasRequiredScopes(record.retentionPolicy, activeScopes)
    ) {
      const missing = record.retentionPolicy.requiredConsentScopes.filter(
        (scope) => !activeScopes.includes(scope),
      );
      this.#appendAccessLog(record, {
        agentId: request.agentId,
        operation: request.operation,
        timestamp,
        permitted: false,
      });
      return {
        permitted: false,
        reason: `Missing required consent scope(s): ${missing.join(', ')}.`,
      };
    }

    // --- All checks passed ---
    this.#appendAccessLog(record, {
      agentId: request.agentId,
      operation: request.operation,
      timestamp,
      permitted: true,
    });

    return {
      permitted: true,
      retentionPolicy: record.retentionPolicy,
    };
  }

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  /**
   * Retrieves the `GovernedMemoryRecord` for the given key.
   * Returns `undefined` if no slot with that key is registered.
   */
  getRecord(memoryKey: string): GovernedMemoryRecord | undefined {
    const record = this.#records.get(memoryKey);
    return record !== undefined ? this.#toImmutable(record) : undefined;
  }

  /**
   * Returns all registered memory records.
   *
   * When `ownerAgentId` is provided, only records belonging to that agent
   * are returned.
   *
   * @param ownerAgentId - Optional filter by owner agent.
   */
  listRecords(ownerAgentId?: string): readonly GovernedMemoryRecord[] {
    const all = Array.from(this.#records.values());
    const filtered =
      ownerAgentId !== undefined
        ? all.filter((record) => record.ownerAgentId === ownerAgentId)
        : all;
    return filtered.map((record) => this.#toImmutable(record));
  }

  /**
   * Returns all registered records that have expired.
   *
   * Useful for cleanup routines.
   *
   * @param referenceTime - The time to compare against. Defaults to now.
   */
  listExpiredRecords(referenceTime: Date = new Date()): readonly GovernedMemoryRecord[] {
    return this.#retentionEngine
      .filterExpired(this.listRecords(), referenceTime)
      .map((record) => record);
  }

  // -------------------------------------------------------------------------
  // GDPR right-to-be-forgotten
  // -------------------------------------------------------------------------

  /**
   * Permanently deletes one or more memory slots.
   *
   * This is the GDPR right-to-be-forgotten implementation.  Once forgotten,
   * slots cannot be recovered.  The returned `ForgetResult` records the keys
   * that were deleted.
   *
   * Only the slot owner may issue a forget request.  Slots owned by a
   * different agent are silently skipped (not deleted, not counted).
   *
   * Passing `memoryKeys: '*'` deletes all slots owned by
   * `requestingAgentId`.
   *
   * @param request - The forget request.
   */
  forget(request: ForgetRequest): ForgetResult {
    const forgottenAt = new Date().toISOString();
    const deletedKeys: string[] = [];

    let targetKeys: readonly string[];

    if (request.memoryKeys === '*') {
      targetKeys = Array.from(this.#records.values())
        .filter((record) => record.ownerAgentId === request.requestingAgentId)
        .map((record) => record.memoryKey);
    } else {
      targetKeys = request.memoryKeys;
    }

    for (const key of targetKeys) {
      const record = this.#records.get(key);
      if (record === undefined) {
        continue;
      }
      // Only the owner may forget a slot.
      if (record.ownerAgentId !== request.requestingAgentId) {
        continue;
      }
      this.#records.delete(key);
      deletedKeys.push(key);
    }

    return {
      deletedCount: deletedKeys.length,
      deletedKeys,
      forgottenAt,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  #resolveDefaultPolicy(category: string): RetentionPolicy {
    const categoryDefaults = this.#config.categoryDefaults;
    if (categoryDefaults !== undefined) {
      const categoryPolicy =
        categoryDefaults[category as keyof typeof categoryDefaults];
      if (categoryPolicy !== undefined) {
        return categoryPolicy;
      }
    }

    if (this.#config.globalDefault !== undefined) {
      return this.#config.globalDefault;
    }

    // Bare-minimum default: no expiry, non-shareable, no consent required.
    return {
      shareable: false,
      requiredConsentScopes: [],
    };
  }

  #appendAccessLog(
    record: MutableGovernedMemoryRecord,
    entry: MemoryAccessLogEntry,
  ): void {
    const maxEntries =
      this.#config.maxAccessLogEntries ?? DEFAULT_MAX_ACCESS_LOG_ENTRIES;

    if (record.accessLog.length >= maxEntries) {
      record.accessLog.shift();
    }
    record.accessLog.push(entry);
  }

  #toImmutable(record: MutableGovernedMemoryRecord): GovernedMemoryRecord {
    return {
      memoryKey: record.memoryKey,
      category: record.category,
      ownerAgentId: record.ownerAgentId,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      retentionPolicy: record.retentionPolicy,
      accessLog: [...record.accessLog],
    };
  }
}

// ---------------------------------------------------------------------------
// Internal mutable type (not exported)
// ---------------------------------------------------------------------------

/**
 * Mutable version of `GovernedMemoryRecord` used only inside `MemoryGovernor`.
 * Not exported — consumers always receive the immutable `GovernedMemoryRecord`.
 */
interface MutableGovernedMemoryRecord {
  memoryKey: string;
  category: string;
  ownerAgentId: string;
  createdAt: string;
  expiresAt?: string;
  retentionPolicy: RetentionPolicy;
  accessLog: MemoryAccessLogEntry[];
}

// ---------------------------------------------------------------------------
// CreateMemorySlotParams
// ---------------------------------------------------------------------------

/**
 * Parameters for `MemoryGovernor.create()`.
 */
export interface CreateMemorySlotParams {
  /** Key identifying the new memory slot. Must be unique. */
  readonly memoryKey: string;
  /** Memory category. */
  readonly category: import('./types.js').MemoryCategory;
  /** Agent that owns this slot. */
  readonly ownerAgentId: string;
  /**
   * ISO 8601 creation timestamp.
   * Defaults to the current time when not provided.
   */
  readonly createdAt?: string;
  /**
   * Retention policy for this slot.  When absent, the governor resolves
   * a default from `config.categoryDefaults` or `config.globalDefault`.
   */
  readonly retentionPolicy?: RetentionPolicy;
}
