// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

import type { AuditFilter, AuditRecord } from "../types.js";

/**
 * Contract that every storage backend must satisfy.
 * Implementations must guarantee append-only semantics — records written
 * through `append` must never be altered or deleted by the storage layer.
 */
export interface AuditStorage {
  /**
   * Persist a fully-formed audit record. Called after the hash chain has
   * already computed and embedded the record hash.
   */
  append(record: AuditRecord): Promise<void>;

  /**
   * Return records matching the given filter, in ascending timestamp order.
   */
  query(filter: AuditFilter): Promise<AuditRecord[]>;

  /**
   * Return every record in the store, in ascending timestamp order.
   * Equivalent to `query({})` but semantically distinct — callers use this
   * when they genuinely need the full corpus (e.g. chain verification).
   */
  all(): Promise<AuditRecord[]>;

  /**
   * Return the total number of records in the store.
   */
  count(): Promise<number>;
}
