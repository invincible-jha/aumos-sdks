# FIRE LINE — Absolute Rules for budget-enforcer

This document records the non-negotiable constraints for this package. Any change that violates these rules must be rejected regardless of other justifications.

---

## 1. Budget limits are STATIC

Limits are set by the caller at envelope creation time. This library NEVER adjusts, scales, or auto-tunes a limit based on any observed data.

There is no adaptive logic. There is no "recommended limit" API. `limit` is set once. It does not change unless the caller explicitly calls `createEnvelope()` again.

## 2. No spending pattern analysis

This library does not analyse historical spending. It does not compute trends, velocities, rolling averages, or forecasts. It does not warn about unusual spend rates.

The only query operations permitted are point-in-time snapshots: how much is `spent`, how much is `committed`, how much is `available`.

## 3. No approval workflows

`check()` returns `permitted: true` or `permitted: false`. That is the complete interface.

There are no queues, no escalation paths, no human-in-the-loop hooks, and no deferred decisions. The caller receives the result and decides what to do. This library has no opinion on what happens next.

## 4. Forbidden identifiers

The following names must NEVER appear in source code, comments, documentation, variable names, or type names within this package:

`adaptiveBudget`, `optimizeBudget`, `predictSpending`, `detectAnomaly`, `generateCounterfactual`, `PersonalWorldModel`, `MissionAlignment`, `SocialTrust`, `CognitiveLoop`, `AttentionFilter`, `GOVERNANCE_PIPELINE`, `progressLevel`, `promoteLevel`, `computeTrustScore`, `behavioralScore`

## 5. No references to internal research

This package does not reference, implement, or expose any constructs from internal MuVeraAI research documents or theorem systems. All public API surface is defined in this package's own types.

---

Violations of these rules are bugs, not design decisions.
