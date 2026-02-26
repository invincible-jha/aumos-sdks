// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * mcp-tool-governance.ts
 *
 * Demonstrates how @aumos/governance integrates with an MCP (Model Context
 * Protocol) server to gate tool calls before they are dispatched.
 *
 * Pattern:
 *   - Each MCP tool is mapped to an ActionCategory and a required TrustLevel.
 *   - Before executing a tool, the middleware calls engine.evaluate().
 *   - Denied decisions surface an MCP error response instead of executing.
 *   - Budget is tracked per tool category; trust is per-agent.
 *
 * Run: npx tsx examples/mcp-tool-governance.ts
 */

import {
  GovernanceEngine,
  TrustLevel,
  type GovernanceDecision,
  type ActionCategory,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Simulated MCP tool registry
// ---------------------------------------------------------------------------

interface McpToolDefinition {
  name: string;
  description: string;
  category: ActionCategory;
  requiredTrustLevel: TrustLevel;
  /** Estimated cost per invocation in USD. */
  estimatedCostUsd: number;
  /** Data type accessed (if any). */
  dataType?: string;
}

const TOOL_REGISTRY: Record<string, McpToolDefinition> = {
  send_slack_message: {
    name: 'send_slack_message',
    description: 'Post a message to a Slack channel.',
    category: 'communication',
    requiredTrustLevel: TrustLevel.L3_ACT_APPROVE,
    estimatedCostUsd: 0.001,
  },
  call_external_api: {
    name: 'call_external_api',
    description: 'Make an HTTP request to an external service.',
    category: 'external_api',
    requiredTrustLevel: TrustLevel.L4_ACT_REPORT,
    estimatedCostUsd: 0.005,
  },
  read_pii_record: {
    name: 'read_pii_record',
    description: 'Retrieve a customer PII record from the data warehouse.',
    category: 'data_access',
    requiredTrustLevel: TrustLevel.L3_ACT_APPROVE,
    estimatedCostUsd: 0.002,
    dataType: 'pii',
  },
  generate_report: {
    name: 'generate_report',
    description: 'Generate a content report using the LLM.',
    category: 'content_creation',
    requiredTrustLevel: TrustLevel.L2_SUGGEST,
    estimatedCostUsd: 0.010,
  },
};

// ---------------------------------------------------------------------------
// Simulated MCP middleware
// ---------------------------------------------------------------------------

interface McpToolCall {
  toolName: string;
  agentId: string;
  arguments: Record<string, unknown>;
}

interface McpToolResult {
  success: boolean;
  content?: unknown;
  error?: string;
  governanceDecision: GovernanceDecision;
}

/**
 * Evaluates a tool call through the governance engine before dispatching.
 * Returns an error result immediately on denial without touching the tool.
 */
async function dispatchToolCall(
  engine: GovernanceEngine,
  call: McpToolCall,
): Promise<McpToolResult> {
  const toolDef = TOOL_REGISTRY[call.toolName];
  if (toolDef === undefined) {
    return {
      success: false,
      error: `Unknown tool: "${call.toolName}"`,
      governanceDecision: {
        permitted: false,
        reason: `Tool "${call.toolName}" is not registered.`,
        protocol: 'AUMOS-GOVERNANCE',
        timestamp: new Date().toISOString(),
      },
    };
  }

  // Governance gate.
  const decision = await engine.evaluate({
    agentId: call.agentId,
    action: call.toolName,
    category: toolDef.category,
    requiredTrustLevel: toolDef.requiredTrustLevel,
    cost: toolDef.estimatedCostUsd,
    dataType: toolDef.dataType,
    purpose: toolDef.dataType !== undefined ? 'mcp_tool_execution' : undefined,
    metadata: { toolArguments: call.arguments },
  });

  if (!decision.permitted) {
    return {
      success: false,
      error: decision.reason,
      governanceDecision: decision,
    };
  }

  // Record the spend after the gate passes.
  engine.budget.recordSpending(toolDef.category, toolDef.estimatedCostUsd, call.toolName);

  // Simulate successful tool execution.
  return {
    success: true,
    content: { toolName: call.toolName, executedAt: new Date().toISOString() },
    governanceDecision: decision,
  };
}

// ---------------------------------------------------------------------------
// Main demo
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const engine = new GovernanceEngine({
    trust: {
      defaultLevel: TrustLevel.L0_OBSERVER,
    },
    budget: {
      envelopes: [
        { category: 'communication',    limit: 1.00,  period: 'daily' },
        { category: 'external_api',     limit: 5.00,  period: 'daily' },
        { category: 'data_access',      limit: 0.50,  period: 'hourly' },
        { category: 'content_creation', limit: 2.00,  period: 'daily' },
      ],
    },
    consent: {
      requireConsent: true,
      defaultPurposes: ['audit'],
    },
    audit: { enabled: true },
  });

  const agentId = 'agent:mcp-assistant';

  // Assign moderate trust.
  engine.trust.setLevel(agentId, TrustLevel.L3_ACT_APPROVE, undefined, {
    reason: 'MCP integration test agent, reviewed and approved.',
  });

  // Grant consent for PII access under tool execution purpose.
  engine.consent.recordConsent(agentId, 'pii', 'mcp_tool_execution', 'admin:system');

  // ---------------------------------------------------------------------------
  // Tool calls
  // ---------------------------------------------------------------------------

  const toolCalls: McpToolCall[] = [
    {
      toolName: 'send_slack_message',
      agentId,
      arguments: { channel: '#alerts', text: 'Deployment succeeded.' },
    },
    {
      toolName: 'call_external_api',
      agentId,
      // This will fail: L3 agent calling an L4_ACT_REPORT tool.
      arguments: { url: 'https://api.example.com/webhook', method: 'POST' },
    },
    {
      toolName: 'read_pii_record',
      agentId,
      arguments: { customerId: 'cust_12345' },
    },
    {
      toolName: 'generate_report',
      agentId,
      arguments: { topic: 'Q1 Sales Summary' },
    },
    {
      toolName: 'unknown_tool',
      agentId,
      arguments: {},
    },
  ];

  for (const call of toolCalls) {
    const result = await dispatchToolCall(engine, call);
    console.log(`\n[${call.toolName}]`);
    console.log('  Success:  ', result.success);
    console.log('  Protocol: ', result.governanceDecision.protocol);
    if (result.error !== undefined) {
      console.log('  Error:    ', result.error);
    } else {
      console.log('  Content:  ', JSON.stringify(result.content));
    }
  }

  // ---------------------------------------------------------------------------
  // Post-run audit summary
  // ---------------------------------------------------------------------------
  console.log('\n--- Audit Summary ---');
  const allRecords = engine.audit.getRecords();
  console.log(`Total decisions logged: ${allRecords.length}`);

  const agentPermits = engine.audit.query({ agentId, outcome: 'permit' });
  const agentDenials = engine.audit.query({ agentId, outcome: 'deny' });
  console.log(`  Permits: ${agentPermits.length}`);
  console.log(`  Denials: ${agentDenials.length}`);

  console.log('\n--- Budget Utilisation ---');
  for (const util of engine.budget.listUtilizations()) {
    console.log(
      `  ${util.category.padEnd(20)} $${util.spent.toFixed(4)} / $${util.limit.toFixed(2)}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error('Example failed:', error);
  process.exit(1);
});
