// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! # aumos-governance-wasm
//!
//! WebAssembly bindings for the AumOS governance SDK.
//!
//! This crate exposes the `aumos-governance-core` API to JavaScript and
//! TypeScript consumers running in browser or edge-worker environments via
//! `wasm-bindgen`.
//!
//! ## Architecture
//!
//! Each [`WasmGovernanceEngine`] wraps a [`GovernanceEngine<InMemoryStorage>`].
//! Engine instances are stored in a thread-local registry keyed by integer
//! handles because WASM is single-threaded and `wasm_bindgen` cannot export
//! opaque Rust structs across the JS boundary without serialisation overhead.
//!
//! ## Exported Functions
//!
//! | Function                    | Description                                           |
//! |-----------------------------|-------------------------------------------------------|
//! | `create_engine`             | Create a new engine with default config               |
//! | `create_engine_with_config` | Create a new engine with explicit JSON config          |
//! | `evaluate`                  | Evaluate a governance action (JSON in, JSON out)       |
//! | `check_trust`               | Check whether an agent meets a required trust level    |
//! | `check_budget`              | Check whether an envelope has headroom for a spend     |
//! | `set_trust_level`           | Assign a trust level to an agent                       |
//! | `create_budget`             | Create a spending envelope                             |
//! | `record_consent`            | Record a consent grant                                 |
//! | `revoke_consent`            | Revoke a consent grant                                 |
//! | `get_audit_trail`           | Return the full audit trail as a JSON array            |
//! | `query_audit`               | Query the audit trail with a JSON filter               |
//! | `destroy_engine`            | Release an engine handle and free its memory           |
//!
//! ## JavaScript Usage
//!
//! ```js
//! import init, {
//!   create_engine,
//!   set_trust_level,
//!   create_budget,
//!   record_consent,
//!   evaluate,
//!   check_trust,
//!   check_budget,
//!   get_audit_trail,
//! } from '@aumos/governance-wasm';
//!
//! await init();
//!
//! const handle = create_engine();
//!
//! set_trust_level(handle, 'agent-001', 'finance', 4, 'owner');
//! create_budget(handle, 'financial', 1000.0, 86_400_000, 0);
//! record_consent(handle, 'agent-001', 'process_pii');
//!
//! // Quick trust gate check
//! const trusted = check_trust(handle, 'agent-001', 'finance', 2);
//! console.log('Trusted:', trusted); // true
//!
//! // Quick budget check
//! const affordable = check_budget(handle, 'financial', 50.0);
//! console.log('Affordable:', affordable); // true
//!
//! // Full governance evaluation
//! const result = evaluate(handle, 'send_payment', JSON.stringify({
//!   agent_id:       'agent-001',
//!   scope:          'finance',
//!   required_trust: 4,
//!   cost:           50.0,
//!   category:       'financial',
//!   data_type:      'process_pii',
//!   purpose:        null,
//! }));
//!
//! const decision = JSON.parse(result);
//! console.log(decision.permitted); // true
//!
//! // Retrieve audit trail
//! const trail = JSON.parse(get_audit_trail(handle));
//! console.log('Audit entries:', trail.length);
//! ```

use aumos_governance_core::{
    config::Config,
    engine::GovernanceEngine,
    storage::InMemoryStorage,
    types::{AuditFilter, Context, TrustLevel},
};
use std::cell::RefCell;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Engine registry
// ---------------------------------------------------------------------------

// WASM is single-threaded; RefCell<HashMap<...>> is safe here.
thread_local! {
    static ENGINES: RefCell<HashMap<u32, GovernanceEngine<InMemoryStorage>>> =
        RefCell::new(HashMap::new());
    static NEXT_HANDLE: RefCell<u32> = RefCell::new(0);
}

/// Allocate a new engine handle. Handles wrap around at `u32::MAX - 1` to
/// reserve `u32::MAX` as the error sentinel.
fn next_handle() -> u32 {
    NEXT_HANDLE.with(|counter| {
        let handle = *counter.borrow();
        let next = if handle >= u32::MAX - 1 { 0 } else { handle + 1 };
        *counter.borrow_mut() = next;
        handle
    })
}

