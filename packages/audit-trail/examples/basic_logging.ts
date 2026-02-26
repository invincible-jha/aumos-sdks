// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * basic_logging.ts — Demonstrates core AuditLogger usage.
 *
 * Shows how to:
 * - Create a logger (defaults to in-memory storage)
 * - Log governance decisions (permitted and denied)
 * - Query the log with filters
 * - Count records
 *
 * Run: npx tsx examples/basic_logging.ts
 */

import { AuditLogger } from "../typescript/src/index.js";
import type { AuditFilter } from "../typescript/src/index.js";

async function main(): Promise<void> {
  const logger = new AuditLogger();

  console.log("=== AumOS Audit Trail — Basic Logging Example ===\n");

  // Log a series of governance decisions across two agents.
  const decisions = [
    {
      agentId: "agent-crm-001",
      action: "read_customer_record",
      permitted: true,
      trustLevel: 3,
      requiredLevel: 2,
      reason: "Trust level meets requirement for read access",
    },
    {
      agentId: "agent-crm-001",
      action: "export_customer_data",
      permitted: false,
      trustLevel: 3,
      requiredLevel: 5,
      reason: "Trust level insufficient for bulk data export",
    },
    {
      agentId: "agent-crm-001",
      action: "send_email",
      permitted: true,
      trustLevel: 3,
      requiredLevel: 3,
      budgetUsed: 0.02,
      budgetRemaining: 9.98,
      reason: "Action permitted within budget",
    },
    {
      agentId: "agent-billing-002",
      action: "read_invoice",
      permitted: true,
      trustLevel: 4,
      requiredLevel: 2,
      metadata: { invoiceId: "INV-2026-0042" },
    },
    {
      agentId: "agent-billing-002",
      action: "issue_refund",
      permitted: false,
      trustLevel: 4,
      requiredLevel: 6,
      reason: "Refund issuance requires maximum trust level",
      metadata: { amount: 150.0, currency: "USD" },
    },
  ];

  console.log("Logging decisions...");
  const records = [];
  for (const decision of decisions) {
    const record = await logger.log(decision);
    records.push(record);
    const status = record.permitted ? "PERMITTED" : "DENIED  ";
    console.log(`  [${status}] ${record.agentId} -> ${record.action} | hash: ${record.recordHash.slice(0, 16)}...`);
  }

  const totalCount = await logger.count();
  console.log(`\nTotal records: ${totalCount}`);

  // Query all denied decisions.
  console.log("\n--- Denied decisions ---");
  const deniedFilter: AuditFilter = { permitted: false };
  const denied = await logger.query(deniedFilter);
  for (const record of denied) {
    console.log(`  ${record.agentId} -> ${record.action}: ${record.reason ?? "no reason"}`);
  }

  // Query decisions for a specific agent.
  console.log("\n--- Decisions for agent-crm-001 ---");
  const agentFilter: AuditFilter = { agentId: "agent-crm-001" };
  const agentRecords = await logger.query(agentFilter);
  for (const record of agentRecords) {
    console.log(`  [${record.permitted ? "OK" : "NO"}] ${record.action}`);
  }

  // Show the first record's full structure.
  console.log("\n--- First record (full) ---");
  const firstRecord = records[0];
  if (firstRecord !== undefined) {
    console.log(JSON.stringify(firstRecord, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error("Error:", error);
  process.exit(1);
});
