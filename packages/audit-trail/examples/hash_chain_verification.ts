// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * hash_chain_verification.ts — Demonstrates hash chain integrity verification.
 *
 * Shows how to:
 * - Build a chain of records
 * - Verify the chain passes when records are unmodified
 * - Detect tampering when a record is altered
 * - Understand the verification result structure
 *
 * Run: npx tsx examples/hash_chain_verification.ts
 */

import { AuditLogger, HashChain } from "../typescript/src/index.js";
import type { AuditRecord, ChainVerificationResult } from "../typescript/src/index.js";

function printVerificationResult(result: ChainVerificationResult): void {
  if (result.valid) {
    console.log(`  VALID — ${result.recordCount} records verified`);
  } else {
    console.log(`  INVALID — chain broken at index ${result.brokenAt}`);
    console.log(`  Reason: ${result.reason}`);
  }
}

async function main(): Promise<void> {
  console.log("=== AumOS Audit Trail — Hash Chain Verification Example ===\n");

  const logger = new AuditLogger();

  // Build a chain of records.
  const agentId = "agent-finance-001";
  const actions = [
    { action: "authenticate", permitted: true, trustLevel: 1, requiredLevel: 1 },
    { action: "read_balance", permitted: true, trustLevel: 2, requiredLevel: 2 },
    { action: "initiate_transfer", permitted: true, trustLevel: 4, requiredLevel: 4, budgetUsed: 5.0, budgetRemaining: 95.0 },
    { action: "approve_large_transfer", permitted: false, trustLevel: 4, requiredLevel: 6, reason: "Requires elevated trust" },
    { action: "read_statement", permitted: true, trustLevel: 4, requiredLevel: 2 },
  ];

  console.log("Building chain with 5 records...");
  for (const decision of actions) {
    await logger.log({ agentId, ...decision });
  }

  // Step 1: verify the intact chain.
  console.log("\n[Step 1] Verifying intact chain:");
  const intactResult = await logger.verify();
  printVerificationResult(intactResult);

  // Step 2: demonstrate low-level HashChain.verify with tampered data.
  // We manually alter a field on a copy of a record to simulate tampering.
  const allRecords = await logger.query({});

  // Clone the records and mutate index 2 (initiate_transfer decision).
  const tamperedRecords: AuditRecord[] = allRecords.map((record, index) => {
    if (index === 2) {
      // An attacker attempts to change permitted from true to false.
      return { ...record, permitted: false } as AuditRecord;
    }
    return record;
  });

  console.log("\n[Step 2] Verifying tampered chain (record 2 mutated — permitted flipped):");
  const chain = new HashChain();
  const tamperedResult = chain.verify(tamperedRecords);
  printVerificationResult(tamperedResult);

  // Step 3: demonstrate detecting a deleted record (gap in previousHash chain).
  const recordsWithGap: AuditRecord[] = [
    allRecords[0]!,
    allRecords[1]!,
    // Record index 2 is missing — record index 3's previousHash won't match.
    allRecords[3]!,
    allRecords[4]!,
  ];

  console.log("\n[Step 3] Verifying chain with missing record (gap at index 2):");
  const gapResult = chain.verify(recordsWithGap);
  printVerificationResult(gapResult);

  // Step 4: show hash linkage visually.
  console.log("\n[Step 4] Hash linkage for first 3 records:");
  for (let i = 0; i < 3; i++) {
    const record = allRecords[i];
    if (record === undefined) continue;
    const prevDisplay = record.previousHash === "0".repeat(64) ? "(genesis)" : record.previousHash.slice(0, 16) + "...";
    console.log(`  Record ${i}: ${record.action}`);
    console.log(`    previousHash: ${prevDisplay}`);
    console.log(`    recordHash:   ${record.recordHash.slice(0, 32)}...`);
  }
}

main().catch((error: unknown) => {
  console.error("Error:", error);
  process.exit(1);
});
