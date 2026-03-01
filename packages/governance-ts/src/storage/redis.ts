// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { TrustAssignment, SpendingEnvelope, ConsentRecord } from '../types.js';
import type { AuditRecord } from '../audit/record.js';
import type { StorageAdapter, AuditStorageFilter } from './adapter.js';

/**
 * Minimal Redis client interface.
 *
 * This avoids a hard dependency on any specific Redis library.  Callers
 * provide a client instance that satisfies this contract — ioredis, node-redis,
 * and upstash-redis all expose compatible methods.
 */
export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string | null>;
  del(key: string | string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  lpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  llen(key: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<string>;
  ping(): Promise<string>;
  quit(): Promise<string>;
}

/** Configuration for the Redis storage adapter. */
export interface RedisStorageConfig {
  /** A Redis client instance satisfying the RedisClientLike interface. */
  client: RedisClientLike;
  /** Key prefix for all governance keys. Defaults to "aumos:". */
  prefix?: string;
  /** Maximum number of audit records to retain. Defaults to 100_000. */
  maxAuditRecords?: number;
}

/**
 * Redis-backed implementation of StorageAdapter.
 *
 * Provides sub-millisecond reads for trust and budget state, making it
 * suitable for production deployments where latency matters.
 *
 * Key layout:
 *   {prefix}trust:{key}           — JSON-serialised TrustAssignment
 *   {prefix}budget:{category}     — JSON-serialised SpendingEnvelope
 *   {prefix}consent:{agentId}     — Redis List of JSON-serialised ConsentRecords
 *   {prefix}audit                 — Redis List of JSON-serialised AuditRecords
 */
export class RedisStorageAdapter implements StorageAdapter {
  readonly #client: RedisClientLike;
  readonly #prefix: string;
  readonly #maxAuditRecords: number;

  constructor(config: RedisStorageConfig) {
    this.#client = config.client;
    this.#prefix = config.prefix ?? 'aumos:';
    this.#maxAuditRecords = config.maxAuditRecords ?? 100_000;
  }

  #key(namespace: string, id: string): string {
    return `${this.#prefix}${namespace}:${id}`;
  }

  // -------------------------------------------------------------------------
  // Trust
  // -------------------------------------------------------------------------

  async setTrustAssignment(key: string, assignment: TrustAssignment): Promise<void> {
    await this.#client.set(this.#key('trust', key), JSON.stringify(assignment));
  }

  async getTrustAssignment(key: string): Promise<TrustAssignment | undefined> {
    const raw = await this.#client.get(this.#key('trust', key));
    if (raw === null) return undefined;
    return JSON.parse(raw) as TrustAssignment;
  }

  async listTrustAssignments(): Promise<readonly TrustAssignment[]> {
    const keys = await this.#client.keys(`${this.#prefix}trust:*`);
    const results: TrustAssignment[] = [];
    for (const k of keys) {
      const raw = await this.#client.get(k);
      if (raw !== null) {
        results.push(JSON.parse(raw) as TrustAssignment);
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Budget
  // -------------------------------------------------------------------------

  async setSpendingEnvelope(category: string, envelope: SpendingEnvelope): Promise<void> {
    await this.#client.set(this.#key('budget', category), JSON.stringify(envelope));
  }

  async getSpendingEnvelope(category: string): Promise<SpendingEnvelope | undefined> {
    const raw = await this.#client.get(this.#key('budget', category));
    if (raw === null) return undefined;
    return JSON.parse(raw) as SpendingEnvelope;
  }

  async listSpendingEnvelopes(): Promise<readonly SpendingEnvelope[]> {
    const keys = await this.#client.keys(`${this.#prefix}budget:*`);
    const results: SpendingEnvelope[] = [];
    for (const k of keys) {
      const raw = await this.#client.get(k);
      if (raw !== null) {
        results.push(JSON.parse(raw) as SpendingEnvelope);
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Consent
  // -------------------------------------------------------------------------

  async addConsentRecord(record: ConsentRecord): Promise<void> {
    await this.#client.lpush(
      this.#key('consent', record.agentId),
      JSON.stringify(record),
    );
  }

  async getConsentRecords(agentId: string): Promise<readonly ConsentRecord[]> {
    const raw = await this.#client.lrange(this.#key('consent', agentId), 0, -1);
    return raw.map((r) => JSON.parse(r) as ConsentRecord);
  }

  async revokeConsentRecords(
    agentId: string,
    dataType: string,
    purpose?: string,
  ): Promise<number> {
    const key = this.#key('consent', agentId);
    const raw = await this.#client.lrange(key, 0, -1);
    const records = raw.map((r) => JSON.parse(r) as ConsentRecord);

    let count = 0;
    const updated: ConsentRecord[] = [];

    for (const record of records) {
      if (
        record.active &&
        record.dataType === dataType &&
        (purpose === undefined || record.purpose === purpose)
      ) {
        updated.push({ ...record, active: false });
        count++;
      } else {
        updated.push(record);
      }
    }

    if (count > 0) {
      await this.#client.del(key);
      for (const record of updated.reverse()) {
        await this.#client.lpush(key, JSON.stringify(record));
      }
    }

    return count;
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  async appendAuditRecord(record: AuditRecord): Promise<void> {
    const key = `${this.#prefix}audit`;
    await this.#client.lpush(key, JSON.stringify(record));
    await this.#client.ltrim(key, 0, this.#maxAuditRecords - 1);
  }

  async queryAuditRecords(filter?: AuditStorageFilter): Promise<readonly AuditRecord[]> {
    const key = `${this.#prefix}audit`;
    const raw = await this.#client.lrange(key, 0, -1);
    let records = raw.map((r) => JSON.parse(r) as AuditRecord);

    // Records are stored newest-first in Redis; reverse for ascending order.
    records.reverse();

    if (filter !== undefined) {
      records = records.filter((record) => {
        if (filter.agentId !== undefined && record.agentId !== filter.agentId) return false;
        if (filter.action !== undefined && record.action !== filter.action) return false;
        if (filter.outcome !== undefined && record.outcome !== filter.outcome) return false;
        if (filter.protocol !== undefined && record.protocol !== filter.protocol) return false;
        if (filter.since !== undefined && record.timestamp < filter.since) return false;
        if (filter.until !== undefined && record.timestamp > filter.until) return false;
        return true;
      });

      if (filter.offset !== undefined && filter.offset > 0) {
        records = records.slice(filter.offset);
      }
      if (filter.limit !== undefined && filter.limit > 0) {
        records = records.slice(0, filter.limit);
      }
    }

    return records;
  }

  async auditRecordCount(): Promise<number> {
    return this.#client.llen(`${this.#prefix}audit`);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    await this.#client.ping();
  }

  async disconnect(): Promise<void> {
    await this.#client.quit();
  }

  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.#client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
