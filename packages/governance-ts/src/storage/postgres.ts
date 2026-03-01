// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { TrustAssignment, SpendingEnvelope, ConsentRecord } from '../types.js';
import type { AuditRecord } from '../audit/record.js';
import type { StorageAdapter, AuditStorageFilter } from './adapter.js';

/**
 * Minimal Postgres client interface.
 *
 * This avoids a hard dependency on any specific Postgres library.  Callers
 * provide a pool or client instance that satisfies this contract — pg (node-postgres),
 * @vercel/postgres, neon-serverless, and slonik all expose compatible methods.
 */
export interface PostgresClientLike {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  end?(): Promise<void>;
}

/** Configuration for the Postgres storage adapter. */
export interface PostgresStorageConfig {
  /** A Postgres client or pool satisfying the PostgresClientLike interface. */
  client: PostgresClientLike;
  /** Schema name for all governance tables. Defaults to "aumos". */
  schema?: string;
}

/**
 * Postgres-backed implementation of StorageAdapter.
 *
 * Provides durable, queryable persistence suitable for production deployments
 * where audit trail durability, complex queries, and multi-process access
 * are required.
 *
 * Table layout (all within configured schema):
 *   trust_assignments   — trust state (UPSERT by key)
 *   spending_envelopes  — budget state (UPSERT by category)
 *   consent_records     — consent grants (append-only, soft-delete)
 *   audit_records       — governance audit trail (append-only, indexed)
 *
 * All queries use parameterised placeholders ($1, $2, ...) — never string
 * concatenation — per CLAUDE.md security requirements.
 */
export class PostgresStorageAdapter implements StorageAdapter {
  readonly #client: PostgresClientLike;
  readonly #schema: string;

  constructor(config: PostgresStorageConfig) {
    this.#client = config.client;
    this.#schema = config.schema ?? 'aumos';
  }

