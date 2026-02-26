# no_std Usage

`aumos-governance-core` compiles without the Rust standard library.  This
makes it suitable for embedded firmware, WASM runtimes, and any environment
where `std` is unavailable.

## Requirements

The crate requires the `alloc` crate.  This is available on all targets that
provide a global allocator — including:

- WASM (via `wasm-bindgen` or similar)
- ARM Cortex-M with `linked-list-allocator` or similar
- RISC-V embedded targets
- Custom OS kernels

## Cargo configuration

Disable default features to opt out of `std`:

```toml
[dependencies]
aumos-governance-core = { version = "0.1", default-features = false }
```

## Source-level attribute

The crate root carries:

```rust
#![cfg_attr(not(feature = "std"), no_std)]
extern crate alloc;
```

When the `std` feature is absent the compiler activates `no_std` mode and all
`alloc::` types (Vec, String, HashMap via hashbrown) replace their `std::`
equivalents.

## Providing a global allocator

Your binary crate must provide a `#[global_allocator]`.  For embedded targets:

```toml
# Cargo.toml
[dependencies]
linked-list-allocator = "0.10"
```

```rust
// main.rs or lib.rs
use linked_list_allocator::LockedHeap;

#[global_allocator]
static ALLOCATOR: LockedHeap = LockedHeap::empty();
```

For WASM, `wasm-bindgen` installs an allocator automatically.

## Time in no_std mode

In `no_std` mode `current_time_ms()` returns `0` because `std::time` is
unavailable.  If you need accurate timestamps:

1. Use `TrustManager::set_level_with_expiry` and pass your platform's time
   source explicitly.
2. Set `timestamp_ms` on `Context` before calling `engine.check`.

## Hash chain in no_std mode

The audit hash chain uses FNV-1a 64-bit (expanded to 64 hex chars) instead of
SHA-256.  FNV-1a is deterministic, allocation-free, and suitable for chain
linking.  If you require cryptographic-strength audit trails, layer an external
signing step on the records returned by `engine.query_audit`.

## Minimal example

```rust
#![no_std]
extern crate alloc;

use aumos_governance_core::{
    GovernanceEngine,
    InMemoryStorage,
    config::Config,
    types::{Context, TrustLevel},
};

fn check_on_embedded_target() -> bool {
    let mut engine = GovernanceEngine::new(Config::default(), InMemoryStorage::new());

    engine.trust.set_level("agent-fw-001", "sensor", TrustLevel::Suggest, "owner");

    let ctx = Context {
        agent_id:       alloc::string::String::from("agent-fw-001"),
        scope:          alloc::string::String::from("sensor"),
        required_trust: TrustLevel::Suggest,
        cost:           None,
        category:       alloc::string::String::from("sensor"),
        data_type:      None,
        purpose:        None,
    };

    engine.check("read_temperature", &ctx).permitted
}
```

## Feature matrix

| Feature | `std` (default) | `no_std` |
|---------|:--------------:|:--------:|
| `InMemoryStorage` | Yes | Yes |
| `FileStorage` (std crate) | Yes | No |
| WASM bindings | Yes | No |
| Accurate timestamps | Yes | No (returns 0) |
| SHA-256 hash chain | `DefaultHasher` | FNV-1a |
