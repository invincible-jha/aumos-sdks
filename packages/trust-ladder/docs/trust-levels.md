# Trust Levels

The AumOS trust ladder defines six integer levels [0–5]. Each level grants a
strictly broader set of execution capabilities than the level below it.

## Level Reference

| Level | Constant              | Description                                                   |
|------:|-----------------------|---------------------------------------------------------------|
| 0     | `OBSERVER`            | Read-only observation; no execution capability.               |
| 1     | `MONITOR`             | State monitoring and structured status signalling.            |
| 2     | `SUGGEST`             | Recommendation generation for human review.                   |
| 3     | `ACT_WITH_APPROVAL`   | Action execution requiring explicit human approval.           |
| 4     | `ACT_AND_REPORT`      | Action execution with mandatory post-hoc reporting.           |
| 5     | `AUTONOMOUS`          | Full autonomous execution within the assigned scope.          |

## Design Principles

### Single integer per scope

Each (agent, scope) pair holds exactly one integer. There is no
multi-dimensional trust matrix — this keeps reasoning about agent permissions
simple and auditable.

### Manual assignment only

Trust levels change exclusively through explicit operator calls to `assign()`
(`TrustLadder.assign` in TypeScript, `TrustLadder.assign` in Python).
There is no mechanism for an agent to influence its own trust level.

### Scope isolation

An assignment in scope `"payments"` has no effect on the agent's level in
scope `"analytics"`. Scopes never interact. An unassigned scope always
returns L0 (OBSERVER).

### Decay direction

Decay (when configured) can only decrease the effective level over time.
The engine has no pathway to increase trust — that always requires a manual
`assign()` call.

## Usage Examples

### TypeScript

```typescript
import { TrustLadder, TRUST_LEVELS, trustLevelName } from "@aumos/trust-ladder";

const ladder = new TrustLadder();

ladder.assign("agent-1", TRUST_LEVELS.SUGGEST, "drafting", {
  reason: "Cleared for content drafts after review.",
  assignedBy: "ops-team",
});

const level = ladder.getLevel("agent-1", "drafting");
console.log(trustLevelName(level)); // "SUGGEST"
```

### Python

```python
from trust_ladder import TrustLadder, TrustLevel, trust_level_name

ladder = TrustLadder()
ladder.assign("agent-1", TrustLevel.SUGGEST, scope="drafting",
               reason="Cleared for content drafts after review.",
               assigned_by="ops-team")

level = ladder.get_level("agent-1", "drafting")
print(trust_level_name(level.value))  # "SUGGEST"
```

## Permission Checks

The `check()` method returns a `TrustCheckResult` that tells you whether the
agent's effective level (after decay) is at or above the required minimum:

```typescript
const result = ladder.check("agent-1", TRUST_LEVELS.ACT_WITH_APPROVAL, "payments");
if (!result.permitted) {
  throw new Error(`Insufficient trust: L${result.effectiveLevel} < L${result.requiredLevel}`);
}
```

A check against an unassigned scope always returns `permitted: false` for any
level above OBSERVER (L0).
