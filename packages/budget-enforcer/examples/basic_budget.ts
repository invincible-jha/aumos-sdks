// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * basic_budget.ts
 *
 * Demonstrates the minimal loop for budget-gated AI agent calls:
 *   1. Create an enforcer and one envelope.
 *   2. Check before spending.
 *   3. Record after the operation completes.
 *   4. Inspect utilization at the end.
 *
 * Run with:  npx tsx examples/basic_budget.ts
 */

import { BudgetEnforcer } from '../typescript/src/index.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

const enforcer = new BudgetEnforcer({ namespace: 'example-agent' });

enforcer.createEnvelope({
  category: 'llm-calls',
  limit: 1.00,   // USD 1.00 per day
  period: 'daily',
});

// ─── Simulate a sequence of LLM calls ─────────────────────────────────────────

const callCosts = [0.02, 0.05, 0.03, 0.08, 0.50, 0.40, 0.10];
let callNumber = 0;

for (const cost of callCosts) {
  callNumber += 1;

  const checkResult = enforcer.check('llm-calls', cost);

  if (!checkResult.permitted) {
    console.log(
      `Call ${callNumber}: DENIED  $${cost.toFixed(4)}  ` +
      `reason=${checkResult.reason}  available=$${checkResult.available.toFixed(4)}`,
    );
    continue;
  }

  // Simulate the LLM call here — we use a stub.
  const _response = `[LLM response for call ${callNumber}]`;

  enforcer.record('llm-calls', cost, `Simulated call ${callNumber}`);
  console.log(
    `Call ${callNumber}: RECORDED $${cost.toFixed(4)}  ` +
    `available_after=$${enforcer.utilization('llm-calls').available.toFixed(4)}`,
  );
}

// ─── Final utilization snapshot ───────────────────────────────────────────────

const utilization = enforcer.utilization('llm-calls');

console.log('\n── Budget summary ────────────────────────────────────');
console.log(`  Category    : ${utilization.category}`);
console.log(`  Period      : ${utilization.period}`);
console.log(`  Limit       : $${utilization.limit.toFixed(2)}`);
console.log(`  Spent       : $${utilization.spent.toFixed(4)}`);
console.log(`  Committed   : $${utilization.committed.toFixed(4)}`);
console.log(`  Available   : $${utilization.available.toFixed(4)}`);
console.log(`  Utilization : ${utilization.utilizationPercent.toFixed(1)}%`);
console.log('──────────────────────────────────────────────────────');

// ─── Transaction log ──────────────────────────────────────────────────────────

const transactions = enforcer.getTransactions({ category: 'llm-calls' });
console.log(`\n${transactions.length} transactions recorded:`);
for (const transaction of transactions) {
  console.log(`  [${transaction.id.slice(0, 8)}] $${transaction.amount.toFixed(4)}  ${transaction.description ?? ''}`);
}
