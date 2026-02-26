# aumos-governance-rust

High-performance Rust governance SDK for the AumOS agent governance protocol.

**License:** BUSL-1.1
**Rust:** 1.75+
**Targets:** native, no_std, wasm32

---

## Crates

| Crate | Description | no_std |
|---|---|:---:|
| `aumos-governance-core` | Engine, types, in-memory storage | Yes |
| `aumos-governance-std`  | File-based JSON storage backend  | No  |
| `aumos-governance-wasm` | `wasm-bindgen` JS/TS bindings    | No  |

---

## Quick Start

```toml
# Cargo.toml
[dependencies]
aumos-governance-core = "0.1"
```

```rust
use aumos_governance_core::{
    GovernanceEngine,
    InMemoryStorage,
    config::Config,
    types::{Context, TrustLevel},
};

let mut engine = GovernanceEngine::new(Config::default(), InMemoryStorage::new());

// Assign a trust level (always manual — never automatic).
engine.trust.set_level("agent-001", "finance", TrustLevel::ActAndReport, "owner");

// Create a static spending envelope.
engine.budget.create_envelope("financial", 1_000.0, 86_400_000, 0);

// Record consent.
engine.consent.record("agent-001", "process_pii");

// Evaluate an action through the sequential pipeline.
let ctx = Context {
    agent_id:       "agent-001".into(),
    scope:          "finance".into(),
    required_trust: TrustLevel::Suggest,
    cost:           Some(250.0),
    category:       "financial".into(),
    data_type:      Some("process_pii".into()),
    purpose:        None,
};

let decision = engine.check("send_invoice", &ctx);
assert!(decision.permitted);
```

---

## Governance Pipeline

Sequential evaluation — all steps in fixed order, no skipping:

```
 Trust gate  ──► Budget gate ──► Consent gate ──► Audit record
   (always)      (if cost)       (if data_type)    (always)
```

Any gate failure short-circuits the remaining gates and returns a denied
decision immediately.  The audit record is always written regardless of outcome.

---

## Public API

### TrustManager

| Method | Description |
|---|---|
| `set_level(agent, scope, level, by)` | Assign a trust level (manual) |
| `get_level(agent, scope)` | Retrieve the current assignment |
| `check_level(agent, scope, required)` | Evaluate whether level is sufficient |

### BudgetManager

| Method | Description |
|---|---|
| `create_envelope(category, limit, period_ms, starts_at_ms)` | Define a static spending limit |
| `check(category, amount)` | Verify headroom without mutating |
| `record(category, amount)` | Debit a completed spend |

### ConsentManager

| Method | Description |
|---|---|
| `record(agent, action)` | Grant consent |
| `check(agent, action)` | Verify active consent |
| `revoke(agent, action)` | Withdraw consent |

### AuditLogger

| Method | Description |
|---|---|
| `log(decision)` | Append to the tamper-evident chain |
| `query(filter)` | Search / filter records |

### GovernanceEngine

| Method | Description |
|---|---|
| `check(action, &ctx)` | Sequential pipeline evaluation |
| `query_audit(filter)` | Convenience audit query wrapper |

---

## Storage

The `Storage` trait is the only persistence interface.  Implement it for any
backend:

```rust
use aumos_governance_core::storage::Storage;

struct MyStore;

impl Storage for MyStore {
    // ... 8 methods
}
```

Provided implementations:

| Type | Crate | Description |
|---|---|---|
| `InMemoryStorage` | `aumos-governance-core` | HashMap-backed, volatile |
| `FileStorage` | `aumos-governance-std` | Atomic JSON file, persistent |

---

## WASM

```bash
cd crates/aumos-governance-wasm
wasm-pack build --target web --out-dir pkg
```

```js
import init, { create_engine, set_trust_level, check_action } from './pkg/aumos_governance_wasm.js';
await init();
const handle = create_engine();
set_trust_level(handle, 'agent-001', 'default', 4, 'owner');
const decision = JSON.parse(check_action(handle, 'my_action', JSON.stringify({
  agent_id: 'agent-001', scope: 'default', required_trust: 2,
  cost: null, category: 'default', data_type: null, purpose: null,
})));
```

See [docs/wasm.md](./docs/wasm.md) for the complete guide.

---

## no_std

```toml
aumos-governance-core = { version = "0.1", default-features = false }
```

See [docs/no-std.md](./docs/no-std.md) for the complete guide.

---

## Examples

```bash
cargo run --example basic
cargo run --example axum_middleware
```

---

## Building

```bash
# All crates
cargo build --workspace

# Release (size-optimised)
cargo build --workspace --release

# WASM
wasm-pack build crates/aumos-governance-wasm --target web

# Lint
cargo clippy --workspace -- -D warnings

# Format
cargo fmt --all
```

---

## License

BUSL-1.1 — see [LICENSE](../../LICENSE).

Copyright (c) 2026 MuVeraAI Corporation