/// Helper: run a closure with mutable access to an engine. Returns
/// `Err(message)` if the handle is unknown.
fn with_engine_mut<F, R>(handle: u32, callback: F) -> Result<R, String>
where
    F: FnOnce(&mut GovernanceEngine<InMemoryStorage>) -> R,
{
    ENGINES.with(|engines| {
        let mut map = engines.borrow_mut();
        match map.get_mut(&handle) {
            Some(engine) => Ok(callback(engine)),
            None => Err(format!("unknown engine handle {}", handle)),
        }
    })
}

/// Helper: run a closure with shared access to an engine.
fn with_engine<F, R>(handle: u32, callback: F) -> Result<R, String>
where
    F: FnOnce(&GovernanceEngine<InMemoryStorage>) -> R,
{
    ENGINES.with(|engines| {
        let map = engines.borrow();
        match map.get(&handle) {
            Some(engine) => Ok(callback(engine)),
            None => Err(format!("unknown engine handle {}", handle)),
        }
    })
}

// ---------------------------------------------------------------------------
// Engine lifecycle
// ---------------------------------------------------------------------------

/// Create a new [`GovernanceEngine`] with default configuration and return
/// its integer handle.
///
/// Pass this handle to all subsequent function calls.
#[wasm_bindgen]
pub fn create_engine() -> u32 {
    let handle = next_handle();
    let engine = GovernanceEngine::new(Config::default(), InMemoryStorage::new());
    ENGINES.with(|engines| {
        engines.borrow_mut().insert(handle, engine);
    });
    handle
}

/// Create a new [`GovernanceEngine`] with explicit configuration.
///
/// `config_json` must be a JSON string matching the [`Config`] shape:
///
/// ```json
/// {
///   "require_consent": false,
///   "default_observer_on_missing": false,
///   "pass_on_missing_envelope": true
/// }
/// ```
///
/// Returns the integer engine handle, or `u32::MAX` on parse error.
#[wasm_bindgen]
pub fn create_engine_with_config(config_json: &str) -> u32 {
    let config: Config = match serde_json::from_str(config_json) {
        Ok(cfg) => cfg,
        Err(_) => return u32::MAX,
    };
    let handle = next_handle();
    let engine = GovernanceEngine::new(config, InMemoryStorage::new());
    ENGINES.with(|engines| {
        engines.borrow_mut().insert(handle, engine);
    });
    handle
}

/// Release the engine associated with `handle`, freeing its memory.
///
/// After calling this function the handle is no longer valid.
#[wasm_bindgen]
pub fn destroy_engine(handle: u32) {
    ENGINES.with(|engines| {
        engines.borrow_mut().remove(&handle);
    });
}

// ---------------------------------------------------------------------------
// Trust management
// ---------------------------------------------------------------------------

/// Assign a trust level to an agent within the given scope.
///
/// `level` must be an integer `0..=5` matching the [`TrustLevel`] discriminant.
///
/// Trust levels are set manually by an authorised owner. They are never
/// modified automatically by the engine.
#[wasm_bindgen]
pub fn set_trust_level(
    handle: u32,
    agent_id: &str,
    scope: &str,
    level: u8,
    assigned_by: &str,
) {
    let trust_level = match TrustLevel::from_u8(level) {
        Some(tl) => tl,
        None => return,
    };
    let _ = with_engine_mut(handle, |engine| {
        engine.trust.set_level(agent_id, scope, trust_level, assigned_by);
    });
}

