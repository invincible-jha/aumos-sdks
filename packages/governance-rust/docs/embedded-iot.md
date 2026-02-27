<!-- SPDX-License-Identifier: BSL-1.1 -->
<!-- Copyright (c) 2026 MuVeraAI Corporation -->

# AumOS Governance for Embedded and IoT Devices

## Overview

The `aumos-governance-core` crate is designed from the ground up for
`no_std` compatibility, making it suitable for resource-constrained
embedded and IoT devices. Rust's zero-cost abstractions ensure that
governance enforcement adds no runtime overhead beyond what a hand-written
C implementation would require, while providing memory safety guarantees
that are critical in unattended, physically deployed systems.

## Why Rust for Embedded Governance

- **Zero-cost abstractions.** Generics, traits, and iterators compile
  down to the same machine code as manually inlined equivalents. There
  is no vtable dispatch or heap allocation in the hot path of a
  governance check.
- **No garbage collector.** Deterministic memory management means
  governance decisions complete in bounded time, which is essential for
  real-time control loops.
- **Memory safety without a runtime.** Buffer overflows, use-after-free,
  and data races are caught at compile time. This eliminates entire
  classes of vulnerabilities in devices that may be physically
  inaccessible for patching.

## `no_std` Compatibility

The core crate compiles in `no_std` mode when the `std` feature is
disabled. It requires only the `alloc` crate for heap-backed collections
(`Vec`, `String`, `HashMap` via `hashbrown`).

```toml
[dependencies]
aumos-governance-core = { version = "0.1", default-features = false }
```

In `no_std` mode, the following adaptations apply:

| Feature          | `std` mode                | `no_std` mode                     |
|------------------|---------------------------|-----------------------------------|
| Hash chain       | `DefaultHasher` (64-bit)  | FNV-1a 64-bit                     |
| Timestamps       | `SystemTime::now()`       | Returns `0` (caller injects time) |
| Storage          | `InMemoryStorage` (full)  | `InMemoryStorage` (full, alloc)   |
| Serialisation    | `serde_json` (std)        | `serde_json` (alloc-only)         |

## Compilation Targets

`aumos-governance-core` has been designed to compile for the following
embedded targets:

### ARM Cortex-M (thumbv7em-none-eabihf)

Suitable for STM32, nRF52, and similar microcontrollers running
bare-metal or under an RTOS such as RTIC or Embassy.

```bash
rustup target add thumbv7em-none-eabihf
cargo build --target thumbv7em-none-eabihf --no-default-features
```

### RISC-V (riscv32imac-unknown-none-elf)

Suitable for ESP32-C3 (via `esp-hal`) and other RISC-V microcontrollers.

```bash
rustup target add riscv32imac-unknown-none-elf
cargo build --target riscv32imac-unknown-none-elf --no-default-features
```

### ESP32 (Xtensa — via esp-rs toolchain)

The Xtensa-based ESP32 and ESP32-S2 require the `esp-rs` fork of the
Rust compiler. Once installed:

```bash
cargo build --target xtensa-esp32-none-elf --no-default-features
```

## Memory Footprint Considerations

The governance engine's memory consumption is dominated by the storage
backend. On constrained devices:

- **Trust assignments** consume approximately 120 bytes per agent-scope
  pair (agent ID string + scope string + `TrustAssignment` struct).
- **Budget envelopes** consume approximately 80 bytes per category.
- **Audit records** are the largest consumer. Each record is roughly
  300-500 bytes depending on action name length. On devices with limited
  RAM, consider capping the in-memory audit log at a fixed depth and
  flushing to flash or discarding the oldest entries.

For a typical deployment with 5 agents, 3 budget categories, and a
100-entry audit buffer, the total governance state fits comfortably
within 64 KB of RAM.

## Example: Governed AI-Powered Camera

Consider a smart camera at a warehouse entrance that uses on-device
ML to classify objects, read license plates, and detect anomalies.
The governance engine enforces access control over these capabilities:

```rust,no_run
use aumos_governance_core::{
    engine::GovernanceEngine,
    storage::InMemoryStorage,
    types::{Context, TrustLevel},
    config::Config,
};

// Initialise with no_std-compatible defaults.
let config = Config {
    require_consent: true,
    default_observer_on_missing: false,
    pass_on_missing_envelope: false,
};
let mut engine = GovernanceEngine::new(config, InMemoryStorage::new());

// Trust levels assigned at provisioning time (manual, static).
engine.trust.set_level("camera-ml", "visual", TrustLevel::ActAndReport, "fleet-owner");

// Budget: limit inference calls per hour.
engine.budget.create_envelope("inference", 500.0, 3_600_000, 0);

// Consent: license plate reading requires explicit consent.
engine.consent.record("camera-ml", "license_plate_read");

// At runtime: evaluate each ML inference request.
let action = Context {
    agent_id:       "camera-ml".into(),
    scope:          "visual".into(),
    required_trust: TrustLevel::ActAndReport,
    cost:           Some(1.0),
    category:       "inference".into(),
    data_type:      Some("license_plate_read".into()),
    purpose:        Some("vehicle_tracking".into()),
};

let decision = engine.check("classify_vehicle", &action);
if decision.permitted {
    // Proceed with inference.
} else {
    // Log denial and skip frame.
}
```

## Integration Patterns

- **Bare-metal / RTIC.** Create the engine at startup in a shared
  resource. Each RTIC task borrows the engine mutably to call `check()`.
- **Embassy (async).** Wrap the engine in a `Mutex` and access it from
  async tasks. The governance check itself is synchronous and completes
  in bounded time.
- **Zephyr RTOS (via Rust FFI).** Expose `check()` as a C-ABI function
  using `#[no_mangle]` and `extern "C"`. Call from Zephyr application
  threads.
