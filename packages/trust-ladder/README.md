# @aumos/trust-ladder / trust-ladder

6-level graduated autonomy for AI agents with formal trust decay.

Part of the [AumOS](https://github.com/aumos-ai) open-source governance protocol.

---

## Overview

The trust-ladder package provides a simple, auditable system for assigning
graduated trust levels to AI agents. Trust is represented as a single integer
per (agent, scope) pair, ranging from 0 (OBSERVER) to 5 (AUTONOMOUS).

Trust changes are **manual only** — no automatic promotion or behavioural
scoring. Decay (if configured) can only lower an effective level over time,
never increase it.

## Trust Levels

| Level | Name                  | Capability                                           |
|------:|-----------------------|------------------------------------------------------|
| 0     | `OBSERVER`            | Read-only observation                                |
| 1     | `MONITOR`             | Status monitoring and signalling                     |
| 2     | `SUGGEST`             | Recommendation generation for human review           |
| 3     | `ACT_WITH_APPROVAL`   | Execution requiring explicit human approval          |
| 4     | `ACT_AND_REPORT`      | Execution with mandatory post-hoc reporting          |
| 5     | `AUTONOMOUS`          | Full autonomy within assigned scope                  |

## Installation

### TypeScript / Node.js

```bash
npm install @aumos/trust-ladder
```

### Python

```bash
pip install trust-ladder
```

## Quick Start

### TypeScript

```typescript
import { TrustLadder, TRUST_LEVELS } from "@aumos/trust-ladder";

const ladder = new TrustLadder();

// Assign trust manually
ladder.assign("agent-1", TRUST_LEVELS.ACT_WITH_APPROVAL, "payments", {
  reason: "Approved for payment initiation.",
  assignedBy: "ops-team",
});

// Check permissions
const result = ladder.check("agent-1", TRUST_LEVELS.ACT_WITH_APPROVAL, "payments");
if (result.permitted) {
  // proceed
}

// View history
const history = ladder.getHistory("agent-1", "payments");
```

### Python

```python
from trust_ladder import TrustLadder, TrustLevel

ladder = TrustLadder()

ladder.assign(
    "agent-1",
    TrustLevel.ACT_WITH_APPROVAL,
    scope="payments",
    reason="Approved for payment initiation.",
    assigned_by="ops-team",
)

result = ladder.check("agent-1", TrustLevel.ACT_WITH_APPROVAL, "payments")
if result.permitted:
    pass  # proceed

history = ladder.get_history("agent-1", "payments")
```

## Decay

Two decay strategies are available:

**Cliff decay** — trust drops to L0 when a TTL expires:

```typescript
const ladder = new TrustLadder({
  decay: { enabled: true, type: "cliff", ttlMs: 3_600_000 },
});
```

**Gradual decay** — trust decreases one level per interval:

```typescript
const ladder = new TrustLadder({
  decay: { enabled: true, type: "gradual", stepIntervalMs: 86_400_000 },
});
```

See [docs/decay-formula.md](docs/decay-formula.md) for the full formula.

## Multi-Scope

Each (agent, scope) pair is independent. See [docs/multi-scope.md](docs/multi-scope.md).

## Documentation

- [Trust Levels](docs/trust-levels.md)
- [Decay Formula](docs/decay-formula.md)
- [Multi-Scope Management](docs/multi-scope.md)

## License

BSL 1.1 — see [FIRE_LINE.md](FIRE_LINE.md) for IP boundaries.

Copyright (c) 2026 MuVeraAI Corporation
