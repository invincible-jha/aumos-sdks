// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * multi_category.ts
 *
 * Shows an agent with separate envelopes for different cost categories:
 *   - llm-inference  (daily)
 *   - web-search     (hourly)
 *   - storage-writes (monthly)
 *
 * Also demonstrates commit/release for pre-authorising uncertain costs.
 *
 * Run with:  npx tsx examples/multi_category.ts
 */

import { BudgetEnforcer, type BudgetUtilization } from '../typescript/src/index.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

const enforcer = new BudgetEnforcer({ namespace: 'research-agent' });

enforcer.createEnvelope({ category: 'llm-inference', limit: 2.00, period: 'daily' });
enforcer.createEnvelope({ category: 'web-search', limit: 0.50, period: 'hourly' });
enforcer.createEnvelope({ category: 'storage-writes', limit: 5.00, period: 'monthly' });

// ─── Helper ───────────────────────────────────────────────────────────────────

function printUtilization(utilization: BudgetUtilization): void {
  const bar = '='.repeat(Math.round(utilization.utilizationPercent / 5)).padEnd(20, '-');
  console.log(
    `  ${utilization.category.padEnd(16)} [${bar}] ` +
    `${utilization.utilizationPercent.toFixed(1).padStart(5)}%  ` +
    `$${utilization.spent.toFixed(4)} / $${utilization.limit.toFixed(2)}`,
  );
}

// ─── Scenario: multi-step research task ──────────────────────────────────────

type AgentStep = {
  readonly action: string;
  readonly category: string;
  readonly estimatedCost: number;
  readonly actualCost: number;
};

const steps: AgentStep[] = [
  { action: 'Plan research outline',       category: 'llm-inference',  estimatedCost: 0.10, actualCost: 0.08 },
  { action: 'Search: market trends',       category: 'web-search',     estimatedCost: 0.05, actualCost: 0.05 },
  { action: 'Search: competitor analysis', category: 'web-search',     estimatedCost: 0.05, actualCost: 0.05 },
  { action: 'Synthesise search results',   category: 'llm-inference',  estimatedCost: 0.40, actualCost: 0.35 },
  { action: 'Write report draft',          category: 'llm-inference',  estimatedCost: 0.80, actualCost: 0.90 },
  { action: 'Save draft to storage',       category: 'storage-writes', estimatedCost: 0.02, actualCost: 0.02 },
  { action: 'Revise and finalise',         category: 'llm-inference',  estimatedCost: 0.70, actualCost: 0.65 },
];

console.log('── Research agent: multi-category budget enforcement ──\n');

for (const step of steps) {
  // Pre-authorise the estimated cost before starting the step.
  const commitResult = enforcer.commit(step.category, step.estimatedCost);

  if (!commitResult.permitted) {
    console.log(
      `BLOCKED  "${step.action}"  ` +
      `[${step.category}] estimated=$${step.estimatedCost.toFixed(4)}  ` +
      `reason=${commitResult.reason}`,
    );
    continue;
  }

  // Step runs here. Release the commit and record actual cost.
  enforcer.release(commitResult.commitId!);
  const recordResult = enforcer.record(step.category, step.actualCost, step.action);

  console.log(
    `OK       "${step.action}"  ` +
    `[${step.category}] actual=$${step.actualCost.toFixed(4)}  ` +
    `txId=${recordResult.id.slice(0, 8)}`,
  );
}

// ─── Summary across all categories ───────────────────────────────────────────

console.log('\n── Budget utilization ────────────────────────────────');
for (const envelope of enforcer.listEnvelopes()) {
  printUtilization(enforcer.utilization(envelope.category));
}
console.log('──────────────────────────────────────────────────────');

// ─── Per-category transaction counts ─────────────────────────────────────────

console.log('\n── Transactions per category ─────────────────────────');
for (const envelope of enforcer.listEnvelopes()) {
  const transactions = enforcer.getTransactions({ category: envelope.category });
  const total = transactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  console.log(
    `  ${envelope.category.padEnd(16)} ${transactions.length} tx   total=$${total.toFixed(4)}`,
  );
}
