// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

import type { AuditFilter, AuditRecord } from "../types.js";
import type { AuditStorage } from "./interface.js";

/**
 * Volatile in-memory storage backend.
 *
 * All records are held in a plain array in insertion order.  Suitable for
 * testing, short-lived processes, and scenarios where persistence is not
 * required.  Data is lost when the process exits.
 */
export class MemoryStorage implements AuditStorage {
  private readonly records: AuditRecord[] = [];

  async append(record: AuditRecord): Promise<void> {
    this.records.push(record);
  }

  async query(filter: AuditFilter): Promise<AuditRecord[]> {
    let results = this.records.slice();

    if (filter.agentId !== undefined) {
      const agentId = filter.agentId;
      results = results.filter((record) => record.agentId === agentId);
    }

    if (filter.action !== undefined) {
      const action = filter.action;
      results = results.filter((record) => record.action === action);
    }

    if (filter.permitted !== undefined) {
      const permitted = filter.permitted;
      results = results.filter((record) => record.permitted === permitted);
    }

    if (filter.startTime !== undefined) {
      const startTime = filter.startTime;
      results = results.filter((record) => record.timestamp >= startTime);
    }

    if (filter.endTime !== undefined) {
      const endTime = filter.endTime;
      results = results.filter((record) => record.timestamp <= endTime);
    }

    const offset = filter.offset ?? 0;
    results = results.slice(offset);

    if (filter.limit !== undefined) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async all(): Promise<AuditRecord[]> {
    return this.records.slice();
  }

  async count(): Promise<number> {
    return this.records.length;
  }
}
