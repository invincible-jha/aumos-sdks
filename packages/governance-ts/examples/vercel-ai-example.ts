// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * vercel-ai-example.ts
 *
 * Demonstrates the `createGovernedAI` Vercel AI SDK governance middleware:
 *   1. Create a governed AI client with trust, budget, and audit config.
 *   2. Run a series of requests — some permitted, some denied.
 *   3. Inspect audit records and remaining budget.
 *   4. Wire governance events via GovernanceEventEmitter.
 *
 * Run: npx tsx examples/vercel-ai-example.ts
 */

import {
  createGovernedAI,
  GovernanceDeniedError,
  GovernanceEventEmitter,
  EVENT_DECISION,
  EVENT_BUDGET_WARNING,
} from '../src/index.js';

import type {
  GovernanceDecisionEventPayload,
  GovernanceBudgetWarningEventPayload,
} from '../src/index.js';

async function main(): Promise<void> {
  console.log('=== AumOS Vercel AI Governance Middleware Example ===\n');

  // --------------------------------------------------------------------------
  // 1. Set up a typed event emitter for governance lifecycle events.
  // --------------------------------------------------------------------------
  const emitter = new GovernanceEventEmitter();

  emitter.on(EVENT_DECISION, (payload: GovernanceDecisionEventPayload) => {
    const icon = payload.allowed ? '[PERMIT]' : '[DENY]';
    console.log(`  ${icon} protocol=${payload.protocol} trust=${payload.trustLevel} reason="${payload.reason}"`);
  });

  emitter.on(EVENT_BUDGET_WARNING, (payload: GovernanceBudgetWarningEventPayload) => {
    console.log(
      `  [BUDGET WARNING] ${payload.budgetType} at ` +
        `${payload.utilizationPercent.toFixed(1)}% — remaining: $${payload.remaining.toFixed(4)}`,
    );
  });

  // --------------------------------------------------------------------------
  // 2. Create a governed AI client.
  //
  //    Trust level 3 (L3_ACT_APPROVE — can act but every action requires
  //    explicit human approval).  Budget caps are intentionally tight to
  //    demonstrate budget denial behaviour.
  // --------------------------------------------------------------------------
  const governed = createGovernedAI({
    trustLevel: 3,
    budget: {
      daily: 1.00,        // $1.00 USD per day
      hourly: 0.25,       // $0.25 USD per clock-hour
      perRequest: 0.05,   // $0.05 USD per individual request
    },
    audit: true,
    onDeny: 'return_empty',
  });

  console.log('--- Request 1: small request within all limits ---');
  const result1 = await governed.beforeRequest({
    model: 'gpt-4o-mini',
    maxTokens: 256,
    prompt: 'Summarise the AumOS governance framework in one sentence.',
  });

  emitter.emit(EVENT_DECISION, {
    allowed: result1.allowed,
    protocol: 'AEAP',
    trustLevel: result1.trustLevel,
    timestamp: new Date().toISOString(),
    reason: result1.denialReason ?? 'Budget and trust checks passed.',
  });

  console.log(`  allowed=${result1.allowed}  budgetRemaining=$${result1.budgetRemaining?.toFixed(4) ?? 'N/A'}`);
  console.log(`  auditRecordId=${result1.auditRecordId}\n`);

  // --------------------------------------------------------------------------
  // 3. Second request — still within limits.
  // --------------------------------------------------------------------------
  console.log('--- Request 2: medium request approaching limits ---');
  const result2 = await governed.beforeRequest({
    model: 'gpt-4o',
    maxTokens: 2048,
    prompt: 'Explain the difference between L3_ACT_APPROVE and L4_ACT_REPORT trust levels.',
  });

  emitter.emit(EVENT_DECISION, {
    allowed: result2.allowed,
    protocol: 'AEAP',
    trustLevel: result2.trustLevel,
    timestamp: new Date().toISOString(),
    reason: result2.denialReason ?? 'Budget and trust checks passed.',
  });

  console.log(`  allowed=${result2.allowed}  budgetRemaining=$${result2.budgetRemaining?.toFixed(4) ?? 'N/A'}\n`);

  // --------------------------------------------------------------------------
  // 4. Third request — designed to exceed the per-request cap.
  //    With onDeny='return_empty' we get back a denied result rather than
  //    a thrown error.
  // --------------------------------------------------------------------------
  console.log('--- Request 3: large request exceeding per-request cap ---');
  const result3 = await governed.beforeRequest({
    model: 'gpt-4o',
    maxTokens: 8000,    // Will exceed the $0.05 perRequest cap
    prompt: 'Write a 5,000 word essay on AI governance frameworks.',
  });

  emitter.emit(EVENT_DECISION, {
    allowed: result3.allowed,
    protocol: 'AEAP',
    trustLevel: result3.trustLevel,
    timestamp: new Date().toISOString(),
    reason: result3.denialReason ?? 'Budget and trust checks passed.',
  });

  console.log(`  allowed=${result3.allowed}  denialReason="${result3.denialReason ?? '—'}"\n`);

  // --------------------------------------------------------------------------
  // 5. Demonstrate 'throw' mode with error handling.
  // --------------------------------------------------------------------------
  console.log('--- Request 4: throw-mode client with budget exceeded ---');
  const throwingClient = createGovernedAI({
    trustLevel: 2,
    budget: { perRequest: 0.0001 },  // Very low cap — virtually any request fails
    audit: true,
    onDeny: 'throw',
  });

  try {
    await throwingClient.beforeRequest({
      model: 'gpt-4o',
      maxTokens: 512,
      prompt: 'Hello.',
    });
    console.log('  Request permitted (unexpected).\n');
  } catch (error: unknown) {
    if (error instanceof GovernanceDeniedError) {
      console.log(`  Caught GovernanceDeniedError: code=${error.code}`);
      console.log(`  Message: "${error.message}"\n`);
    } else {
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // 6. Budget warning event — simulate low remaining budget.
  // --------------------------------------------------------------------------
  console.log('--- Budget warning emission ---');
  emitter.emit(EVENT_BUDGET_WARNING, {
    budgetType: 'hourly',
    limit: 0.25,
    spent: 0.22,
    remaining: 0.03,
    utilizationPercent: 88,
    timestamp: new Date().toISOString(),
  });

  // --------------------------------------------------------------------------
  // 7. Inspect the audit log.
  // --------------------------------------------------------------------------
  const auditLog = governed.getAuditLog();
  console.log(`\n--- Audit log: ${auditLog.length} record(s) ---`);
  for (const record of auditLog) {
    const status = record.allowed ? 'PERMIT' : 'DENY';
    console.log(
      `  [${status}] id=${record.id.slice(0, 8)}… ` +
        `cost=$${record.estimatedCost.toFixed(6)} ` +
        `trust=${record.trustLevel}`,
    );
  }

  // --------------------------------------------------------------------------
  // 8. Demonstrate GovernanceEventEmitter .once() and listenerCount().
  // --------------------------------------------------------------------------
  console.log('\n--- Event emitter: once() and listenerCount() ---');
  const onceEmitter = new GovernanceEventEmitter();
  let fireCount = 0;

  onceEmitter.once(EVENT_DECISION, () => {
    fireCount += 1;
  });

  console.log(`  Listeners before emit: ${onceEmitter.listenerCount(EVENT_DECISION)}`);

  onceEmitter.emit(EVENT_DECISION, {
    allowed: true,
    protocol: 'TEST',
    trustLevel: 1,
    timestamp: new Date().toISOString(),
    reason: 'once() test',
  });

  console.log(`  Listeners after first emit: ${onceEmitter.listenerCount(EVENT_DECISION)}`);
  console.log(`  Fire count: ${fireCount} (expected 1)`);

  onceEmitter.emit(EVENT_DECISION, {
    allowed: true,
    protocol: 'TEST',
    trustLevel: 1,
    timestamp: new Date().toISOString(),
    reason: 'once() test — second emission',
  });

  console.log(`  Fire count after second emit: ${fireCount} (expected 1, once listener removed)\n`);

  console.log('=== Example complete ===');
}

main().catch((error: unknown) => {
  console.error('Example failed:', error);
  process.exit(1);
});
