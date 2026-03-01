// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { TrustAssignment, SpendingEnvelope, ConsentRecord } from '../types.js';
import type { AuditRecord } from '../audit/record.js';

/**
 * StorageAdapter defines the persistence contract for all governance state.
 *
 * Each AumOS governance primitive (trust, budget, consent, audit) stores its
 * state through this interface.  The default implementation is in-memory (the
 * `MemoryStorageAdapter`).  Persistent backends — Redis, Postgres, SQLite —
 * implement the same interface for production deployments.
 *
 * Design principles:
 *   1. All methods are async to support network-backed stores.
 *   2. Each domain (trust, budget, consent, audit) has a dedicated namespace
 *      to prevent key collisions.
 *   3. The adapter is stateless between calls — no caching, no transactions,
 *      no optimistic locking.  Higher-level coordination belongs in the manager.
 *   4. Serialisation format is opaque to the adapter — callers pass typed objects,
 *      adapters serialise as appropriate for their backend.
 */
export interface StorageAdapter {
  // -------------------------------------------------------------------------
  // Trust storage
  // -------------------------------------------------------------------------

  /** Persist a trust assignment, keyed by `agentId:scope`. */
  setTrustAssignment(key: string, assignment: TrustAssignment): Promise<void>;

  /** Retrieve a trust assignment by key. Returns undefined if not found. */
  getTrustAssignment(key: string): Promise<TrustAssignment | undefined>;

  /** Return all stored trust assignments. */
  listTrustAssignments(): Promise<readonly TrustAssignment[]>;

  // -------------------------------------------------------------------------
  // Budget storage
  // -------------------------------------------------------------------------

  /** Persist a spending envelope, keyed by category name. */
  setSpendingEnvelope(category: string, envelope: SpendingEnvelope): Promise<void>;

  /** Retrieve a spending envelope by category. Returns undefined if not found. */
  getSpendingEnvelope(category: string): Promise<SpendingEnvelope | undefined>;

  /** Return all stored spending envelopes. */
  listSpendingEnvelopes(): Promise<readonly SpendingEnvelope[]>;

  // -------------------------------------------------------------------------
  // Consent storage
  // -------------------------------------------------------------------------

  /** Add a consent record for an agent. */
  addConsentRecord(record: ConsentRecord): Promise<void>;

  /** Retrieve all consent records for an agent (active and revoked). */
  getConsentRecords(agentId: string): Promise<readonly ConsentRecord[]>;

  /** Mark matching consent records as revoked. Returns count of revoked records. */
  revokeConsentRecords(
    agentId: string,
    dataType: string,
    purpose?: string,
  ): Promise<number>;

  // -------------------------------------------------------------------------
  // Audit storage
  // -------------------------------------------------------------------------

  /** Append an audit record. */
  appendAuditRecord(record: AuditRecord): Promise<void>;

  /** Retrieve audit records, optionally filtered. */
  queryAuditRecords(filter?: AuditStorageFilter): Promise<readonly AuditRecord[]>;

  /** Return the total count of stored audit records. */
  auditRecordCount(): Promise<number>;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Called once when the adapter is first used. Use for connection setup. */
  connect?(): Promise<void>;

  /** Called on shutdown. Use for connection teardown. */
  disconnect?(): Promise<void>;

  /** Health check. Returns true if the backend is reachable. */
  isHealthy?(): Promise<boolean>;
}

/**
 * Filter criteria for querying audit records from storage.
 * All fields are optional and combined with AND semantics.
 */
export interface AuditStorageFilter {
  /** Filter by agent identifier. */
  agentId?: string;
  /** Filter by action name. */
  action?: string;
  /** Filter by outcome. */
  outcome?: 'permit' | 'deny';
  /** Filter by protocol. */
  protocol?: string;
  /** Records created at or after this ISO 8601 timestamp. */
  since?: string;
  /** Records created at or before this ISO 8601 timestamp. */
  until?: string;
  /** Maximum number of records to return. */
  limit?: number;
  /** Number of records to skip (for pagination). */
  offset?: number;
}
