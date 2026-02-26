# Decay Formula

Trust decay models the natural erosion of confidence in an agent's autonomy
as time passes without a fresh manual assignment. Decay is always
one-directional: the effective level can only decrease, never increase.

## Decay Types

### Cliff Decay

The effective level equals the assigned level until the TTL expires, at which
point it drops immediately to L0 (OBSERVER).

```
effective_level(t) =
  assigned_level   if (t - assigned_at) < ttl_ms
  OBSERVER (L0)    if (t - assigned_at) >= ttl_ms
```

**Configuration (TypeScript)**:

```typescript
const ladder = new TrustLadder({
  decay: {
    enabled: true,
    type: "cliff",
    ttlMs: 3_600_000,   // 1 hour
  },
});
```

**Configuration (Python)**:

```python
from trust_ladder import TrustLadder, TrustLadderConfig, CliffDecayConfig

ladder = TrustLadder(TrustLadderConfig(
    decay=CliffDecayConfig(ttl_ms=3_600_000),  # 1 hour
))
```

**Use case**: Temporary elevated access for bounded operations (e.g., incident
response, maintenance windows). After the window closes, the agent returns to
full observation mode without requiring an explicit revocation.

### Gradual Decay

The effective level decreases by one for each complete `stepIntervalMs`
(TypeScript) / `step_interval_ms` (Python) that has elapsed since the
assignment. The floor is always L0.

```
steps_elapsed    = floor((t - assigned_at) / step_interval_ms)
effective_level  = max(OBSERVER, assigned_level - steps_elapsed)
```

**Configuration (TypeScript)**:

```typescript
const ladder = new TrustLadder({
  decay: {
    enabled: true,
    type: "gradual",
    stepIntervalMs: 86_400_000,   // 24 hours per level
  },
});
```

**Configuration (Python)**:

```python
from trust_ladder import TrustLadder, TrustLadderConfig, GradualDecayConfig

ladder = TrustLadder(TrustLadderConfig(
    decay=GradualDecayConfig(step_interval_ms=86_400_000),  # 24 hours per level
))
```

**Use case**: Long-running agents where trust should erode gradually to
encourage periodic re-evaluation by operators, without sudden hard cutoffs.

### No Decay (Default)

When decay is disabled (the default), the effective level always equals the
assigned level regardless of elapsed time.

```typescript
const ladder = new TrustLadder({ decay: { enabled: false } });
// or simply:
const ladder = new TrustLadder();
```

## Effective Level Computation

The `getLevel()` / `get_level()` method always returns the effective level.
The underlying stored assignment retains the originally assigned level so that
the operator's intent is preserved in history.

## Refreshing Trust

To reset or extend decay, call `assign()` again with the desired level. This
creates a new assignment with a fresh `assigned_at` timestamp, restarting the
decay clock from zero.

```typescript
// Refresh trust back to L4 for another hour (cliff decay config)
ladder.assign("agent-1", TRUST_LEVELS.ACT_AND_REPORT, "ops", {
  reason: "Extending access for second maintenance window.",
  assignedBy: "operator-jane",
});
```

## Helper: Time Until Next Decay

Use `timeUntilNextDecay` (TypeScript) / `time_until_next_decay` (Python) to
determine how long until the next decay event:

```typescript
import { timeUntilNextDecay } from "@aumos/trust-ladder";

const msRemaining = timeUntilNextDecay(assignment, decayConfig, Date.now());
if (msRemaining !== null) {
  console.log(`Next decay in ${msRemaining / 1000}s`);
}
```

Returns `null` when decay is disabled or the assignment is already at L0.
