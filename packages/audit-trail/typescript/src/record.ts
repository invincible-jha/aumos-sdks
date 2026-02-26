// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

import type { AuditRecord, GovernanceDecisionInput } from "./types.js";

/**
 * Generate a cryptographically random UUID v4 without external dependencies.
 * Uses the Web Crypto API available in Node.js >= 19 and all modern browsers.
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Return the current UTC time as an ISO 8601 string with millisecond precision.
 */
function currentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Build the intermediate record object that the hash chain will sign.
 *
 * Only fields present in `input` are included — absent optional fields are
 * omitted entirely from the object so the canonical JSON stays compact and
 * the hash is computed only over data that exists.
 *
 * The `recordHash` field is intentionally absent — `HashChain.append` fills
 * it in after computing the digest.
 */
export function buildPendingRecord(
  input: GovernanceDecisionInput,
  previousHash: string,
  id?: string,
  timestamp?: string,
): Omit<AuditRecord, "recordHash"> {
  // Build the required fields first.
  const base = {
    id: id ?? generateId(),
    timestamp: timestamp ?? currentTimestamp(),
    agentId: input.agentId,
    action: input.action,
    permitted: input.permitted,
    previousHash,
  };

  // Spread optional fields only when they have a value so the canonical JSON
  // does not contain undefined-keyed entries that serialise differently across
  // runtimes.
  return {
    ...base,
    ...(input.trustLevel !== undefined && { trustLevel: input.trustLevel }),
    ...(input.requiredLevel !== undefined && { requiredLevel: input.requiredLevel }),
    ...(input.budgetUsed !== undefined && { budgetUsed: input.budgetUsed }),
    ...(input.budgetRemaining !== undefined && { budgetRemaining: input.budgetRemaining }),
    ...(input.reason !== undefined && { reason: input.reason }),
    ...(input.metadata !== undefined && { metadata: input.metadata }),
  } as Omit<AuditRecord, "recordHash">;
}

/**
 * Attach the computed `recordHash` to an otherwise complete pending record,
 * producing a fully-formed, immutable AuditRecord.
 */
export function finaliseRecord(
  pending: Omit<AuditRecord, "recordHash">,
  recordHash: string,
): AuditRecord {
  return { ...pending, recordHash } as AuditRecord;
}
