# Quickstart — aumos-governance-rust

This guide walks you from zero to a working governance engine in under 5 minutes.

## Prerequisites

- Rust 1.75 or later (`rustup update stable`)
- Cargo (included with Rust)

## Add the dependency

In your `Cargo.toml`:

```toml
[dependencies]
aumos-governance-core = "0.1"
```

For file-based persistence add:

```toml
aumos-governance-std = "0.1"
```

## Create an engine

```rust
use aumos_governance_core::{
    GovernanceEngine,
    InMemoryStorage,
    config::Config,
};

let mut engine = GovernanceEngine::new(Config::default(), InMemoryStorage::new());
```

## Assign a trust level

Trust levels are always assigned manually by an authorised owner.  The engine
never promotes or modifies a level on its own.

```rust
use aumos_governance_core::types::TrustLevel;

engine.trust.set_level(
    "agent-001",   // agent identifier
    "finance",     // scope
    TrustLevel::ActAndReport,
    "owner",       // who is granting this level
);
```

The six available levels (ordered lowest to highest):

| Level              | Discriminant | Description                                      |
|--------------------|:------------:|--------------------------------------------------|
| `Observer`         | 0            | Read-only; no side effects permitted             |
| `Monitor`          | 1            | Monitoring and alerting; no mutations            |
| `Suggest`          | 2            | Proposals only; all output requires human review |
| `ActWithApproval`  | 3            | Acts with explicit per-action human approval     |
| `ActAndReport`     | 4            | Acts autonomously; all actions reported post-hoc |
| `Autonomous`       | 5            | Fully autonomous within assigned scope           |

## Create a spending envelope

Budget allocations are always static.

```rust
engine.budget.create_envelope(
    "financial",      // category
    1_000.0,          // limit (any unit — USD, tokens, API credits, …)
    86_400_000,       // period in milliseconds (here: 24 hours)
    0,                // period start (Unix epoch ms)
);
```

## Record consent

```rust
engine.consent.record("agent-001", "process_pii");
```

## Evaluate an action

```rust
use aumos_governance_core::types::{Context, TrustLevel};

let ctx = Context {
    agent_id:       "agent-001".into(),
    scope:          "finance".into(),
    required_trust: TrustLevel::Suggest,
    cost:           Some(250.0),
    category:       "financial".into(),
    data_type:      Some("process_pii".into()),
    purpose:        Some("invoice processing".into()),
};

let decision = engine.check("send_invoice", &ctx);

if decision.permitted {
    println!("Action permitted.");
} else {
    println!("Action denied: {}", decision.reason);
}
```

The sequential pipeline always follows this order:

1. **Trust gate** — fails if agent level is below `required_trust`
2. **Budget gate** — fails if `cost` exceeds envelope headroom (skipped when `cost` is `None`)
3. **Consent gate** — fails if no active consent exists (skipped when `data_type` is `None`)
4. **Audit** — always recorded regardless of outcome

## Query the audit log

```rust
use aumos_governance_core::types::AuditFilter;

let filter = AuditFilter {
    action: Some("send_invoice".into()),
    limit:  Some(50),
    ..AuditFilter::default()
};

let records = engine.query_audit(&filter);
for record in records {
    println!("{} permitted={}", record.decision.action, record.decision.permitted);
}
```

## Revoke consent

```rust
engine.consent.revoke("agent-001", "process_pii");
```

## Run the bundled example

```bash
git clone https://github.com/aumos-ai/aumos-sdks
cd aumos-sdks/packages/governance-rust
cargo run --example basic
```

## Next steps

- [no-std usage](./no-std.md) — embed in firmware or WASM targets
- [WASM bindings](./wasm.md) — use from JavaScript / TypeScript
