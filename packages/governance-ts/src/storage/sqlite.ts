// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { TrustAssignment, SpendingEnvelope, ConsentRecord } from '../types.js';
import type { AuditRecord } from '../audit/record.js';
import type { StorageAdapter, AuditStorageFilter } from './adapter.js';

/**
 * Minimal SQLite database interface.
 *
 * This avoids a hard dependency on any specific SQLite library.  Callers
 * provide a database instance that satisfies this contract — better-sqlite3,
 * sql.js, and Cloudflare D1 all expose compatible patterns.
 */
export interface SQLiteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): SQLiteStatementLike;
  close(): void;
}

export interface SQLiteStatementLike {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

/** Configuration for the SQLite storage adapter. */
export interface SQLiteStorageConfig {
  /** A SQLite database instance satisfying the SQLiteDatabaseLike interface. */
  database: SQLiteDatabaseLike;
  /** Table name prefix. Defaults to "aumos_". */
  tablePrefix?: string;
}

/**
 * SQLite-backed implementation of StorageAdapter.
 *
 * Provides durable, file-based persistence suitable for development,
 * edge deployments (via sql.js or Cloudflare D1), and single-node
 * production deployments.
 *
 * Table schema:
 *   {prefix}trust_assignments   — trust state
 *   {prefix}spending_envelopes  — budget state
 *   {prefix}consent_records     — consent grants
 *   {prefix}audit_records       — governance audit trail
 */
export class SQLiteStorageAdapter implements StorageAdapter {
  readonly #db: SQLiteDatabaseLike;
  readonly #prefix: string;

  constructor(config: SQLiteStorageConfig) {
    this.#db = config.database;
    this.#prefix = config.tablePrefix ?? 'aumos_';
  }

  #table(name: string): string {
    return `${this.#prefix}${name}`;
  }

  // -------------------------------------------------------------------------
  // Trust
  // -------------------------------------------------------------------------

