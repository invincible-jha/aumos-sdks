# @aumos/governance — Configuration Guide

Copyright (c) 2026 MuVeraAI Corporation. BSL-1.1.

---

## Overview

`GovernanceEngine` accepts a single configuration object that is validated with Zod at construction time.  All fields are optional — the engine starts with safe defaults when no configuration is supplied.

```ts
import { GovernanceEngine, TrustLevel } from '@aumos/governance';

const engine = new GovernanceEngine({
  trust:   { ... },
  budget:  { ... },
  consent: { ... },
  audit:   { ... },
});
```

---

## TrustConfig

Controls the trust sub-system defaults and decay behaviour.

```ts
interface TrustConfig {
  defaultLevel?: TrustLevel;        // Default: TrustLevel.L0_OBSERVER
  decay?: TrustDecayConfig;
  requirements?: TrustRequirement[];
}
```

### `defaultLevel`

The trust level returned for agents that have no explicit assignment in the registry.

Defaults to `TrustLevel.L0_OBSERVER` (most restrictive) which is the safe default for any production deployment.

```ts
trust: {
  defaultLevel: TrustLevel.L1_MONITOR,
}
```

### `decay`

Optional policy describing how trust assignments degrade over time after expiry.

```ts
interface TrustDecayConfig {
  type: 'cliff' | 'gradual';
  intervalMs?: number;
}
```

**Cliff decay:** The assignment drops atomically to `L0_OBSERVER` as soon as `expiresAt` is reached.  No `intervalMs` is required.

```ts
trust: {
  decay: { type: 'cliff' },
}
```

**Gradual decay:** The trust level decrements by one tier per elapsed `intervalMs` after `expiresAt`. The agent bottoms out at `L0_OBSERVER`.

```ts
trust: {
  decay: {
    type: 'gradual',
    intervalMs: 3_600_000, // 1 hour
  },
}
```

When no `decay` is configured, assignments remain at their assigned level indefinitely (unless the caller supplies an `expiresAt` on a per-assignment basis).

### `requirements`

An optional table of action-name to minimum-level mappings. This is a reference table for documentation and policy generation — the engine does not automatically consult it during `evaluate()`.  Callers pass `requiredTrustLevel` explicitly on each `GovernanceAction`.

```ts
trust: {
  requirements: [
    { action: 'send_email',         minimumLevel: TrustLevel.L3_ACT_APPROVE },
    { action: 'deploy_to_staging',  minimumLevel: TrustLevel.L4_ACT_REPORT  },
  ],
}
```

---

## BudgetConfig

Controls per-category spending envelopes.

```ts
interface BudgetConfig {
  envelopes?: EnvelopePreset[];
  dailyLimitUsd?: number;
}
```

### `envelopes`

Pre-seeded spending envelopes created automatically at construction time. Additional envelopes can always be added at runtime via `BudgetManager.createBudget()`.

```ts
budget: {
  envelopes: [
    { category: 'llm_inference', limit: 50.00, period: 'daily'   },
    { category: 'storage',       limit:  5.00, period: 'monthly' },
    { category: 'external_api',  limit: 10.00, period: 'daily'   },
  ],
}
```

**Envelope preset fields:**

| Field | Type | Description |
|---|---|---|
| `category` | `string` | Unique name for this budget |
| `limit` | `number` | Maximum spend per period (must be positive) |
| `period` | `BudgetPeriod` | `'hourly' \| 'daily' \| 'weekly' \| 'monthly' \| 'total'` |

**Period semantics:**

- `hourly` — resets at the start of the next clock hour.
- `daily` — resets at midnight UTC.
- `weekly` — resets at midnight UTC on Monday.
- `monthly` — resets on the first of the next calendar month.
- `total` — never resets; the limit is a lifetime cap.

### `dailyLimitUsd`

An optional aggregate cap applied across all categories.  When set, no `recordSpending()` call may push the sum of all daily-period spending above this value regardless of individual envelope limits.

```ts
budget: {
  dailyLimitUsd: 100.00,
}
```

---

## ConsentConfig

Controls consent enforcement behaviour.

```ts
interface ConsentConfig {
  requireConsent?: boolean;       // Default: false
  defaultPurposes?: string[];
}
```

### `requireConsent`

When `true`, every `GovernanceAction` that includes a `dataType` field must have a matching active consent record or the request is denied.

When `false` (the default), the engine permits data access even without an explicit consent record.  Consent records are still searched and surfaced in the `ConsentCheckResult` when found.

```ts
consent: {
  requireConsent: true,
}
```

### `defaultPurposes`

A list of purpose strings that are automatically permitted without requiring an explicit consent record.  Useful for system-internal operations.

```ts
consent: {
  requireConsent: true,
  defaultPurposes: ['audit', 'monitoring', 'pipeline_internal'],
}
```

---

## AuditConfig

Controls the in-memory audit log.

```ts
interface AuditConfig {
  enabled?: boolean;     // Default: true
  maxRecords?: number;   // Default: 10_000
}
```

### `enabled`

When `false`, `AuditLogger.log()` becomes a no-op and `AuditLogger.query()` always returns an empty array.  Useful in test environments where audit overhead is undesirable.

### `maxRecords`

Maximum number of records held in memory before oldest entries are evicted (circular buffer semantics).  The default of 10 000 records is suitable for most in-process use cases.  For long-running production services, consider forwarding records to an external store before the buffer fills.

```ts
audit: {
  enabled: true,
  maxRecords: 50_000,
}
```

---

## Environment-based configuration

The config object is a plain JavaScript object, so it can be assembled from any source — environment variables, a config file, or a secrets manager.  Use the exported `parseGovernanceConfig()` helper to validate before constructing the engine:

```ts
import { parseGovernanceConfig, GovernanceEngine, TrustLevel } from '@aumos/governance';

const rawConfig = {
  trust:  { defaultLevel: Number(process.env.DEFAULT_TRUST_LEVEL ?? TrustLevel.L0_OBSERVER) },
  budget: { dailyLimitUsd: Number(process.env.DAILY_BUDGET_USD ?? 50) },
  audit:  { maxRecords: Number(process.env.AUDIT_MAX_RECORDS ?? 10_000) },
};

const config = parseGovernanceConfig(rawConfig); // throws InvalidConfigError on failure
const engine = new GovernanceEngine(config);
```

---

## Full configuration example

```ts
const engine = new GovernanceEngine({
  trust: {
    defaultLevel: TrustLevel.L0_OBSERVER,
    decay: {
      type: 'gradual',
      intervalMs: 3_600_000,
    },
    requirements: [
      { action: 'send_email',   minimumLevel: TrustLevel.L3_ACT_APPROVE },
      { action: 'read_pii',     minimumLevel: TrustLevel.L3_ACT_APPROVE },
      { action: 'deploy',       minimumLevel: TrustLevel.L5_AUTONOMOUS   },
    ],
  },
  budget: {
    envelopes: [
      { category: 'communication',    limit: 5.00,   period: 'daily'   },
      { category: 'data_access',      limit: 2.00,   period: 'hourly'  },
      { category: 'external_api',     limit: 20.00,  period: 'daily'   },
      { category: 'content_creation', limit: 50.00,  period: 'monthly' },
    ],
    dailyLimitUsd: 100.00,
  },
  consent: {
    requireConsent: true,
    defaultPurposes: ['audit', 'monitoring'],
  },
  audit: {
    enabled: true,
    maxRecords: 25_000,
  },
});
```
