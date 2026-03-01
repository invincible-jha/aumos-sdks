// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Agent Memory Governance Types (AMGP)
 *
 * Agent Memory Governance Protocol (AMGP) defines the data structures for
 * governing how AI agents read, write, and delete their memory slots.
 *
 * Four categories of agent memory are recognised:
 *   - episodic    : records of past interactions / events
 *   - semantic    : factual knowledge about the world
 *   - procedural  : learned skills or execution patterns
 *   - working     : short-lived scratch space for current task
 *
 * Memory governance enforces three policies:
 *   1. Consent-based access — each memory slot requires specific consent scopes
 *   2. Retention — memories expire after maxAge and are cleaned up automatically
 *   3. Sharing rules — memories can be marked non-shareable (agent-private)
 *
 * GDPR-style right-to-be-forgotten is supported via MemoryGovernor.forget().
 *
 * This is recording-only governance — no anomaly detection, no behavioral
 * scoring, no adaptive policies.  All retention policies are static.
 */

// ---------------------------------------------------------------------------
// Memory categories
// ---------------------------------------------------------------------------

/**
 * Categories of agent memory, corresponding to the four memory systems
 * recognised by the AMGP specification.
 */
export type MemoryCategory = 'episodic' | 'semantic' | 'procedural' | 'working';

// ---------------------------------------------------------------------------
// Access requests
// ---------------------------------------------------------------------------

/**
 * A request by an agent to read, write, or delete a specific memory slot.
 *
 * The `reason` field is strongly recommended for audit purposes but is not
 * required to allow use in latency-sensitive paths.
 */
