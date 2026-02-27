# Trust Level Decision Matrix

This document provides a comprehensive decision matrix for choosing the
appropriate AumOS trust level (L0–L5) for an AI agent. Trust levels are
**manually assigned by a human operator** — there is no automatic promotion
or behavioural scoring.

## Level-to-Action Mapping

| Level | Constant             | Allowed Actions                          | Human Involvement         |
|------:|----------------------|------------------------------------------|---------------------------|
| L0    | `OBSERVER`           | Observe, read telemetry, ingest data     | Human performs all actions |
| L1    | `MONITOR`            | Observe + emit structured status signals | Human acts on signals     |
| L2    | `SUGGEST`            | Observe + generate recommendations       | Human reviews and decides |
| L3    | `ACT_WITH_APPROVAL`  | Execute actions after explicit approval  | Human approves each action|
| L4    | `ACT_AND_REPORT`     | Execute actions, report outcomes after   | Human reviews reports     |
| L5    | `AUTONOMOUS`         | Full execution within assigned scope     | Human sets scope/policy   |

## Detailed Capability Breakdown

### L0 — OBSERVER

- **Can:** Read system state, ingest logs, observe metrics
- **Cannot:** Write any data, emit signals, suggest, or act
- **Use when:** Agent is newly deployed, under investigation, or in a
  quarantine state after an incident

### L1 — MONITOR

- **Can:** Everything in L0 + emit structured status signals, surface alerts
- **Cannot:** Generate recommendations, propose actions, or execute anything
- **Use when:** Agent has demonstrated stable observation and you want it to
  surface conditions to the operations team

### L2 — SUGGEST

- **Can:** Everything in L1 + generate action recommendations for human review
- **Cannot:** Execute any action, even with approval
- **Use when:** Agent has domain knowledge and can produce useful suggestions,
  but you are not ready for it to execute

### L3 — ACT_WITH_APPROVAL

- **Can:** Everything in L2 + execute actions that receive explicit human sign-off
- **Cannot:** Execute without prior approval or bypass the approval workflow
- **Use when:** Agent recommendations have proven reliable and you want to
  begin delegating execution under supervision

### L4 — ACT_AND_REPORT

- **Can:** Everything in L3 + execute actions autonomously, with mandatory
  post-hoc reporting
- **Cannot:** Suppress or delay reports; operate outside assigned scope
- **Use when:** Agent has a track record of correct actions and the cost of
  a single incorrect action is recoverable

### L5 — AUTONOMOUS

- **Can:** Full autonomous execution within the assigned scope
- **Cannot:** Operate outside assigned scope or modify its own trust level
- **Use when:** Agent operates in a well-bounded domain with comprehensive
  guardrails and you accept the residual risk

## Decision Trees for Common Scenarios

### Scenario 1: New Agent Onboarding

```
Is the agent newly deployed?
├── YES → Assign L0 (OBSERVER)
│         Let it observe for an evaluation period.
│         ├── Observation is stable and accurate?
│         │   └── YES → Manually promote to L1 (MONITOR)
│         └── Issues detected?
│             └── Keep at L0, investigate
└── NO  → See Scenario 2
```

### Scenario 2: Increasing Autonomy

```
Agent is at L1 (MONITOR). Should it move to L2?
├── Signals have been accurate over evaluation period?
│   ├── YES → Manually promote to L2 (SUGGEST)
│   └── NO  → Keep at L1
│
Agent is at L2 (SUGGEST). Should it move to L3?
├── Suggestions have been consistently correct?
│   ├── YES → Manually promote to L3 (ACT_WITH_APPROVAL)
│   └── NO  → Keep at L2
│
Agent is at L3 (ACT_WITH_APPROVAL). Should it move to L4?
├── Approved actions have been executed correctly?
├── Domain risk is recoverable from a single bad action?
│   ├── Both YES → Manually promote to L4 (ACT_AND_REPORT)
│   └── Either NO → Keep at L3
│
Agent is at L4 (ACT_AND_REPORT). Should it move to L5?
├── Reports show consistent correct execution?
├── Domain has comprehensive guardrails and rollback?
├── Organization accepts residual autonomous risk?
│   ├── All YES → Manually promote to L5 (AUTONOMOUS)
│   └── Any NO  → Keep at L4
```

### Scenario 3: Incident Response

```
An agent caused an unexpected outcome.
├── Severity: Critical?
│   └── YES → Immediately revoke to L0 (OBSERVER)
│             Investigate, then manually re-assign when resolved.
├── Severity: Moderate?
│   └── Drop by one level (e.g., L4 → L3)
│       Review after evaluation period.
├── Severity: Low?
│   └── Keep current level, add monitoring.
│       Review the scope boundaries.
```

### Scenario 4: Scope-Specific Trust

```
Agent needs different trust levels for different tasks.

Example: Customer support agent
├── Scope "read-tickets"     → L4 (ACT_AND_REPORT)
├── Scope "reply-to-tickets" → L3 (ACT_WITH_APPROVAL)
├── Scope "refund-processing"→ L2 (SUGGEST)
└── Scope "account-deletion" → L0 (OBSERVER)
```

## When to Choose Each Level — Quick Reference

| Choose this level when...                                                 | Level |
|---------------------------------------------------------------------------|-------|
| Agent is brand new or under investigation                                 | L0    |
| Agent should surface conditions but not recommend                         | L1    |
| Agent can recommend but should never execute                              | L2    |
| Agent can execute, but every action needs sign-off                        | L3    |
| Agent can execute freely in scope, with mandatory reporting               | L4    |
| Agent operates in a well-bounded, low-risk domain with full guardrails    | L5    |

## Anti-Patterns

| Anti-Pattern                                      | Why It Is Wrong                                    |
|---------------------------------------------------|----------------------------------------------------|
| Starting a new agent at L3+                       | No observation period means unknown failure modes   |
| Promoting based on "it seems fine"                | Requires documented evaluation, not gut feeling     |
| Using L5 without scope boundaries                 | AUTONOMOUS without scope is unbounded risk          |
| Skipping levels (L1 → L4)                         | Each level validates a different capability class   |
| Using the same level for all scopes               | Different domains carry different risk profiles     |
| Relying on decay as the only safety mechanism     | Decay is a backstop, not a primary control          |

## Relationship to Decay

Trust decay (cliff or gradual) only **lowers** the effective level over time.
It does not replace manual assignment — it acts as a safety net that ensures
stale assignments do not persist indefinitely. Operators must actively
re-confirm trust levels for agents whose decay has triggered.

See [decay-formula.md](./decay-formula.md) for the decay mechanics.

---

*Copyright (c) 2026 MuVeraAI Corporation. Licensed under BSL-1.1.*
