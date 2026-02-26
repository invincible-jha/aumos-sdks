// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

import type { AuditFilter, AuditRecord } from "./types.js";
import type { AuditStorage } from "./storage/interface.js";

/**
 * Thin query facade that wraps a storage backend and exposes a typed,
 * filter-driven query API.
 *
 * Keeping query logic separate from the logger class makes it easier to
 * compose — callers can construct an AuditQuery against any storage backend
 * without going through the full AuditLogger.
 */
export class AuditQuery {
  private readonly storage: AuditStorage;

  constructor(storage: AuditStorage) {
    this.storage = storage;
  }

  /**
   * Return records matching all supplied filter fields.
   * Omitted fields are treated as wildcards — no restriction on that dimension.
   */
  async find(filter: AuditFilter): Promise<AuditRecord[]> {
    return this.storage.query(filter);
  }

  /**
   * Return records for a specific agent, optionally limited.
   */
  async findByAgent(agentId: string, limit?: number): Promise<AuditRecord[]> {
    return this.storage.query({ agentId, limit });
  }

  /**
   * Return only denied (not permitted) decisions, optionally for a specific agent.
   */
  async findDenied(agentId?: string, limit?: number): Promise<AuditRecord[]> {
    return this.storage.query({ agentId, permitted: false, limit });
  }

  /**
   * Return decisions within a time window.  Both bounds are inclusive ISO 8601
   * strings.  Omit either bound to make the range open-ended.
   */
  async findInTimeRange(
    startTime: string,
    endTime: string,
    filter?: Omit<AuditFilter, "startTime" | "endTime">,
  ): Promise<AuditRecord[]> {
    return this.storage.query({ ...filter, startTime, endTime });
  }

  /**
   * Return the total number of records currently in the store.
   */
  async count(): Promise<number> {
    return this.storage.count();
  }
}
