# @aumos/governance — API Reference

Copyright (c) 2026 MuVeraAI Corporation. BSL-1.1.

---

## Table of Contents

1. [GovernanceEngine](#governanceengine)
2. [TrustManager](#trustmanager)
3. [BudgetManager](#budgetmanager)
4. [ConsentManager](#consentmanager)
5. [AuditLogger](#auditlogger)
6. [Types](#types)
7. [Errors](#errors)
8. [Config schemas](#config-schemas)

---

## GovernanceEngine

The top-level orchestrator. Composes all four protocol managers into a single sequential evaluation pipeline.

```ts
import { GovernanceEngine, TrustLevel } from '@aumos/governance';

const engine = new GovernanceEngine(config);
```

### Constructor

```ts
new GovernanceEngine(config?: GovernanceConfig)
```

Parses and validates `config` with Zod. Throws `InvalidConfigError` on validation failure.

All four sub-managers are instantiated internally and exposed as readonly properties.

### Properties

| Property | Type | Description |
|---|---|---|
| `trust` | `TrustManager` | The agent trust registry |
| `budget` | `BudgetManager` | The spending envelope manager |
| `consent` | `ConsentManager` | The consent record store |
| `audit` | `AuditLogger` | The audit decision log |

### Methods

#### `evaluate(action: GovernanceAction): Promise<GovernanceDecision>`

Evaluates an action through the sequential governance pipeline:

1. **Trust gate** — agent's effective trust level must meet `action.requiredTrustLevel`.
2. **Budget gate** — if `action.cost` is set, the category envelope must have headroom.
3. **Consent gate** — if `action.dataType` is set and `requireConsent` is true, an active consent record must exist.
4. **Audit** — the decision is always logged regardless of outcome.

The first failed check short-circuits the pipeline and returns a denied decision immediately.

```ts
const decision = await engine.evaluate({
  agentId: 'agent:assistant',
  action: 'send_email',
  category: 'communication',
  requiredTrustLevel: TrustLevel.L3_ACT_APPROVE,
  cost: 0.002,
});

if (!decision.permitted) {
  console.error(decision.reason);
}
```

---

## TrustManager

Manages agent trust level assignments. All trust changes are manual — there is no automatic promotion pathway.

```ts
import { TrustManager, TrustLevel } from '@aumos/governance';

const trust = new TrustManager({ defaultLevel: TrustLevel.L0_OBSERVER });
```

### Constructor

```ts
new TrustManager(config?: TrustConfig)
```

### Methods

#### `setLevel(agentId, level, scope?, options?): TrustAssignment`

Assigns a trust level to an agent. Records the previous level for audit purposes.

```ts
trust.setLevel('agent:assistant', TrustLevel.L3_ACT_APPROVE, undefined, {
  reason: 'Approved by admin.',
  expiresAt: '2026-06-01T00:00:00Z',
  assignedBy: 'owner',
});
```

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `agentId` | `string` | Yes | The agent receiving the assignment |
| `level` | `TrustLevel` | Yes | The trust level to assign |
| `scope` | `string` | No | Optional scope label |
| `options.reason` | `string` | No | Human-readable rationale |
| `options.expiresAt` | `string` | No | ISO 8601 expiry datetime |
| `options.assignedBy` | `'owner' \| 'system' \| 'policy'` | No | Defaults to `'owner'` |

**Returns:** `TrustAssignment`

#### `getLevel(agentId, scope?): TrustLevel`

Returns the effective trust level for an agent after applying any configured decay. Returns `defaultLevel` when no assignment exists.

```ts
const level = trust.getLevel('agent:assistant');
```

#### `checkLevel(agentId, requiredLevel, scope?): TrustCheckResult`

Checks whether the agent's current effective level meets the required minimum. Never throws.

```ts
const result = trust.checkLevel('agent:assistant', TrustLevel.L3_ACT_APPROVE);
if (!result.permitted) {
  console.log(result.reason);
}
```

**Returns:** `TrustCheckResult`

```ts
interface TrustCheckResult {
  permitted: boolean;
  currentLevel: TrustLevel;
  requiredLevel: TrustLevel;
  reason?: string;
}
```

#### `listAssignments(): readonly TrustAssignment[]`

Returns all stored assignments (for inspection/debugging).

---

## BudgetManager

Manages per-category spending envelopes. Budget limits are static — set by configuration or `createBudget()`.

```ts
import { BudgetManager } from '@aumos/governance';

const budget = new BudgetManager({
  envelopes: [{ category: 'llm', limit: 10.00, period: 'daily' }],
});
```

### Constructor

```ts
new BudgetManager(config?: BudgetConfig)
```

Envelopes declared in `config.envelopes` are created automatically.

### Methods

#### `createBudget(category, limit, period): SpendingEnvelope`

Creates or replaces a spending envelope. New envelopes start with zero spend.

```ts
budget.createBudget('llm_inference', 25.00, 'daily');
```

| Parameter | Type | Description |
|---|---|---|
| `category` | `string` | Unique label for this budget |
| `limit` | `number` | Maximum spend per period (must be positive) |
| `period` | `BudgetPeriod` | `'hourly' \| 'daily' \| 'weekly' \| 'monthly' \| 'total'` |

#### `recordSpending(category, amount, description?): void`

Records a settled transaction. Callers should call `checkBudget()` first.

```ts
budget.recordSpending('llm_inference', 0.0042, 'gpt-4o completion');
```

Throws `RangeError` if the category has no envelope or amount is not positive.

#### `checkBudget(category, amount): BudgetCheckResult`

Checks whether `amount` fits within the current period budget. Pure — no state mutation.

```ts
const result = budget.checkBudget('llm_inference', 1.50);
if (result.permitted) {
  budget.recordSpending('llm_inference', 1.50);
}
```

**Returns:** `BudgetCheckResult`

```ts
interface BudgetCheckResult {
  permitted: boolean;
  available: number;
  requested: number;
  limit: number;
  spent: number;
  reason?: string;
}
```

#### `getUtilization(category): BudgetUtilization | undefined`

Returns a read-only utilisation snapshot for a category. Returns `undefined` when the category is not registered.

#### `listUtilizations(): readonly BudgetUtilization[]`

Returns utilisation snapshots for all registered categories.

---

## ConsentManager

Records, checks, and revokes consent grants. Consent is never inferred or suggested automatically.

```ts
import { ConsentManager } from '@aumos/governance';

const consent = new ConsentManager({ requireConsent: true });
```

### Constructor

```ts
new ConsentManager(config?: ConsentConfig)
```

### Methods

#### `recordConsent(agentId, dataType, purpose, grantedBy, options?): ConsentRecord`

Records a consent grant.

```ts
consent.recordConsent(
  'agent:assistant',
  'pii',
  'personalisation',
  'operator:alice',
  { expiresAt: '2026-12-31T23:59:59Z' },
);
```

| Parameter | Type | Description |
|---|---|---|
| `agentId` | `string` | Agent being granted consent |
| `dataType` | `string` | Category of data (e.g. `'pii'`, `'financial'`) |
| `purpose` | `string` | Stated purpose for access |
| `grantedBy` | `string` | The principal authorising consent |
| `options.expiresAt` | `string` | ISO 8601 expiry (optional) |

#### `checkConsent(agentId, dataType, purpose?): ConsentCheckResult`

Checks whether valid consent exists. Returns `permitted: true` when:

- `requireConsent` is `false` in config (default), or
- The `purpose` is in `defaultPurposes`, or
- An active, non-expired consent record matches the `(agentId, dataType, purpose)` triplet.

```ts
const result = consent.checkConsent('agent:assistant', 'pii', 'personalisation');
```

#### `revokeConsent(agentId, dataType, purpose?): number`

Marks matching active records as revoked. Returns the count of records revoked.

```ts
const count = consent.revokeConsent('agent:assistant', 'pii');
```

#### `listConsents(agentId): readonly ConsentRecord[]`

Returns all currently active (non-revoked, non-expired) records for an agent.

---

## AuditLogger

Append-only in-memory audit log. Recording only — no analysis or detection capabilities.

```ts
import { AuditLogger } from '@aumos/governance';

const logger = new AuditLogger({ enabled: true, maxRecords: 10_000 });
```

### Constructor

```ts
new AuditLogger(config?: AuditConfig)
```

### Methods

#### `log(decision, context?): AuditRecord | undefined`

Records a governance decision. Returns the created `AuditRecord`, or `undefined` when auditing is disabled.

```ts
logger.log(decision, { agentId: 'agent:assistant', action: 'send_email' });
```

The `context` object accepts any key/value pairs. `agentId` and `action` are standard fields surfaced at the top level of the record; all other keys are stored in `metadata`.

#### `query(filter?): AuditRecord[]`

Retrieves records matching the filter. All fields are optional (AND semantics). Returns records sorted oldest-first.

```ts
const denials = logger.query({
  agentId: 'agent:assistant',
  outcome: 'deny',
  fromTimestamp: '2026-01-01T00:00:00Z',
  limit: 50,
});
```

**AuditFilter fields:**

| Field | Type | Description |
|---|---|---|
| `fromTimestamp` | `string` | Inclusive lower bound (ISO 8601) |
| `toTimestamp` | `string` | Exclusive upper bound (ISO 8601) |
| `agentId` | `string` | Filter by agent |
| `action` | `string` | Filter by action name |
| `outcome` | `'permit' \| 'deny'` | Filter by decision outcome |
| `protocol` | `string` | Filter by protocol identifier |
| `limit` | `number` | Maximum records to return |

#### `getRecords(): readonly AuditRecord[]`

Returns all stored records in insertion order.

#### `recordCount: number` (property)

Total number of currently stored records.

---

## Types

### TrustLevel (enum)

```ts
enum TrustLevel {
  L0_OBSERVER    = 0,
  L1_MONITOR     = 1,
  L2_SUGGEST     = 2,
  L3_ACT_APPROVE = 3,
  L4_ACT_REPORT  = 4,
  L5_AUTONOMOUS  = 5,
}
```

### ActionCategory

```ts
type ActionCategory =
  | 'communication'
  | 'financial'
  | 'data_access'
  | 'system'
  | 'external_api'
  | 'content_creation';
```

### GovernanceAction

```ts
interface GovernanceAction {
  agentId: string;
  action: string;
  category: ActionCategory;
  requiredTrustLevel: TrustLevel;
  cost?: number;
  dataType?: string;
  purpose?: string;
  scope?: string;
  metadata?: Record<string, unknown>;
}
```

### GovernanceDecision

```ts
interface GovernanceDecision {
  permitted: boolean;
  reason: string;
  protocol: string;
  timestamp: string;
  details?: Record<string, unknown>;
}
```

---

## Errors

All errors extend `GovernanceError` which extends `Error`. Each error carries a machine-readable `code`.

| Class | Code | Thrown when |
|---|---|---|
| `GovernanceError` | (base) | Base class, not thrown directly |
| `TrustDeniedError` | `TRUST_DENIED` | Agent trust level is insufficient |
| `BudgetExceededError` | `BUDGET_EXCEEDED` | Spend would exceed envelope limit |
| `ConsentRequiredError` | `CONSENT_REQUIRED` | No active consent record found |
| `InvalidConfigError` | `INVALID_CONFIG` | Config fails Zod validation |

```ts
import { TrustDeniedError, BudgetExceededError, ConsentRequiredError } from '@aumos/governance';

try {
  // ...
} catch (error) {
  if (error instanceof TrustDeniedError) {
    console.log(error.currentLevel, error.requiredLevel);
  }
}
```

---

## Config schemas

All config schemas are exported as Zod objects and can be used for validation in your own code.

```ts
import {
  GovernanceConfigSchema,
  TrustConfigSchema,
  BudgetConfigSchema,
  ConsentConfigSchema,
  AuditConfigSchema,
} from '@aumos/governance';

// Validate external config (e.g. from environment or file):
const result = GovernanceConfigSchema.safeParse(rawConfig);
```

Parse helpers throw `InvalidConfigError` on failure:

```ts
import { parseGovernanceConfig } from '@aumos/governance';

const config = parseGovernanceConfig(rawInput); // throws InvalidConfigError on bad input
```