  #table(name: string): string {
    return `"${this.#schema}"."${name}"`;
  }

  // -------------------------------------------------------------------------
  // Trust
  // -------------------------------------------------------------------------

  async setTrustAssignment(key: string, assignment: TrustAssignment): Promise<void> {
    await this.#client.query(
      `INSERT INTO ${this.#table('trust_assignments')} (key, data)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`,
      [key, JSON.stringify(assignment)],
    );
  }

  async getTrustAssignment(key: string): Promise<TrustAssignment | undefined> {
    const result = await this.#client.query<{ data: string }>(
      `SELECT data FROM ${this.#table('trust_assignments')} WHERE key = $1`,
      [key],
    );
    if (result.rows.length === 0) return undefined;
    return JSON.parse(result.rows[0].data) as TrustAssignment;
  }

  async listTrustAssignments(): Promise<readonly TrustAssignment[]> {
    const result = await this.#client.query<{ data: string }>(
      `SELECT data FROM ${this.#table('trust_assignments')}`,
    );
    return result.rows.map((r) => JSON.parse(r.data) as TrustAssignment);
  }

  // -------------------------------------------------------------------------
  // Budget
  // -------------------------------------------------------------------------

  async setSpendingEnvelope(category: string, envelope: SpendingEnvelope): Promise<void> {
    await this.#client.query(
      `INSERT INTO ${this.#table('spending_envelopes')} (category, data)
       VALUES ($1, $2)
       ON CONFLICT (category) DO UPDATE SET data = EXCLUDED.data`,
      [category, JSON.stringify(envelope)],
    );
  }

  async getSpendingEnvelope(category: string): Promise<SpendingEnvelope | undefined> {
    const result = await this.#client.query<{ data: string }>(
      `SELECT data FROM ${this.#table('spending_envelopes')} WHERE category = $1`,
      [category],
    );
    if (result.rows.length === 0) return undefined;
    return JSON.parse(result.rows[0].data) as SpendingEnvelope;
  }

  async listSpendingEnvelopes(): Promise<readonly SpendingEnvelope[]> {
    const result = await this.#client.query<{ data: string }>(
      `SELECT data FROM ${this.#table('spending_envelopes')}`,
    );
    return result.rows.map((r) => JSON.parse(r.data) as SpendingEnvelope);
  }

  // -------------------------------------------------------------------------
  // Consent
  // -------------------------------------------------------------------------

  async addConsentRecord(record: ConsentRecord): Promise<void> {
    await this.#client.query(
      `INSERT INTO ${this.#table('consent_records')}
       (id, agent_id, data_type, purpose, active, data)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [record.id, record.agentId, record.dataType, record.purpose, record.active, JSON.stringify(record)],
    );
  }

  async getConsentRecords(agentId: string): Promise<readonly ConsentRecord[]> {
    const result = await this.#client.query<{ data: string }>(
      `SELECT data FROM ${this.#table('consent_records')}
       WHERE agent_id = $1
       ORDER BY id ASC`,
      [agentId],
    );
    return result.rows.map((r) => JSON.parse(r.data) as ConsentRecord);
  }

  async revokeConsentRecords(
    agentId: string,
    dataType: string,
    purpose?: string,
  ): Promise<number> {
    const baseQuery = purpose !== undefined
      ? `UPDATE ${this.#table('consent_records')}
         SET active = false, data = jsonb_set(data::jsonb, '{active}', 'false')::text
         WHERE agent_id = $1 AND data_type = $2 AND purpose = $3 AND active = true`
      : `UPDATE ${this.#table('consent_records')}
         SET active = false, data = jsonb_set(data::jsonb, '{active}', 'false')::text
         WHERE agent_id = $1 AND data_type = $2 AND active = true`;

    const params = purpose !== undefined
      ? [agentId, dataType, purpose]
      : [agentId, dataType];

    const result = await this.#client.query(baseQuery, params);
    return result.rowCount ?? 0;
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  async appendAuditRecord(record: AuditRecord): Promise<void> {
    await this.#client.query(
      `INSERT INTO ${this.#table('audit_records')}
       (id, agent_id, action, outcome, protocol, timestamp, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [record.id, record.agentId, record.action, record.outcome, record.protocol, record.timestamp, JSON.stringify(record)],
    );
  }

  async queryAuditRecords(filter?: AuditStorageFilter): Promise<readonly AuditRecord[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filter?.agentId !== undefined) {
      conditions.push(`agent_id = $${paramIndex++}`);
      params.push(filter.agentId);
    }
    if (filter?.action !== undefined) {
      conditions.push(`action = $${paramIndex++}`);
      params.push(filter.action);
    }
    if (filter?.outcome !== undefined) {
      conditions.push(`outcome = $${paramIndex++}`);
      params.push(filter.outcome);
    }
    if (filter?.protocol !== undefined) {
      conditions.push(`protocol = $${paramIndex++}`);
      params.push(filter.protocol);
    }
    if (filter?.since !== undefined) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(filter.since);
    }
    if (filter?.until !== undefined) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(filter.until);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit !== undefined ? `LIMIT $${paramIndex++}` : '';
    if (filter?.limit !== undefined) params.push(filter.limit);
    const offset = filter?.offset !== undefined ? `OFFSET $${paramIndex++}` : '';
    if (filter?.offset !== undefined) params.push(filter.offset);

    const result = await this.#client.query<{ data: string }>(
      `SELECT data FROM ${this.#table('audit_records')}
       ${where}
       ORDER BY timestamp ASC
       ${limit} ${offset}`,
      params,
    );

    return result.rows.map((r) => JSON.parse(r.data) as AuditRecord);
  }

  async auditRecordCount(): Promise<number> {
    const result = await this.#client.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${this.#table('audit_records')}`,
    );
    return parseInt(result.rows[0].count, 10);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    const schema = this.#schema;

    await this.#client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

    await this.#client.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".trust_assignments (
        key TEXT PRIMARY KEY,
        data JSONB NOT NULL
      )
    `);

    await this.#client.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".spending_envelopes (
        category TEXT PRIMARY KEY,
        data JSONB NOT NULL
      )
    `);

    await this.#client.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".consent_records (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        data_type TEXT NOT NULL,
        purpose TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        data JSONB NOT NULL
      )
    `);

    await this.#client.query(`
      CREATE INDEX IF NOT EXISTS idx_consent_agent
        ON "${schema}".consent_records(agent_id)
    `);

    await this.#client.query(`
      CREATE INDEX IF NOT EXISTS idx_consent_active
        ON "${schema}".consent_records(agent_id, data_type, active)
    `);

    await this.#client.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".audit_records (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        protocol TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data JSONB NOT NULL
      )
    `);

    await this.#client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_agent
        ON "${schema}".audit_records(agent_id)
    `);

    await this.#client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp
        ON "${schema}".audit_records(timestamp)
    `);

    await this.#client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_outcome
        ON "${schema}".audit_records(outcome)
    `);
  }

  async disconnect(): Promise<void> {
    if (this.#client.end !== undefined) {
      await this.#client.end();
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.#client.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
