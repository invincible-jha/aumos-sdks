# @aumos/budget-enforcer

Economic governance for AI agents — static spending limits and budget enforcement.

Part of the [Aumos OSS SDK](../../README.md) — Project Quasar.

**License:** BSL-1.1
**Copyright (c) 2026 MuVeraAI Corporation**

---

## What it does

Budget-enforcer provides a simple, deterministic spending gate for AI agent loops. Before your agent calls an LLM, executes a tool, or writes to storage, it asks the enforcer whether the cost is within budget. The enforcer returns `permitted: true` or `permitted: false`. The agent decides what to do next.

No ML. No approval queues. No auto-adjustments. Limits are static — set by you, never changed by the library.

---

## TypeScript

### Install

```bash
npm install @aumos/budget-enforcer
```

### Quick start

```typescript
import { BudgetEnforcer } from '@aumos/budget-enforcer';

const enforcer = new BudgetEnforcer();

enforcer.createEnvelope({
  category: 'llm-inference',
  limit: 2.00,       // USD
  period: 'daily',
});

// Before running a task:
const result = enforcer.check('llm-inference', 0.05);
if (!result.permitted) {
  // result.reason is 'exceeds_budget' | 'no_envelope' | 'suspended'
  return { error: 'budget_exhausted', available: result.available };
}

// After the task completes:
enforcer.record('llm-inference', 0.05, 'gpt-4o summarisation');
```

### Build

```bash
cd typescript
npm install
npm run build      # tsup
npm run typecheck  # tsc --noEmit
```

---

## Python

### Install

```bash
pip install budget-enforcer
```

### Quick start

```python
from budget_enforcer import BudgetEnforcer, EnvelopeConfig

enforcer = BudgetEnforcer()
enforcer.create_envelope(EnvelopeConfig(category="llm-inference", limit=2.00, period="daily"))

result = enforcer.check("llm-inference", 0.05)
if not result.permitted:
    raise RuntimeError(f"Budget denied: {result.reason}")

enforcer.record("llm-inference", 0.05, description="gpt-4o summarisation")
```

---

## Core API

### `check(category, amount)` — read-only

Returns `BudgetCheckResult` with `permitted: boolean`. Does not modify any state. Call this before every spend decision.

| `reason`         | Meaning                                   |
|------------------|-------------------------------------------|
| `within_budget`  | Amount fits within remaining balance      |
| `exceeds_budget` | Amount would exceed `limit - spent - committed` |
| `no_envelope`    | No envelope configured for this category  |
| `suspended`      | Envelope is manually suspended            |

### `record(category, amount, description?)` — deducts

Records a completed transaction. Adds to `spent`. Call this only after the operation has succeeded.

### `commit(category, amount)` — pre-authorises

Reserves an amount by increasing `committed`. Returns a `commitId`. Does not touch `spent`.

### `release(commitId)` — cancels a commit

Returns the committed amount to available. Call on cancellation or failure.

### `utilization(category)` — snapshot

Returns `BudgetUtilization` with `spent`, `committed`, `available`, and `utilizationPercent`.

---

## Periods

| Period    | Window         |
|-----------|----------------|
| `hourly`  | 3 600 seconds  |
| `daily`   | 86 400 seconds |
| `weekly`  | 604 800 seconds|
| `monthly` | 2 592 000 seconds |
| `total`   | Never resets   |

Periods reset lazily on the next access after expiry. No background timers.

---

## Custom storage

The default `MemoryStorage` is in-process only. For persistence across restarts, implement `BudgetStorage` and pass it to the constructor:

```typescript
const enforcer = new BudgetEnforcer({}, new MyRedisStorage(redis));
```

```python
enforcer = BudgetEnforcer(storage=MyPostgresStorage(conn))
```

---

## Examples

See [examples/](./examples/) for runnable scripts covering basic and multi-category usage.

---

## Docs

- [Spending Envelopes](./docs/envelopes.md) — envelope anatomy, periods, suspension
- [Budget Patterns](./docs/budget-patterns.md) — check-then-record, commit/release, graceful degradation, custom storage
