// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

import { createHash } from "node:crypto";
import { finaliseRecord } from "./record.js";
import type { AuditRecord, ChainVerificationResult } from "./types.js";

/**
 * The hash value that precedes the very first record in any chain.
 * Using 64 zero hex characters mirrors the Bitcoin genesis block convention
 * and makes the genesis condition explicit and detectable.
 */
const GENESIS_HASH = "0".repeat(64);

/**
 * Deterministically serialise a pending record (without its own hash) into
 * a canonical JSON string suitable for hashing.
 *
 * Keys are sorted alphabetically so that two objects with the same fields in
 * different insertion orders produce identical digests.  This protects against
 * subtle chain breaks caused by non-deterministic serialisation.
 */
function canonicalise(record: Omit<AuditRecord, "recordHash">): string {
  const sortedKeys = Object.keys(record).sort() as Array<keyof typeof record>;
  const ordered: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    ordered[key] = record[key];
  }
  return JSON.stringify(ordered);
}

/**
 * Compute a SHA-256 digest over the canonical serialisation of a pending record
 * combined with the previous record's hash.
 *
 * The input is: `<canonicalJSON>\n<previousHash>`
 * The newline separator ensures the two fields cannot overlap.
 */
function computeHash(
  pendingRecord: Omit<AuditRecord, "recordHash">,
  previousHash: string,
): string {
  const payload = canonicalise(pendingRecord) + "\n" + previousHash;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Maintains the running hash state of an append-only audit log.
 *
 * Each record is linked to its predecessor via a SHA-256 hash, making
 * retrospective tampering detectable — any modification to a record
 * invalidates every subsequent hash in the chain.
 *
 * Thread safety: this class is not thread-safe.  In multi-threaded environments
 * callers must serialise calls to `append`.
 */
export class HashChain {
  private lastRecordHash: string;

  constructor(initialHash?: string) {
    this.lastRecordHash = initialHash ?? GENESIS_HASH;
  }

  /**
   * Link a new pending record into the chain.
   *
   * Computes the SHA-256 digest of the record payload combined with the
   * previous hash, stores the new hash as the chain tip, and returns the
   * completed AuditRecord with `recordHash` populated.
   */
  append(record: Omit<AuditRecord, "recordHash">): AuditRecord {
    const hash = computeHash(record, this.lastRecordHash);
    this.lastRecordHash = hash;
    return finaliseRecord(record, hash);
  }

  /**
   * Walk every record in `records` from index 0 and re-derive each expected
   * hash from scratch, comparing it against the stored `recordHash`.
   *
   * A verification failure at index `i` means that either record `i` was
   * altered, or the chain was seeded with a different genesis hash.
   *
   * @returns `{ valid: true, recordCount }` when the chain is intact, or
   *          `{ valid: false, brokenAt, reason, recordCount }` at the first
   *          detected discrepancy.
   */
  verify(records: AuditRecord[]): ChainVerificationResult {
    let expectedPreviousHash = GENESIS_HASH;

    for (let index = 0; index < records.length; index++) {
      const record = records[index]!;

      // Verify the previousHash link.
      if (record.previousHash !== expectedPreviousHash) {
        return {
          valid: false,
          recordCount: records.length,
          brokenAt: index,
          reason: `Record at index ${index} has previousHash "${record.previousHash}" but expected "${expectedPreviousHash}".`,
        };
      }

      // Reconstruct the pending record (everything except recordHash) and
      // re-compute the digest.
      const { recordHash: _storedHash, ...pending } = record;
      const expectedHash = computeHash(pending, expectedPreviousHash);

      if (record.recordHash !== expectedHash) {
        return {
          valid: false,
          recordCount: records.length,
          brokenAt: index,
          reason: `Record at index ${index} (id="${record.id}") has hash "${record.recordHash}" but recomputed hash is "${expectedHash}". Record content may have been altered.`,
        };
      }

      expectedPreviousHash = record.recordHash;
    }

    return { valid: true, recordCount: records.length };
  }

  /**
   * Return the hash of the most recently appended record, or the genesis hash
   * when no records have been appended yet.
   */
  lastHash(): string {
    return this.lastRecordHash;
  }
}
