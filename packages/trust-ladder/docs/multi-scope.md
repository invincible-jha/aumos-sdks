# Multi-Scope Trust Management

An agent can hold different trust levels in different named scopes
simultaneously. Scopes are independent — an assignment in one scope has no
effect on any other scope.

## What Is a Scope?

A scope is an arbitrary string identifier that partitions assignments. Common
patterns include:

- **Service name**: `"payments"`, `"analytics"`, `"content-review"`
- **Environment**: `"production"`, `"staging"`
- **Resource type**: `"user-data"`, `"financial-records"`, `"audit-logs"`
- **Team namespace**: `"ops"`, `"ml-platform"`, `"infra"`

Scopes are case-sensitive and have no hierarchy — `"ops"` and `"ops/infra"`
are completely independent.

## Default Scope

If no scope is specified in `assign()`, `getLevel()`, `check()`, etc., the
ladder uses the `defaultScope` from its configuration. Out of the box this is
an empty string `""`, which functions as a global scope.

```typescript
const globalLadder = new TrustLadder(); // defaultScope = ""
globalLadder.assign("agent-1", TRUST_LEVELS.MONITOR); // scope = ""

const namedLadder = new TrustLadder({ defaultScope: "internal" });
namedLadder.assign("agent-1", TRUST_LEVELS.SUGGEST); // scope = "internal"
```

## Example: Agent With Multiple Scopes

```typescript
import { TrustLadder, TRUST_LEVELS } from "@aumos/trust-ladder";

const ladder = new TrustLadder();

// Same agent, different trust in different scopes
ladder.assign("agent-1", TRUST_LEVELS.AUTONOMOUS,        "read-only-archive");
ladder.assign("agent-1", TRUST_LEVELS.ACT_AND_REPORT,    "analytics");
ladder.assign("agent-1", TRUST_LEVELS.ACT_WITH_APPROVAL, "payments");
ladder.assign("agent-1", TRUST_LEVELS.SUGGEST,           "customer-comms");
ladder.assign("agent-1", TRUST_LEVELS.OBSERVER,          "financial-records");

// Scopes are fully independent — no cross-scope inference
console.log(ladder.getLevel("agent-1", "payments"));           // 3
console.log(ladder.getLevel("agent-1", "financial-records"));  // 0
console.log(ladder.getLevel("agent-1", "unknown-scope"));      // 0 (unassigned)
```

## Scope Query Helpers

The package exports pure-function helpers for inspecting assignments across
scopes:

```typescript
import {
  assignmentsForAgent,
  assignmentsForScope,
  distinctScopes,
  maxLevelPerScope,
} from "@aumos/trust-ladder";

const all = ladder.listAssignments();

// All scopes the agent has assignments in
const scopes = assignmentsForAgent(all, "agent-1").map((a) => a.scope);

// Which agents are in the payments scope?
const paymentAgents = assignmentsForScope(all, "payments").map((a) => a.agentId);

// What's the highest assigned level per scope?
const maxPerScope = maxLevelPerScope(all);
```

## Python Equivalents

```python
from trust_ladder import (
    TrustLadder, TrustLevel,
    assignments_for_agent, assignments_for_scope,
    distinct_scopes, max_level_per_scope,
)

ladder = TrustLadder()
ladder.assign("agent-1", TrustLevel.AUTONOMOUS,        scope="read-only-archive")
ladder.assign("agent-1", TrustLevel.ACT_AND_REPORT,    scope="analytics")
ladder.assign("agent-1", TrustLevel.ACT_WITH_APPROVAL, scope="payments")

all_assignments = ladder.list_assignments()

# Scopes for this agent
scopes = [a.scope for a in assignments_for_agent(all_assignments, "agent-1")]

# Max level per scope
scope_maxes = max_level_per_scope(all_assignments)
```

## Revocation

Revoke by scope to remove a single assignment:

```typescript
ladder.revoke("agent-1", "payments");        // removes only the payments assignment
ladder.revoke("agent-1");                    // removes ALL scopes for agent-1
```

After revocation, `getLevel()` for that scope returns L0 (OBSERVER).
