# Fire Line — aumos-governance-rust

This document defines the absolute boundary between open-source SDK code and
proprietary AumOS platform code.  Every contributor must read this before
opening a pull request.

---

## Allowed Public API (Complete List)

### TrustManager
- `set_level()` — assign a trust level to an agent
- `get_level()` — retrieve the current assignment
- `check_level()` — evaluate whether agent meets required level

### BudgetManager
- `create_envelope()` — create a static spending envelope
- `check()` — evaluate whether a spend fits within the envelope
- `record()` — debit a completed spend

### ConsentManager
- `record()` — record a consent grant
- `check()` — check for active consent
- `revoke()` — revoke an existing consent

### AuditLogger
- `log()` — record a governance decision
- `query()` — search/filter audit records

### GovernanceEngine
- `check()` — sequential pipeline: trust → budget → consent → audit
- `query_audit()` — convenience wrapper for `AuditLogger::query`

---

## FORBIDDEN — Do NOT Add

### Methods and Identifiers

```
progressLevel      promoteLevel       computeTrustScore  behavioralScore
adaptiveBudget     optimizeBudget     predictSpending
detectAnomaly      generateCounterfactual
PersonalWorldModel MissionAlignment   SocialTrust
CognitiveLoop      AttentionFilter    GOVERNANCE_PIPELINE
PWM                MAE                STP
```

### Concepts

- Adaptive trust progression (any automatic promotion based on behaviour)
- Behavioural scoring or trust score computation
- ML-based budget optimisation or spending prediction
- Anomaly detection on audit records
- Counterfactual generation from audit data
- Cross-protocol orchestration or parallel gate evaluation
- Real-time alerting or cross-agent correlation
- Three-tier attention filters
- Cognitive loops or personal world models

---

## Architecture Rules

- ALL storage MUST support in-memory operation (`InMemoryStorage`)
- Trust changes are **MANUAL ONLY** — the engine never changes a level itself
- Budget allocations are **STATIC ONLY** — no auto-rebalancing
- Audit logging is **RECORDING ONLY** — no analytics computed inside the crate
- No database schemas that reveal production design
- No numeric threshold values from production tuning
- No latency targets or performance requirements in comments or docs

---

## Rust-Specific Rules

- Core crate MUST compile with `#![no_std]` (use `cfg_attr`)
- No `unsafe` code in `aumos-governance-core`
- No `panic!` in library code — return `Result` or `Option`
- All public types implement `Clone`, `Debug`, `Serialize`, `Deserialize`
- Zero clippy warnings (`cargo clippy -- -D warnings`)

---

## Enforcement

```bash
# Run before every commit:
cargo clippy --workspace -- -D warnings
cargo fmt --all -- --check
grep -r "progressLevel\|promoteLevel\|computeTrustScore\|behavioralScore\|adaptiveBudget\|optimizeBudget\|predictSpending\|detectAnomaly\|generateCounterfactual\|PersonalWorldModel\|MissionAlignment\|SocialTrust\|CognitiveLoop\|AttentionFilter\|GOVERNANCE_PIPELINE" crates/
```

---

Copyright (c) 2026 MuVeraAI Corporation
