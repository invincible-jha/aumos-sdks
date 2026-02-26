# Fire Line — aumos-governance (Python SDK)

## Allowed Public API (Complete List)

### TrustManager
- `set_level()` — assign a trust level to an agent
- `get_level()` — retrieve effective level with decay
- `check_level()` — evaluate whether agent meets required level

### BudgetManager
- `create_budget()` — create a spending envelope
- `record_spending()` — record a spending transaction
- `check_budget()` — check if spending is within limits

### ConsentManager
- `record_consent()` — record a consent grant
- `check_consent()` — check for active consent
- `revoke_consent()` — revoke an existing consent

### AuditLogger
- `log()` — record a governance decision
- `query()` — search/filter audit records

### GovernanceEngine
- `evaluate()` / `evaluate_sync()` — sequential pipeline: trust -> budget -> consent -> audit

## FORBIDDEN — Do NOT Add

### Methods
- `progress_level()`, `promote_level()`, `compute_trust_score()`, `behavioral_score()`
- `optimize_budget()`, `predict_spending()`, `adaptive_budget()`
- `detect_anomaly()`, `generate_counterfactual()`

### Concepts
- PersonalWorldModel, MissionAlignment, SocialTrust
- CognitiveLoop, AttentionFilter, GOVERNANCE_PIPELINE
- Adaptive trust progression (auto-promote based on behavior)
- Cross-protocol orchestration or parallel evaluation
- ML-based budget optimization or prediction
- Anomaly detection on audit records
- Real-time alerting or cross-agent correlation

### Architecture
- All storage MUST be in-memory (dict/list/deque)
- No database schemas revealing production design
- No latency targets or performance thresholds
- No specific tuning parameter values
