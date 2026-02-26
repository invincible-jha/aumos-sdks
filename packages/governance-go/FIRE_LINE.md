# Fire Line — governance-go

This document defines the absolute boundary between open-source SDK code and
proprietary AumOS platform code for the Go governance SDK.

## Forbidden identifiers

These identifiers MUST NEVER appear in any source file in this package:

```
progressLevel      promoteLevel       computeTrustScore  behavioralScore
adaptiveBudget     optimizeBudget     predictSpending
detectAnomaly      generateCounterfactual
PersonalWorldModel MissionAlignment   MissionAlignmentEngine
SocialTrust        SocialTrustProtocol CognitiveLoop
AttentionFilter    GOVERNANCE_PIPELINE
PWM                MAE                STP
```

## Allowed API surface

### TrustManager
- ALLOWED: `SetLevel()`, `GetLevel()`, `CheckLevel()`
- FORBIDDEN: Any method that changes trust based on observed behavior

### BudgetManager
- ALLOWED: `CreateEnvelope()`, `Check()`, `Record()`
- FORBIDDEN: Any method that adjusts limits based on usage patterns

### ConsentManager
- ALLOWED: `Record()`, `Check()`, `Revoke()`
- FORBIDDEN: Proactive consent suggestions or automatic grant escalation

### AuditLogger
- ALLOWED: `Log()`, `Query()`
- FORBIDDEN: `detectAnomaly()`, `generateCounterfactual()`, any ML analysis

### GovernanceEngine
- ALLOWED: Sequential evaluation (trust -> budget -> consent -> audit)
- FORBIDDEN: Cross-protocol optimization, parallel evaluation strategies

## Implementation constraints

- ALL storage is in-memory (MemoryStorage is the only bundled backend)
- NO latency targets in comments or code
- NO numeric threshold values from production system tuning
- Trust changes are MANUAL ONLY — operators call SetLevel
- Budget allocations are STATIC ONLY — CreateEnvelope sets a fixed limit
- Audit logging is RECORDING ONLY — Log and Query, nothing else

## Checking compliance

Run the fire-line audit from the monorepo root:

```bash
npm run fire-line-audit
```

The audit script greps all Go source files for forbidden identifiers.

---

Copyright (c) 2026 MuVeraAI Corporation
