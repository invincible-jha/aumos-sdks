# Fire Line — aumos-sdks

This document defines the absolute boundary between open-source SDK code and proprietary AumOS platform code.

## Forbidden Identifiers

These identifiers MUST NEVER appear in any source file:

```
progressLevel      promoteLevel       computeTrustScore  behavioralScore
adaptiveBudget     optimizeBudget     predictSpending
detectAnomaly      generateCounterfactual
PersonalWorldModel MissionAlignment   MissionAlignmentEngine
SocialTrust        SocialTrustProtocol CognitiveLoop
AttentionFilter    GOVERNANCE_PIPELINE
PWM                MAE                STP
```

## SDK-Specific Fire Line Rules

### TrustManager
- ALLOWED: `setLevel()`, `getLevel()`, `checkLevel()`
- FORBIDDEN: `progressLevel()`, `computeTrustScore()`, any adaptive method

### BudgetManager
- ALLOWED: `createBudget()`, `recordSpending()`, `checkBudget()`
- FORBIDDEN: `optimizeBudget()`, `predictSpending()`, adaptive allocation

### ConsentManager
- ALLOWED: `recordConsent()`, `checkConsent()`, `revokeConsent()`
- FORBIDDEN: proactive consent suggestions

### AuditLogger
- ALLOWED: `log()`, `query()`
- FORBIDDEN: `detectAnomaly()`, `generateCounterfactual()`

### GovernanceEngine
- ALLOWED: Sequential evaluation (trust -> budget -> consent -> audit)
- FORBIDDEN: Cross-protocol optimization, latency targets (<100ms)

## Additional Constraints

- ALL storage MUST be in-memory (no database schemas revealing production design)
- NO numeric threshold values from production tuning
- NO latency targets or performance requirements
- Trust changes are MANUAL ONLY
- Budget allocations are STATIC ONLY
- Audit logging is RECORDING ONLY

## Enforcement

Run `npm run fire-line-audit` before every commit.

---

Copyright (c) 2026 MuVeraAI Corporation
