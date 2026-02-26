# Fire Line — trust-ladder

This document defines the absolute boundary between open-source SDK code and
proprietary AumOS platform code for the trust-ladder package.

## What This Package Provides

- 6 discrete trust levels (integers 0–5)
- Manual assignment of levels by operators
- Time-based decay (cliff and gradual) that only lowers effective levels
- Per-scope isolation of trust state
- Immutable change history for audit

## What This Package Deliberately Does Not Provide

These capabilities are outside scope and must never be added:

- Automatic trust promotion based on agent behaviour
- Trust score computation from observations
- Behavioural metrics or performance indicators that influence trust
- Cross-scope trust inference or propagation
- Multi-dimensional trust vectors
- Any identifier from the forbidden list below

## Forbidden Identifiers

These must never appear in any source file in this package:

```
progressLevel      promoteLevel       computeTrustScore  behavioralScore
adaptiveBudget     optimizeBudget     predictSpending
detectAnomaly      generateCounterfactual
PersonalWorldModel MissionAlignment   MissionAlignmentEngine
SocialTrust        SocialTrustProtocol CognitiveLoop
AttentionFilter    GOVERNANCE_PIPELINE
PWM                MAE                STP
```

## Invariants Enforced in Code

1. `assign()` is the sole mechanism for trust level changes
2. `DecayEngine.compute()` never returns a level higher than `assignment.assignedLevel`
3. `TRUST_LEVEL_MIN` (0) is the decay floor — never a negative value
4. Scope keys include a null byte separator to prevent key collisions
5. History entries are append-only — no mutation of past records

---

Copyright (c) 2026 MuVeraAI Corporation