  async setTrustAssignment(key: string, assignment: TrustAssignment): Promise<void> {
    const table = this.#table('trust_assignments');
    this.#db.prepare(
      `INSERT OR REPLACE INTO ${table} (key, data) VALUES (?, ?)`,
    ).run(key, JSON.stringify(assignment));
  }

  async getTrustAssignment(key: string): Promise<TrustAssignment | undefined> {
    const table = this.#table('trust_assignments');
    const row = this.#db.prepare(
      `SELECT data FROM ${table} WHERE key = ?`,
    ).get(key);
    if (row === undefined) return undefined;
    return JSON.parse(row['data'] as string) as TrustAssignment;
  }

  async listTrustAssignments(): Promise<readonly TrustAssignment[]> {
    const table = this.#table('trust_assignments');
    const rows = this.#db.prepare(`SELECT data FROM ${table}`).all();
    return rows.map((r) => JSON.parse(r['data'] as string) as TrustAssignment);
  }

  // -------------------------------------------------------------------------
  // Budget
  // -------------------------------------------------------------------------

  async setSpendingEnvelope(category: string, envelope: SpendingEnvelope): Promise<void> {
    const table = this.#table('spending_envelopes');
    this.#db.prepare(
      `INSERT OR REPLACE INTO ${table} (category, data) VALUES (?, ?)`,
    ).run(category, JSON.stringify(envelope));
  }

  async getSpendingEnvelope(category: string): Promise<SpendingEnvelope | undefined> {
    const table = this.#table('spending_envelopes');
    const row = this.#db.prepare(
      `SELECT data FROM ${table} WHERE category = ?`,
    ).get(category);
    if (row === undefined) return undefined;
    return JSON.parse(row['data'] as string) as SpendingEnvelope;
  }

  async listSpendingEnvelopes(): Promise<readonly SpendingEnvelope[]> {
    const table = this.#table('spending_envelopes');
    const rows = this.#db.prepare(`SELECT data FROM ${table}`).all();
    return rows.map((r) => JSON.parse(r['data'] as string) as SpendingEnvelope);
  }

  // -------------------------------------------------------------------------
  // Consent
  // -------------------------------------------------------------------------

  async addConsentRecord(record: ConsentRecord): Promise<void> {
    const table = this.#table('consent_records');
    this.#db.prepare(
      `INSERT INTO ${table} (id, agent_id, data_type, purpose, active, data) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(record.id, record.agentId, record.dataType, record.purpose, record.active ? 1 : 0, JSON.stringify(record));
  }

  async getConsentRecords(agentId: string): Promise<readonly ConsentRecord[]> {
    const table = this.#table('consent_records');
    const rows = this.#db.prepare(
      `SELECT data FROM ${table} WHERE agent_id = ? ORDER BY rowid ASC`,
    ).all(agentId);
    return rows.map((r) => JSON.parse(r['data'] as string) as ConsentRecord);
  }

  async revokeConsentRecords(
    agentId: string,
    dataType: string,
    purpose?: string,
  ): Promise<number> {
    const table = this.#table('consent_records');

    // Fetch matching active records
    const whereClause = purpose !== undefined
      ? `agent_id = ? AND data_type = ? AND purpose = ? AND active = 1`
      : `agent_id = ? AND data_type = ? AND active = 1`;
    const params: unknown[] = purpose !== undefined
      ? [agentId, dataType, purpose]
      : [agentId, dataType];

    const rows = this.#db.prepare(
      `SELECT id, data FROM ${table} WHERE ${whereClause}`,
    ).all(...params);

    let count = 0;
    for (const row of rows) {
      const record = JSON.parse(row['data'] as string) as ConsentRecord;
      const updated = { ...record, active: false };
      this.#db.prepare(
        `UPDATE ${table} SET active = 0, data = ? WHERE id = ?`,
      ).run(JSON.stringify(updated), row['id']);
      count++;
    }

    return count;
  }

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------

  async appendAuditRecord(record: AuditRecord): Promise<void> {
    const table = this.#table('audit_records');
    this.#db.prepare(
      `INSERT INTO ${table} (id, agent_id, action, outcome, protocol, timestamp, data) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(record.id, record.agentId, record.action, record.outcome, record.protocol, record.timestamp, JSON.stringify(record));
  }

  async queryAuditRecords(filter?: AuditStorageFilter): Promise<readonly AuditRecord[]> {
    const table = this.#table('audit_records');
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.agentId !== undefined) {
      conditions.push('agent_id = ?');
      params.push(filter.agentId);
    }
    if (filter?.action !== undefined) {
      conditions.push('action = ?');
      params.push(filter.action);
    }
    if (filter?.outcome !== undefined) {
      conditions.push('outcome = ?');
      params.push(filter.outcome);
    }
    if (filter?.protocol !== undefined) {
      conditions.push('protocol = ?');
      params.push(filter.protocol);
    }
    if (filter?.since !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filter.since);
    }
    if (filter?.until !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(filter.until);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit !== undefined ? `LIMIT ${filter.limit}` : '';
    const offset = filter?.offset !== undefined ? `OFFSET ${filter.offset}` : '';

    const rows = this.#db.prepare(
      `SELECT data FROM ${table} ${where} ORDER BY rowid ASC ${limit} ${offset}`,
    ).all(...params);

    return rows.map((r) => JSON.parse(r['data'] as string) as AuditRecord);
  }

  async auditRecordCount(): Promise<number> {
    const table = this.#table('audit_records');
    const row = this.#db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
    return (row?.['count'] as number) ?? 0;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    const prefix = this.#prefix;

    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS ${prefix}trust_assignments (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ${prefix}spending_envelopes (
        category TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ${prefix}consent_records (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        data_type TEXT NOT NULL,
        purpose TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${prefix}consent_agent ON ${prefix}consent_records(agent_id);
      CREATE INDEX IF NOT EXISTS idx_${prefix}consent_active ON ${prefix}consent_records(agent_id, data_type, active);
      CREATE TABLE IF NOT EXISTS ${prefix}audit_records (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        protocol TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${prefix}audit_agent ON ${prefix}audit_records(agent_id);
      CREATE INDEX IF NOT EXISTS idx_${prefix}audit_timestamp ON ${prefix}audit_records(timestamp);
      CREATE INDEX IF NOT EXISTS idx_${prefix}audit_outcome ON ${prefix}audit_records(outcome);
    `);
  }

  async disconnect(): Promise<void> {
    this.#db.close();
  }

  async isHealthy(): Promise<boolean> {
    try {
      this.#db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }
}
