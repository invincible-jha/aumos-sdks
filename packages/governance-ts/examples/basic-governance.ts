// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * basic-governance.ts
 *
 * Demonstrates the core @aumos/governance workflow:
 *   1. Configure and instantiate GovernanceEngine.
 *   2. Manually assign trust levels to agents.
 *   3. Create spending budgets per action category.
 *   4. Evaluate actions and inspect decisions.
 *   5. Query the audit log for a historical view.
 *
 * Run: npx tsx examples/basic-governance.ts
 */

import {
  GovernanceEngine,
  TrustLevel,
} from '../src/index.js';

async function main(): Promise<void> {
  // --------------------------------------------------------------------------
  // 1. Initialise GovernanceEngine with inline configuration.
  // --------------------------------------------------------------------------
  const engine = new GovernanceEngine({
    trust: {
      defaultLevel: TrustLevel.L0_OBSERVER,
    },
    budget: {
      envelopes: [
        { category: 'communication', limit: 10.00, period: 'daily' },
        { category: 'external_api',  limit: 25.00, period: 'daily' },
        { category: 'data_access',   limit: 5.00,  period: 'hourly' },
      ],
    },
    consent: {
      requireConsent: true,
      defaultPurposes: ['audit', 'monitoring'],
    },
    audit: {
      enabled: true,
      maxRecords: 500,
    },
  });

  const agentId = 'agent:demo-assistant-v1';

  // --------------------------------------------------------------------------
  // 2. Assign a trust level to the agent.
  //    Trust is MANUAL ONLY — there is no auto-promotion pathway.
  // --------------------------------------------------------------------------
  const assignment = engine.trust.setLevel(
    agentId,
    TrustLevel.L3_ACT_APPROVE,
    undefined,
    { reason: 'Approved by platform admin after review.' },
  );
  console.log(
    `Trust assigned: ${assignment.level} (${TrustLevel[assignment.level]}) ` +
    `to ${assignment.agentId}`,
  );

  // --------------------------------------------------------------------------
  // 3. Evaluate a communication action that should be permitted.
  // --------------------------------------------------------------------------
  const emailDecision = await engine.evaluate({
    agentId,
    action: 'send_email',
    category: 'communication',
    requiredTrustLevel: TrustLevel.L3_ACT_APPROVE,
    cost: 0.002,
  });

  console.log('\n--- send_email ---');
  console.log('Permitted:', emailDecision.permitted);
  console.log('Reason:   ', emailDecision.reason);
  console.log('Protocol: ', emailDecision.protocol);

  // --------------------------------------------------------------------------
  // 4. Evaluate an action that requires consent for PII data access.
  //    No consent has been recorded yet — expect denial.
  // --------------------------------------------------------------------------
  const piiDenied = await engine.evaluate({
    agentId,
    action: 'read_customer_profile',
    category: 'data_access',
    requiredTrustLevel: TrustLevel.L2_SUGGEST,
    cost: 0.001,
    dataType: 'pii',
    purpose: 'personalisation',
  });

  console.log('\n--- read_customer_profile (no consent) ---');
  console.log('Permitted:', piiDenied.permitted);
  console.log('Reason:   ', piiDenied.reason);

  // --------------------------------------------------------------------------
  // 5. Record consent, then re-evaluate the same action — expect permit.
  // --------------------------------------------------------------------------
  engine.consent.recordConsent(
    agentId,
    'pii',
    'personalisation',
    'operator:alice',
  );

  const piiPermitted = await engine.evaluate({
    agentId,
    action: 'read_customer_profile',
    category: 'data_access',
    requiredTrustLevel: TrustLevel.L2_SUGGEST,
    cost: 0.001,
    dataType: 'pii',
    purpose: 'personalisation',
  });

  console.log('\n--- read_customer_profile (consent granted) ---');
  console.log('Permitted:', piiPermitted.permitted);
  console.log('Reason:   ', piiPermitted.reason);

  // --------------------------------------------------------------------------
  // 6. Attempt an action that exceeds the trust requirement.
  // --------------------------------------------------------------------------
  const autonomousDenied = await engine.evaluate({
    agentId,
    action: 'deploy_to_production',
    category: 'system',
    requiredTrustLevel: TrustLevel.L5_AUTONOMOUS,
    cost: 0,
  });

  console.log('\n--- deploy_to_production (trust too low) ---');
  console.log('Permitted:', autonomousDenied.permitted);
  console.log('Reason:   ', autonomousDenied.reason);

  // --------------------------------------------------------------------------
  // 7. Inspect the audit log.
  // --------------------------------------------------------------------------
  const allRecords = engine.audit.getRecords();
  console.log(`\nAudit log contains ${allRecords.length} record(s).`);

  const denials = engine.audit.query({ outcome: 'deny' });
  console.log(`Denied decisions: ${denials.length}`);

  const permits = engine.audit.query({ outcome: 'permit' });
  console.log(`Permitted decisions: ${permits.length}`);

  // --------------------------------------------------------------------------
  // 8. Budget utilisation snapshot.
  // --------------------------------------------------------------------------
  const communicationUtilization = engine.budget.getUtilization('communication');
  if (communicationUtilization !== undefined) {
    console.log(
      `\nCommunication budget: $${communicationUtilization.spent.toFixed(4)} / ` +
      `$${communicationUtilization.limit.toFixed(2)} ` +
      `(${communicationUtilization.utilizationPercent.toFixed(1)}% used)`,
    );
  }
}

main().catch((error: unknown) => {
  console.error('Example failed:', error);
  process.exit(1);
});
