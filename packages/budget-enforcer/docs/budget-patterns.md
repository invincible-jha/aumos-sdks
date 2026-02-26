# Budget Patterns

Common patterns for integrating budget-enforcer into AI agent systems.

## Pattern 1: Check-then-record (standard)

The simplest and most common pattern. Check before performing an operation; record after it succeeds.

```typescript
const result = enforcer.check('llm-inference', estimatedCost);
if (!result.permitted) {
  throw new BudgetExceededError(result);
}

const response = await llm.complete(prompt);
enforcer.record('llm-inference', response.actualCost, prompt.slice(0, 80));
```

The cost passed to `check()` is an estimate. The cost passed to `record()` should be the actual amount charged. If the actual cost exceeds the estimate, `record()` will still deduct it — it does not re-check.

## Pattern 2: Commit-release-record (two-phase)

Use when you need to hold capacity before starting a potentially long operation. This prevents a second concurrent agent from consuming the budget you are about to use.

```typescript
// Phase 1: reserve capacity
const commit = enforcer.commit('llm-inference', estimatedCost);
if (!commit.permitted) {
  throw new BudgetExceededError(commit);
}

try {
  const response = await llm.complete(prompt);

  // Phase 2: release the reservation, record actual cost
  enforcer.release(commit.commitId!);
  enforcer.record('llm-inference', response.actualCost, 'completion');
} catch (error) {
  // Operation failed — release the reservation so budget is restored.
  enforcer.release(commit.commitId!);
  throw error;
}
```

## Pattern 3: Graceful degradation

Instead of throwing on budget exhaustion, fall back to a cheaper operation.

```typescript
const fullModelCost = 0.40;
const cheapModelCost = 0.02;

const fullCheck = enforcer.check('llm-inference', fullModelCost);
if (fullCheck.permitted) {
  const response = await gpt4o.complete(prompt);
  enforcer.record('llm-inference', fullModelCost, 'gpt-4o');
  return response;
}

const cheapCheck = enforcer.check('llm-inference', cheapModelCost);
if (cheapCheck.permitted) {
  const response = await gpt4oMini.complete(prompt);
  enforcer.record('llm-inference', cheapModelCost, 'gpt-4o-mini');
  return response;
}

// No budget remaining — return a cached or static response.
return getCachedFallback(prompt);
```

## Pattern 4: Per-task sub-budgets

Allocate a fraction of the total budget to each task so no single task can exhaust the daily limit.

```typescript
function createTaskEnforcer(taskId: string, taskBudgetUsd: number): BudgetEnforcer {
  const enforcer = new BudgetEnforcer({ namespace: taskId });
  enforcer.createEnvelope({
    category: 'llm-inference',
    limit: taskBudgetUsd,
    period: 'total',   // task budgets don't reset — they cover the whole task
  });
  return enforcer;
}

const taskEnforcer = createTaskEnforcer('task-abc123', 0.25);
// Use taskEnforcer inside the task — never touches the global enforcer.
```

## Pattern 5: Observability hook

Wrap the enforcer to emit metrics on every check and record.

```typescript
import type { BudgetCheckResult, Transaction } from '@aumos/budget-enforcer';

class InstrumentedEnforcer extends BudgetEnforcer {
  override check(category: string, amount: number): BudgetCheckResult {
    const result = super.check(category, amount);
    metrics.increment('budget.check', {
      category,
      permitted: String(result.permitted),
      reason: result.reason,
    });
    return result;
  }

  override record(category: string, amount: number, description?: string): Transaction {
    const transaction = super.record(category, amount, description);
    metrics.gauge('budget.spent', amount, { category });
    return transaction;
  }
}
```

## Pattern 6: Custom durable storage

Supply a `BudgetStorage` implementation to survive process restarts.

```typescript
import type { BudgetStorage } from '@aumos/budget-enforcer';
import type { SpendingEnvelope, Transaction, PendingCommit } from '@aumos/budget-enforcer';

class RedisStorage implements BudgetStorage {
  constructor(private readonly redis: Redis, private readonly prefix: string) {}

  async getEnvelope(id: string): Promise<SpendingEnvelope | null> {
    const raw = await this.redis.get(`${this.prefix}:envelope:${id}`);
    return raw ? JSON.parse(raw) : null;
  }

  async saveEnvelope(envelope: SpendingEnvelope): Promise<void> {
    await this.redis.set(
      `${this.prefix}:envelope:${envelope.id}`,
      JSON.stringify(envelope),
    );
    await this.redis.set(
      `${this.prefix}:category:${envelope.category}`,
      envelope.id,
    );
  }

  // ... implement remaining methods
}

const enforcer = new BudgetEnforcer({}, new RedisStorage(redis, 'agent-007'));
```

## Handling the `no_envelope` reason

A `check()` result with `reason: 'no_envelope'` means the category has no configured envelope. There are two valid responses:

1. **Fail closed** — deny the operation and alert. This is the safest default.
2. **Create on demand** — create a default envelope on the first access. Useful in development.

```typescript
function checkWithFallback(
  enforcer: BudgetEnforcer,
  category: string,
  amount: number,
): BudgetCheckResult {
  const result = enforcer.check(category, amount);
  if (result.reason === 'no_envelope') {
    // Fail closed — never proceed without an explicit limit.
    throw new Error(`No budget envelope configured for category "${category}"`);
  }
  return result;
}
```

## Choosing `total` vs rolling periods

Use `total` when:
- The budget is allocated once per task or session.
- You want a hard lifetime cap (e.g. a demo account).

Use a rolling period (`daily`, `weekly`, etc.) when:
- Costs recur and you want steady-state control.
- You need to allow recovery after a quiet period.

Rolling periods reset automatically — there is no action required from the caller.
