# Fire Line — @aumos/governance (TypeScript SDK)

## Allowed Public API (Complete List)

### TrustManager
- `setLevel()` — assign a trust level to an agent
- `getLevel()` — retrieve effective level with decay
- `checkLevel()` — evaluate whether agent meets required level

### BudgetManager
- `createBudget()` — create a spending envelope
- `recordSpending()` — record a spending transaction
- `checkBudget()` — check if spending is within limits

### ConsentManager
- `recordConsent()` — record a consent grant
- `checkConsent()` — check for active consent
- `revokeConsent()` — revoke an existing consent

### AuditLogger
- `log()` — record a governance decision
- `query()` — search/filter audit records

### GovernanceEngine
- `evaluate()` — sequential pipeline: trust -> budget -> consent -> audit

## FORBIDDEN — Do NOT Add

### Methods
- `progressLevel()`, `promoteLevel()`, `computeTrustScore()`, `behavioralScore()`
- `optimizeBudget()`, `predictSpending()`, `adaptiveBudget()`
- `detectAnomaly()`, `generateCounterfactual()`

### Concepts
- PersonalWorldModel, MissionAlignment, SocialTrust
- CognitiveLoop, AttentionFilter, GOVERNANCE_PIPELINE
- Adaptive trust progression (auto-promote based on behavior)
- Cross-protocol orchestration or parallel evaluation
- ML-based budget optimization or prediction
- Anomaly detection on audit records
- Real-time alerting or cross-agent correlation

### Architecture
- All storage MUST be in-memory (Map/Array)
- No database schemas revealing production design
- No latency targets or performance thresholds
- No specific tuning parameter values
