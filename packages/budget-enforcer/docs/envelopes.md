# Spending Envelopes

A **spending envelope** is the core primitive in budget-enforcer. It binds a budget category to a fixed spending limit and a time period.

## Anatomy of an envelope

```
SpendingEnvelope {
  id          — stable UUID, auto-generated unless you supply one
  category    — free-form string label (e.g. "llm-inference", "web-search")
  limit       — maximum cumulative spend allowed within the current period
  period      — window type: hourly | daily | weekly | monthly | total
  spent       — amount already deducted by record() calls this period
  committed   — amount reserved by commit() but not yet deducted
  periodStart — when the current window began
  suspended   — if true, all check() calls return reason="suspended"
}
```

`available = limit - spent - committed`

The enforcer never lets `available` go below zero from its own logic — but callers who ignore `check()` results and call `record()` directly can over-spend.

## Periods

| Period    | Window duration | Resets?                            |
|-----------|----------------|------------------------------------|
| `hourly`  | 3 600 s        | Yes — on first access after expiry |
| `daily`   | 86 400 s       | Yes                                |
| `weekly`  | 604 800 s      | Yes                                |
| `monthly` | 2 592 000 s    | Yes                                |
| `total`   | forever        | Never                              |

Period reset is **lazy**: the envelope is only refreshed when it is accessed. There is no background timer. This means:

- A `daily` envelope created at 09:00 will reset on the first call after 09:00 the next day.
- If an agent is idle for several days, the envelope will fast-forward through elapsed periods on the next access (spending is zeroed, `periodStart` is stepped forward by whole periods).

## Creating an envelope

TypeScript:
```typescript
enforcer.createEnvelope({
  category: 'llm-inference',
  limit: 2.00,
  period: 'daily',
});
```

Python:
```python
enforcer.create_envelope(
    EnvelopeConfig(category="llm-inference", limit=2.00, period="daily")
)
```

Calling `createEnvelope` with the same category as an existing envelope **replaces** it. Committed and spent totals from the old envelope are discarded.

## Suspending and resuming

```typescript
enforcer.suspendEnvelope('llm-inference');   // check() returns reason='suspended'
enforcer.resumeEnvelope('llm-inference');    // normal operation resumes
```

Suspension is useful for temporary hold situations (e.g. billing anomaly detected externally) without deleting the envelope and losing its history.

## Multi-envelope strategies

Run one enforcer with multiple envelopes to enforce independent limits per cost type:

```
llm-inference   $2.00 / day
web-search      $0.50 / hour
storage-writes  $5.00 / month
tool-calls      $1.00 / week
```

Each `check()`, `record()`, `commit()`, and `release()` call targets exactly one category. There is no cross-category constraint — set the limits so that the aggregate cost across all categories stays within your overall budget.

## Supplying a custom envelope ID

Pass `id` in the config if you need a stable, externally-tracked identifier:

```typescript
enforcer.createEnvelope({
  id: 'agent-007-llm-daily',
  category: 'llm-inference',
  limit: 5.00,
  period: 'daily',
});
```

This is useful when you want to correlate envelope state with records in an external billing or audit system.
