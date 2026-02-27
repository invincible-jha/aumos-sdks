# CSA Agentic Trust Framework Mapping

This document maps the [Cloud Security Alliance (CSA) Agentic AI Trust
Framework](https://cloudsecurityalliance.org/) agent autonomy levels to the
AumOS trust ladder levels. The mapping enables organizations already aligned
with CSA guidance to adopt AumOS trust levels with a clear correspondence.

## Background

The CSA Agentic AI Trust Framework defines a graduated model for agent
autonomy in enterprise environments. It establishes categories of agent
behaviour and the governance controls required at each tier. AumOS shares
the same philosophical foundation — graduated autonomy with human oversight —
but uses a different level structure optimized for runtime enforcement.

## Level Correspondence

| CSA Autonomy Tier             | CSA Description                                    | AumOS Level | AumOS Constant          |
|-------------------------------|----------------------------------------------------|-------------|-------------------------|
| **Tier 0 — No Autonomy**     | Agent has no independent capability; fully passive  | L0          | `OBSERVER`              |
| **Tier 1 — Informational**   | Agent can observe and report status                 | L1          | `MONITOR`               |
| **Tier 2 — Advisory**        | Agent provides recommendations for human decision   | L2          | `SUGGEST`               |
| **Tier 3 — Conditional**     | Agent can act with explicit pre-approval            | L3          | `ACT_WITH_APPROVAL`     |
| **Tier 4 — Supervised**      | Agent acts independently with oversight reporting   | L4          | `ACT_AND_REPORT`        |
| **Tier 5 — Full Autonomy**   | Agent operates independently within policy bounds   | L5          | `AUTONOMOUS`            |

## Key Correspondences

### Shared Principles

1. **Graduated autonomy.** Both frameworks define a strict ordering where
   each tier/level grants capabilities that are a superset of the tier below.

2. **Human-in-the-loop at lower levels.** CSA Tiers 0–2 and AumOS L0–L2
   both require a human to perform or approve any real-world action.

3. **Approval gates.** CSA Tier 3 ("Conditional") maps directly to AumOS L3
   (`ACT_WITH_APPROVAL`) — the agent can propose and execute, but only after
   receiving explicit human sign-off.

4. **Post-hoc accountability.** CSA Tier 4 ("Supervised") maps to AumOS L4
   (`ACT_AND_REPORT`) — the agent acts independently but must report all
   outcomes for review.

5. **Bounded autonomy.** CSA Tier 5 and AumOS L5 both grant full execution
   authority, but both frameworks emphasize that "full autonomy" operates
   within defined policy boundaries, not without constraint.

## Key Differences

### 1. Assignment Mechanism

- **CSA:** The framework describes autonomy tiers as a classification
  taxonomy. It does not prescribe a specific runtime API for assigning tiers.
- **AumOS:** Trust levels are assigned at runtime via an explicit `assign()`
  API call made by a human operator. The assignment is persisted, scoped,
  and auditable.

### 2. Scope Granularity

- **CSA:** Autonomy tiers are typically described at the agent level.
- **AumOS:** Trust levels are assigned per (agent, scope) pair. A single
  agent can hold different levels for different operational scopes (e.g.,
  L4 for "read-data" and L2 for "modify-data").

### 3. Decay Mechanics

- **CSA:** The framework does not define an automatic decay mechanism for
  stale autonomy assignments.
- **AumOS:** The trust ladder includes optional decay (cliff or gradual)
  that automatically lowers the effective trust level if the assignment is
  not re-confirmed within a configurable TTL. This provides a safety net
  against forgotten assignments.

### 4. Runtime Enforcement

- **CSA:** The framework is a governance classification model. Enforcement
  is left to the implementing organization.
- **AumOS:** The `trust-ladder` package provides a runtime SDK with
  `check()` methods that return typed `TrustCheckResult` objects. Governance
  decisions can be enforced in code at the point of action.

### 5. Manual-Only Progression

- **CSA:** The framework acknowledges that organizations may implement
  various mechanisms for tier transitions.
- **AumOS:** Trust level changes are **strictly manual**. There is no
  automatic promotion, behavioural scoring, or agent self-modification of
  trust levels. This is a core design invariant (see FIRE_LINE.md).

## Mapping CSA Controls to AumOS Capabilities

| CSA Control Area                  | AumOS Implementation                                |
|-----------------------------------|-----------------------------------------------------|
| Agent identity and authentication | `agent_id` field on all assignments and checks      |
| Autonomy classification           | Six-level `TrustLevel` enum (L0–L5)                |
| Scope limitation                  | Per-scope assignments via `scope` parameter         |
| Decision audit trail              | `TrustChangeRecord` append-only history             |
| Time-bound authorization          | Cliff and gradual decay configurations              |
| Human oversight requirement       | L3 requires approval; L0–L2 are read/suggest only   |
| Accountability and reporting      | L4 mandates post-hoc reporting                      |

## Migration Guide

Organizations currently using the CSA Agentic Trust Framework can adopt
AumOS trust levels with the following steps:

1. **Map existing tier assignments.** For each agent, translate the CSA tier
   (0–5) to the corresponding AumOS trust level using the table above.

2. **Introduce scope granularity.** If agents operate across multiple
   domains, split single-tier assignments into per-scope AumOS assignments.

3. **Configure decay.** Set TTL-based decay for assignments that should not
   persist indefinitely without re-confirmation.

4. **Instrument enforcement.** Add `check()` calls at action boundaries to
   enforce trust levels at runtime.

5. **Enable audit logging.** Connect trust change records to the
   `audit-trail` package for a complete governance decision log.

## References

- Cloud Security Alliance — [AI Safety Initiative](https://cloudsecurityalliance.org/research/ai/)
- AumOS Trust Ladder — [trust-levels.md](./trust-levels.md)
- AumOS Decay Formula — [decay-formula.md](./decay-formula.md)
- AumOS Fire Line — [FIRE_LINE.md](../FIRE_LINE.md)

---

*Copyright (c) 2026 MuVeraAI Corporation. Licensed under BSL-1.1.*