export interface MemoryAccessRequest {
  /** The agent making the access request. */
  readonly agentId: string;
  /** The category of memory being accessed. */
  readonly memoryCategory: MemoryCategory;
  /** The operation being attempted. */
  readonly operation: 'read' | 'write' | 'delete';
  /**
   * Key or pattern identifying the memory slot.
   *
   * Keys are opaque strings.  Implementations MUST NOT parse or interpret
   * them — they exist purely to identify the slot for access control and
   * audit purposes.
   */
  readonly memoryKey: string;
  /**
   * Human-readable reason for the access attempt.
   * Recorded in the audit log and surfaced in denial responses.
   */
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Governance decisions
// ---------------------------------------------------------------------------

/**
 * The governance verdict for a `MemoryAccessRequest`.
 *
 * When `permitted` is false, `reason` MUST be populated.
 * When `permitted` is true, `retentionPolicy` carries the policy that
 * applies to the accessed slot (useful for callers that need to propagate
 * policy metadata to their storage layer).
 */
export interface MemoryGovernanceDecision {
  readonly permitted: boolean;
  readonly reason?: string;
  /** Retention policy applied to the accessed slot when permitted. */
  readonly retentionPolicy?: RetentionPolicy;
}

// ---------------------------------------------------------------------------
// Retention policies
// ---------------------------------------------------------------------------

/**
 * Governs the lifetime and sharing of a memory slot.
 *
 * Retention policies are static — they are set at slot creation time and
 * cannot be modified after the fact.  Any modification requires deleting
 * the slot and re-creating it.
 *
 * `maxAge` is an ISO 8601 duration string (e.g., "P7D" for 7 days,
 * "PT1H" for 1 hour).  Absent means the slot never expires automatically.
 */
export interface RetentionPolicy {
  /**
   * Maximum age of this memory slot before it should be considered expired
   * and eligible for cleanup.  ISO 8601 duration string (e.g., "P30D").
   * Absent means the slot never expires automatically.
   */
  readonly maxAge?: string;
  /**
   * Whether this memory slot may be read by agents other than the owner.
   * When false, only `ownerAgentId` may access the slot.
   */
  readonly shareable: boolean;
  /**
   * Consent scopes that must be active for any agent to access this slot.
   * An empty array means the slot is open to all agents (subject to
   * `shareable` constraints).
   */
  readonly requiredConsentScopes: readonly string[];
}

// ---------------------------------------------------------------------------
// Governed memory records
// ---------------------------------------------------------------------------

/**
 * A memory slot record with full governance metadata attached.
 *
 * This type represents the persisted state of a memory slot including its
 * access history.  `accessLog` is append-only — governance implementations
 * MUST NOT remove or modify existing entries.
 */
export interface GovernedMemoryRecord {
  /** The key identifying this memory slot. */
  readonly memoryKey: string;
  /** The category this slot belongs to. */
  readonly category: MemoryCategory;
  /** The agent that originally created this slot. */
  readonly ownerAgentId: string;
  /** ISO 8601 timestamp when this slot was created. */
  readonly createdAt: string;
  /**
   * ISO 8601 timestamp after which this slot is expired.
   * Computed from `retentionPolicy.maxAge` at creation time.
   * Absent if the policy has no `maxAge`.
   */
  readonly expiresAt?: string;
  /** The retention policy that governs this slot. */
  readonly retentionPolicy: RetentionPolicy;
  /**
   * Append-only log of all access attempts (permitted and denied).
   * Recording only — do NOT derive behavioral scores from this data.
   */
  readonly accessLog: readonly MemoryAccessLogEntry[];
}

/**
 * A single entry in a memory slot's access log.
 */
export interface MemoryAccessLogEntry {
  /** The agent that attempted the access. */
  readonly agentId: string;
  /** The operation that was attempted. */
  readonly operation: 'read' | 'write' | 'delete';
  /** ISO 8601 timestamp of the access attempt. */
  readonly timestamp: string;
  /** Whether the access was permitted. */
  readonly permitted: boolean;
}

// ---------------------------------------------------------------------------
// MemoryGovernor configuration
// ---------------------------------------------------------------------------

/**
 * Policy configuration for `MemoryGovernor`.
 *
 * Category-level policies are applied when a per-slot retention policy has
 * not been explicitly provided by the caller.
 */
export interface MemoryGovernorConfig {
  /**
   * Default retention policies per memory category.
   * Applied when a write request does not specify an explicit policy.
   */
  readonly categoryDefaults?: Partial<Record<MemoryCategory, RetentionPolicy>>;
  /**
   * Global default applied when neither a per-slot nor a per-category policy
   * is available.  If absent, slots without a policy are allowed without
   * retention constraints.
   */
  readonly globalDefault?: RetentionPolicy;
  /**
   * Maximum number of access log entries to retain per memory record.
   * When exceeded, the oldest entries are evicted.
   * Default: 1000.
   */
  readonly maxAccessLogEntries?: number;
}

// ---------------------------------------------------------------------------
// Forget request (GDPR right-to-be-forgotten)
// ---------------------------------------------------------------------------

/**
 * Parameters for `MemoryGovernor.forget()`.
 *
 * Forget requests result in the permanent removal of one or more memory
 * slots and the creation of a tombstone audit entry that records the
 * deletion without retaining the original content.
 */
export interface ForgetRequest {
  /** The agent requesting the forget operation (must be slot owner). */
  readonly requestingAgentId: string;
  /**
   * One or more memory keys to forget.
   * Pass `'*'` to forget all slots owned by `requestingAgentId`.
   */
  readonly memoryKeys: readonly string[] | '*';
  /**
   * Reason for the forget request.  Required for audit purposes when
   * this is a GDPR right-to-be-forgotten request.
   */
  readonly reason?: string;
}

/**
 * Result of a `MemoryGovernor.forget()` call.
 */
export interface ForgetResult {
  /**
   * Number of memory slots actually deleted.
   */
  readonly deletedCount: number;
  /**
   * Keys of slots that were deleted.
   */
  readonly deletedKeys: readonly string[];
  /**
   * ISO 8601 timestamp of the forget operation.
   */
  readonly forgottenAt: string;
}
