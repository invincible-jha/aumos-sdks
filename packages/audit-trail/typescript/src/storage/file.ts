// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

import { createWriteStream, existsSync, readFileSync, WriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import type { AuditFilter, AuditRecord } from "../types.js";
import type { AuditStorage } from "./interface.js";

/**
 * Append-only file storage backend.
 *
 * Records are stored one JSON object per line (NDJSON / JSON Lines format).
 * The file is opened in append mode on construction and never truncated or
 * rewritten — callers relying on immutability should secure the file with
 * OS-level permissions.
 *
 * Reading always parses the entire file from disk so that the in-process
 * view stays consistent with anything written by concurrent processes.
 */
export class FileStorage implements AuditStorage {
  private readonly filePath: string;
  private readonly writeStream: WriteStream;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.writeStream = createWriteStream(filePath, { flags: "a", encoding: "utf8" });
  }

  async append(record: AuditRecord): Promise<void> {
    const line = JSON.stringify(record) + "\n";
    await new Promise<void>((resolve, reject) => {
      this.writeStream.write(line, (error) => {
        if (error !== null && error !== undefined) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  async query(filter: AuditFilter): Promise<AuditRecord[]> {
    const allRecords = await this.all();
    return applyFilter(allRecords, filter);
  }

  async all(): Promise<AuditRecord[]> {
    if (!existsSync(this.filePath)) {
      return [];
    }

    const content = await readFile(this.filePath, "utf8");
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const records: AuditRecord[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as AuditRecord;
        records.push(parsed);
      } catch {
        // Malformed lines are skipped — the hash chain verifier will catch
        // any gaps caused by corruption.
      }
    }

    return records;
  }

  async count(): Promise<number> {
    const records = await this.all();
    return records.length;
  }

  /**
   * Close the underlying write stream. Call this when the storage is no
   * longer needed to release the file handle.
   */
  close(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.writeStream.end((error: Error | null | undefined) => {
        if (error !== null && error !== undefined) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Read the last line of the file synchronously. Used during construction
   * to restore the chain's last hash without loading the full record set.
   */
  static readLastLineSynchronously(filePath: string): string | null {
    if (!existsSync(filePath)) {
      return null;
    }
    const content = readFileSync(filePath, "utf8");
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return lines.length > 0 ? (lines[lines.length - 1] ?? null) : null;
  }
}

function applyFilter(records: AuditRecord[], filter: AuditFilter): AuditRecord[] {
  let results = records;

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
