# @aumos/governance

TypeScript SDK for AI agent governance — trust management, budget enforcement, consent tracking, and audit logging.

## Install

```bash
npm install @aumos/governance
```

## Quick Start

```typescript
import { GovernanceEngine } from '@aumos/governance';

const engine = new GovernanceEngine();

// Assign trust level to an agent
engine.trust.setLevel('agent-1', 2); // L2_SUGGEST

// Create a budget envelope
engine.budget.createBudget('api-calls', { limit: 100, period: 'daily' });

// Evaluate a governance action
const decision = engine.evaluate({
  agentId: 'agent-1',
  action: 'call_api',
  scope: 'default',
  cost: 5,
});

console.log(decision.permitted); // true or false
console.log(decision.reason);    // explanation
```

## Modules

| Module | Class | Purpose |
|---|---|---|
| Trust | `TrustManager` | Assign, query, and check agent trust levels |
| Budget | `BudgetManager` | Create envelopes, record spending, enforce limits |
| Consent | `ConsentManager` | Record, check, and revoke consent grants |
| Audit | `AuditLogger` | Structured decision logging with query support |
| Engine | `GovernanceEngine` | Sequential pipeline composing all four modules |

## API

### TrustManager

- `setLevel(agentId, level, scope?, options?)` — assign a trust level
- `getLevel(agentId, scope?)` — get effective level (with decay)
- `checkLevel(agentId, requiredLevel, scope?)` — check if agent meets requirement

### BudgetManager

- `createBudget(category, options)` — create a spending envelope
- `recordSpending(category, amount, description?)` — record a transaction
- `checkBudget(category, amount)` — check if spending is within limits

### ConsentManager

- `recordConsent(agentId, scope, grantedBy, options?)` — record consent
- `checkConsent(agentId, scope)` — check active consent
- `revokeConsent(agentId, scope)` — revoke consent

### AuditLogger

- `log(record)` — record a governance decision
- `query(filter?)` — search audit records

## Documentation

- [API Reference](docs/api-reference.md)
- [Configuration](docs/configuration.md)

## License

BSL 1.1 — Copyright (c) 2026 MuVeraAI Corporation