/// Check whether an agent's current trust level meets or exceeds `required_level`.
///
/// `required_level` is a `u8` discriminant (`0..=5`). Returns `false` if the
/// handle is unknown or the level value is out of range.
#[wasm_bindgen]
pub fn check_trust(handle: u32, agent_id: &str, scope: &str, required_level: u8) -> bool {
    let required = match TrustLevel::from_u8(required_level) {
        Some(tl) => tl,
        None => return false,
    };
    with_engine(handle, |engine| {
        let result = engine.trust.check_level(agent_id, scope, required);
        result.permitted
    })
    .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Budget management
// ---------------------------------------------------------------------------

/// Create a spending envelope for `category`.
///
/// * `limit`        -- maximum cumulative spend per period
/// * `period_ms`    -- period length in milliseconds (`0` = no reset)
/// * `starts_at_ms` -- Unix epoch ms at which the period begins
#[wasm_bindgen]
pub fn create_budget(
    handle: u32,
    category: &str,
    limit: f64,
    period_ms: u32,
    starts_at_ms: u32,
) {
    let _ = with_engine_mut(handle, |engine| {
        engine.budget.create_envelope(
            category,
            limit,
            period_ms as u64,
            starts_at_ms as u64,
        );
    });
}

/// Check whether `amount` fits within the remaining headroom for `envelope_id`.
///
/// Returns `false` if the handle is unknown or the envelope does not exist
/// and the engine is in strict mode.
#[wasm_bindgen]
pub fn check_budget(handle: u32, envelope_id: &str, amount: f64) -> bool {
    with_engine(handle, |engine| {
        let result = engine.budget.check(envelope_id, amount);
        result.permitted
    })
    .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Consent management
// ---------------------------------------------------------------------------

/// Record a consent grant for `(agent_id, action)`.
#[wasm_bindgen]
pub fn record_consent(handle: u32, agent_id: &str, action: &str) {
    let _ = with_engine_mut(handle, |engine| {
        engine.consent.record(agent_id, action);
    });
}

/// Revoke a previously recorded consent grant for `(agent_id, action)`.
#[wasm_bindgen]
pub fn revoke_consent(handle: u32, agent_id: &str, action: &str) {
    let _ = with_engine_mut(handle, |engine| {
        engine.consent.revoke(agent_id, action);
    });
}

// ---------------------------------------------------------------------------
// Governance evaluation
// ---------------------------------------------------------------------------

/// Evaluate a governance action and return a JSON-serialised [`Decision`].
///
/// `action_json` must be a JSON string matching the [`Context`] shape. The
/// function returns a JSON string of the [`Decision`], or
/// `{"error":"..."}` on parse failure or unknown handle.
#[wasm_bindgen]
pub fn evaluate(handle: u32, action: &str, action_json: &str) -> String {
    let context: Context = match serde_json::from_str(action_json) {
        Ok(ctx) => ctx,
        Err(error) => {
            return format!("{{\"error\":\"context parse error: {}\"}}", error);
        }
    };

    match with_engine_mut(handle, |engine| {
        let decision = engine.check(action, &context);
        serde_json::to_string(&decision)
            .unwrap_or_else(|error| format!("{{\"error\":\"serialisation error: {}\"}}", error))
    }) {
        Ok(json) => json,
        Err(error) => format!("{{\"error\":\"{}\"}}", error),
    }
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/// Return the full audit trail as a JSON-serialised array of [`AuditRecord`]s.
///
/// Returns `"[]"` on error or if the trail is empty.
#[wasm_bindgen]
pub fn get_audit_trail(handle: u32) -> String {
    let filter = AuditFilter::default();
    with_engine(handle, |engine| {
        let records = engine.audit.query(&filter);
        serde_json::to_string(&records).unwrap_or_else(|_| "[]".into())
    })
    .unwrap_or_else(|_| "[]".into())
}

/// Query the audit log and return a JSON-serialised array of [`AuditRecord`]s.
///
/// `filter_json` must be a JSON string matching the [`AuditFilter`] shape.
/// Pass `"{}"` to retrieve all records.
#[wasm_bindgen]
pub fn query_audit(handle: u32, filter_json: &str) -> String {
    let filter: AuditFilter = match serde_json::from_str(filter_json) {
        Ok(f) => f,
        Err(_) => AuditFilter::default(),
    };

    with_engine(handle, |engine| {
        let records = engine.audit.query(&filter);
        serde_json::to_string(&records).unwrap_or_else(|_| "[]".into())
    })
    .unwrap_or_else(|_| "[]".into())
}

// ---------------------------------------------------------------------------
// wasm-bindgen-test stubs
// ---------------------------------------------------------------------------

#[cfg(all(test, target_arch = "wasm32"))]
mod wasm_tests {
    use super::*;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn test_create_and_destroy_engine() {
        let handle = create_engine();
        assert_ne!(handle, u32::MAX);
        destroy_engine(handle);
    }

    #[wasm_bindgen_test]
    fn test_create_engine_with_valid_config() {
        let config = r#"{"require_consent":true,"default_observer_on_missing":false,"pass_on_missing_envelope":false}"#;
        let handle = create_engine_with_config(config);
        assert_ne!(handle, u32::MAX);
        destroy_engine(handle);
    }

    #[wasm_bindgen_test]
    fn test_create_engine_with_invalid_config() {
        let handle = create_engine_with_config("not json");
        assert_eq!(handle, u32::MAX);
    }

    #[wasm_bindgen_test]
    fn test_trust_check_flow() {
        let handle = create_engine();
        set_trust_level(handle, "agent-001", "default", 4, "owner");

        // Level 2 (Suggest) should pass when agent has level 4 (ActAndReport).
        assert!(check_trust(handle, "agent-001", "default", 2));

        // Level 5 (Autonomous) should fail when agent has level 4.
        assert!(!check_trust(handle, "agent-001", "default", 5));

        destroy_engine(handle);
    }

    #[wasm_bindgen_test]
    fn test_budget_check_flow() {
        let handle = create_engine();
        create_budget(handle, "financial", 500.0, 0, 0);

        assert!(check_budget(handle, "financial", 250.0));
        assert!(!check_budget(handle, "financial", 501.0));

        destroy_engine(handle);
    }

    #[wasm_bindgen_test]
    fn test_full_evaluate() {
        let handle = create_engine();
        set_trust_level(handle, "agent-001", "finance", 4, "owner");
        create_budget(handle, "financial", 1000.0, 0, 0);
        record_consent(handle, "agent-001", "process_pii");

        let context_json = r#"{
            "agent_id":       "agent-001",
            "scope":          "finance",
            "required_trust": "ActAndReport",
            "cost":           50.0,
            "category":       "financial",
            "data_type":      "process_pii",
            "purpose":        null
        }"#;

        let result = evaluate(handle, "send_payment", context_json);
        assert!(!result.contains("error"));

        destroy_engine(handle);
    }

    #[wasm_bindgen_test]
    fn test_audit_trail_populated_after_evaluate() {
        let handle = create_engine();
        set_trust_level(handle, "agent-001", "default", 3, "owner");

        let context_json = r#"{
            "agent_id":       "agent-001",
            "scope":          "default",
            "required_trust": "Suggest",
            "cost":           null,
            "category":       "default",
            "data_type":      null,
            "purpose":        null
        }"#;

        let _ = evaluate(handle, "test_action", context_json);

        let trail = get_audit_trail(handle);
        assert_ne!(trail, "[]");

        destroy_engine(handle);
    }

    #[wasm_bindgen_test]
    fn test_unknown_handle_returns_error() {
        let result = evaluate(99999, "action", r#"{"agent_id":"x","scope":"x","required_trust":"Observer","cost":null,"category":"x","data_type":null,"purpose":null}"#);
        assert!(result.contains("error"));
    }
}

// ---------------------------------------------------------------------------
// Native unit tests (run with `cargo test` outside of WASM)
// ---------------------------------------------------------------------------

#[cfg(test)]
#[cfg(not(target_arch = "wasm32"))]
mod native_tests {
    use super::*;

    #[test]
    fn test_engine_lifecycle() {
        let handle = create_engine();
        assert_ne!(handle, u32::MAX);
        destroy_engine(handle);
    }

    #[test]
    fn test_trust_check() {
        let handle = create_engine();
        set_trust_level(handle, "agent-001", "ops", 3, "admin");
        assert!(check_trust(handle, "agent-001", "ops", 2));
        assert!(!check_trust(handle, "agent-001", "ops", 5));
        destroy_engine(handle);
    }

    #[test]
    fn test_budget_check() {
        let handle = create_engine();
        create_budget(handle, "tokens", 100.0, 0, 0);
        assert!(check_budget(handle, "tokens", 99.0));
        assert!(!check_budget(handle, "tokens", 101.0));
        destroy_engine(handle);
    }

    #[test]
    fn test_invalid_trust_level_is_noop() {
        let handle = create_engine();
        set_trust_level(handle, "agent-001", "ops", 99, "admin");
        assert!(!check_trust(handle, "agent-001", "ops", 0));
        destroy_engine(handle);
    }

    #[test]
    fn test_audit_trail_initially_empty() {
        let handle = create_engine();
        let trail = get_audit_trail(handle);
        assert_eq!(trail, "[]");
        destroy_engine(handle);
    }
}
