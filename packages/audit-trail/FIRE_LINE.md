# FIRE LINE — audit-trail

**This file is non-negotiable.  Read it before modifying any source file.**

## What this package IS

An append-only, hash-chained logger for AI agent governance decisions.

Permitted public API:
- `log(decision)` — record a governance decision
- `query(filter)` — retrieve logged decisions
- `verify()` — check hash chain integrity
- `exportRecords(format, filter?)` — export to JSON / CSV / CEF
- `count()` — number of records in the store

## What this package is NOT

This package must NEVER implement:

| Forbidden capability              | Reason                                          |
| --------------------------------- | ----------------------------------------------- |
| Anomaly detection                 | Analysis is proprietary product IP              |
| Counterfactual / what-if fields   | Reveals internal reasoning architecture         |
| Real-time alerting                | Out of scope — log and query only               |
| Cross-agent correlation           | Single-agent trail only                         |
| Trust score computation           | Proprietary MuVeraAI IP                         |
| Behavioral scoring                | Proprietary MuVeraAI IP                         |
| Adaptive budget calculation       | Proprietary MuVeraAI IP                         |
| Auto-promotion of trust levels    | Manual-only in OSS                              |

## Forbidden identifiers

These strings must NEVER appear in any source file in this package:

```
detectAnomaly
generateCounterfactual
PersonalWorldModel
MissionAlignment
SocialTrust
CognitiveLoop
AttentionFilter
GOVERNANCE_PIPELINE
progressLevel
promoteLevel
computeTrustScore
behavioralScore
adaptiveBudget
optimizeBudget
predictSpending
```

Run `npm run fire-line-audit` from the monorepo root before every commit.

## AuditRecord — permitted fields only

```
id, timestamp, agentId, action, permitted,
trustLevel, requiredLevel, budgetUsed, budgetRemaining,
reason, metadata, previousHash, recordHash
```

No other fields may be added to `AuditRecord` without a product review.
