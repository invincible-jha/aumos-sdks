// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * multi-agent-governance.ts
 *
 * Demonstrates a multi-agent scenario where:
 *   - A coordinator agent orchestrates a pipeline of specialised sub-agents.
 *   - Each sub-agent has a different trust level and budget envelope.
 *   - The coordinator gates every sub-agent handoff through the engine.
 *   - Consent is scoped per agent, not shared fleet-wide.
 *   - The final audit log shows the full cross-agent decision trail.
 *
 * Run: npx tsx examples/multi-agent-governance.ts
 */

import {
  GovernanceEngine,
  TrustLevel,
  type GovernanceAction,
  type GovernanceDecision,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Agent registry
// ---------------------------------------------------------------------------

interface AgentProfile {
  id: string;
  role: string;
  trustLevel: TrustLevel;
}

const AGENTS: AgentProfile[] = [
  {
    id: 'agent:coordinator',
    role: 'Coordinator',
    trustLevel: TrustLevel.L4_ACT_REPORT,
  },
  {
    id: 'agent:researcher',
    role: 'Researcher',
    trustLevel: TrustLevel.L2_SUGGEST,
  },
  {
    id: 'agent:writer',
    role: 'Content Writer',
    trustLevel: TrustLevel.L3_ACT_APPROVE,
  },
  {
    id: 'agent:executor',
    role: 'Executor',
    trustLevel: TrustLevel.L4_ACT_REPORT,
  },
];

// ---------------------------------------------------------------------------
// Pipeline step definition
// ---------------------------------------------------------------------------

interface PipelineStep {
  agentId: string;
  action: GovernanceAction;
  description: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function printDecision(step: PipelineStep, decision: GovernanceDecision): void {
  const icon = decision.permitted ? 'PERMIT' : 'DENY  ';
  console.log(
    `  [${icon}] ${step.agentId.replace('agent:', '')} -> ${step.action.action}` +
    `  (${decision.protocol})`,
  );
  if (!decision.permitted) {
    console.log(`          Reason: ${decision.reason}`);
  }
}

// ---------------------------------------------------------------------------
// Main demo
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Shared engine for the entire fleet.
  const engine = new GovernanceEngine({
    trust: {
      defaultLevel: TrustLevel.L0_OBSERVER,
      decay: {
        type: 'gradual',
        intervalMs: 3_600_000, // 1 hour review cycle.
      },
    },
    budget: {
      envelopes: [
        { category: 'data_access',      limit: 10.00, period: 'daily' },
        { category: 'content_creation', limit: 20.00, period: 'daily' },
        { category: 'external_api',     limit: 15.00, period: 'daily' },
        { category: 'communication',    limit:  5.00, period: 'daily' },
      ],
    },
    consent: {
      requireConsent: true,
      defaultPurposes: ['audit', 'monitoring', 'pipeline_internal'],
    },
    audit: {
      enabled: true,
      maxRecords: 1_000,
    },
  });

  // ---------------------------------------------------------------------------
  // Provision the agent fleet with trust levels.
  // ---------------------------------------------------------------------------
  console.log('Provisioning agent fleet...\n');
  for (const agent of AGENTS) {
    engine.trust.setLevel(agent.id, agent.trustLevel, undefined, {
      reason: `Initial provisioning for ${agent.role}.`,
      assignedBy: 'policy',
    });
    console.log(`  ${agent.role.padEnd(20)} -> ${TrustLevel[agent.trustLevel]}`);
  }

  // ---------------------------------------------------------------------------
  // Grant consent for specific agents to access sensitive data.
  // ---------------------------------------------------------------------------
  console.log('\nGranting consent records...\n');

  // Researcher can read public-domain data.
  engine.consent.recordConsent('agent:researcher', 'public_data', 'research', 'admin:platform');

  // Executor can access financial data for reporting.
  engine.consent.recordConsent('agent:executor', 'financial', 'reporting', 'admin:platform');

  // Coordinator can access all data types for pipeline oversight.
  for (const dataType of ['public_data', 'financial', 'pii']) {
    engine.consent.recordConsent(
      'agent:coordinator',
      dataType,
      'pipeline_oversight',
      'admin:platform',
    );
  }

  // ---------------------------------------------------------------------------
  // Define pipeline steps.
  // ---------------------------------------------------------------------------
  const pipeline: PipelineStep[] = [
    {
      agentId: 'agent:researcher',
      description: 'Researcher gathers background data (should pass)',
      action: {
        agentId: 'agent:researcher',
        action: 'fetch_public_dataset',
        category: 'data_access',
        requiredTrustLevel: TrustLevel.L2_SUGGEST,
        cost: 0.50,
        dataType: 'public_data',
        purpose: 'research',
      },
    },
    {
      agentId: 'agent:researcher',
      description: 'Researcher tries to read PII (no consent — should deny)',
      action: {
        agentId: 'agent:researcher',
        action: 'read_customer_pii',
        category: 'data_access',
        requiredTrustLevel: TrustLevel.L2_SUGGEST,
        cost: 0.10,
        dataType: 'pii',
        purpose: 'research',
      },
    },
    {
      agentId: 'agent:writer',
      description: 'Writer drafts report content (should pass)',
      action: {
        agentId: 'agent:writer',
        action: 'draft_report_section',
        category: 'content_creation',
        requiredTrustLevel: TrustLevel.L3_ACT_APPROVE,
        cost: 1.50,
      },
    },
    {
      agentId: 'agent:executor',
      description: 'Executor calls payment API (financial consent present, should pass)',
      action: {
        agentId: 'agent:executor',
        action: 'submit_payment_report',
        category: 'external_api',
        requiredTrustLevel: TrustLevel.L4_ACT_REPORT,
        cost: 0.20,
        dataType: 'financial',
        purpose: 'reporting',
      },
    },
    {
      agentId: 'agent:coordinator',
      description: 'Coordinator broadcasts pipeline completion (should pass)',
      action: {
        agentId: 'agent:coordinator',
        action: 'broadcast_completion_notification',
        category: 'communication',
        requiredTrustLevel: TrustLevel.L4_ACT_REPORT,
        cost: 0.002,
      },
    },
    {
      agentId: 'agent:researcher',
      description: 'Researcher tries an L4 action with only L2 trust (should deny)',
      action: {
        agentId: 'agent:researcher',
        action: 'push_autonomous_update',
        category: 'system',
        requiredTrustLevel: TrustLevel.L4_ACT_REPORT,
        cost: 0,
      },
    },
  ];

  // ---------------------------------------------------------------------------
  // Execute pipeline steps through the governance engine.
  // ---------------------------------------------------------------------------
  console.log('\nExecuting pipeline...\n');
  const decisions: GovernanceDecision[] = [];

  for (const step of pipeline) {
    console.log(`  ${step.description}`);
    const decision = await engine.evaluate(step.action);
    decisions.push(decision);
    printDecision(step, decision);

    // Record spend only for permitted decisions that have a cost.
    if (decision.permitted && step.action.cost !== undefined && step.action.cost > 0) {
      engine.budget.recordSpending(
        step.action.category,
        step.action.cost,
        step.action.action,
      );
    }
    console.log('');
  }

  // ---------------------------------------------------------------------------
  // Cross-agent audit report.
  // ---------------------------------------------------------------------------
  console.log('--- Cross-Agent Audit Report ---\n');

  for (const agent of AGENTS) {
    const agentPermits = engine.audit.query({ agentId: agent.id, outcome: 'permit' });
    const agentDenials = engine.audit.query({ agentId: agent.id, outcome: 'deny' });
    console.log(
      `  ${agent.role.padEnd(20)} permits: ${agentPermits.length}  denials: ${agentDenials.length}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Budget utilisation across all categories.
  // ---------------------------------------------------------------------------
  console.log('\n--- Budget Utilisation ---\n');
  for (const util of engine.budget.listUtilizations()) {
    const bar = '='.repeat(Math.round(util.utilizationPercent / 5));
    console.log(
      `  ${util.category.padEnd(20)} [${''.padEnd(20, '-').replace(
        /^.{0,20}/,
        bar.substring(0, 20),
      )}] ${util.utilizationPercent.toFixed(1)}%  ` +
      `$${util.spent.toFixed(3)} / $${util.limit.toFixed(2)}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Total decision counts.
  // ---------------------------------------------------------------------------
  const totalPermits = decisions.filter((d) => d.permitted).length;
  const totalDenials = decisions.filter((d) => !d.permitted).length;
  console.log(`\nPipeline complete. Permits: ${totalPermits}  Denials: ${totalDenials}`);
}

main().catch((error: unknown) => {
  console.error('Example failed:', error);
  process.exit(1);
});
