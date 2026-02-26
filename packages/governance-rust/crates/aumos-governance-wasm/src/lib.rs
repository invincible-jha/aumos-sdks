// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! # aumos-governance-wasm
//!
//! WebAssembly bindings for the AumOS governance SDK.
//!
//! This crate exposes a subset of the `aumos-governance-core` API to
//! JavaScript / TypeScript consumers via `wasm-bindgen`.
//!
//! ## Exported Functions
//!
//! | Function             | Description                                          |
//! |----------------------|------------------------------------------------------|
//! | `create_engine`      | Create a new engine instance and return its handle   |
//! | `check_action`       | Evaluate a governance action                         |
//! | `set_trust_level`    | Assign a trust level to an agent                     |
//! | `create_budget`      | Create a spending envelope                           |
//! | `record_consent`     | Record a consent grant                               |
//! | `revoke_consent`     | Revoke an existing consent grant                     |
//!
//! ## JavaScript Usage
//!
//! ```js
//! import init, {
//!   create_engine,
//!   set_trust_level,
//!   create_budget,
//!   record_consent,
//!   check_action,
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
//! const result = check_action(handle, 'send_payment', JSON.stringify({
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

/// Allocate a new engine handle.
fn next_handle() -> u32 {
    NEXT_HANDLE.with(|counter| {
        let handle = *counter.borrow();
        *counter.borrow_mut() = handle.wrapping_add(1);
        handle
    })
}

// ---------------------------------------------------------------------------
// Exported WASM functions
// ---------------------------------------------------------------------------

/// Create a new [`GovernanceEngine`] with default configuration and return
/// its integer handle.
///
/// Pass this handle to all subsequent function calls.
///
/// # JavaScript
///
/// ```js
/// const handle = create_engine();
/// ```
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
///
/// # JavaScript
///
/// ```js
/// const handle = create_engine_with_config(JSON.stringify({
///   require_consent: true,
///   default_observer_on_missing: false,
///   pass_on_missing_envelope: false,
/// }));
/// ```
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

/// Assign a trust level to an agent within the given scope.
///
/// `level` must be an integer `0..=5` matching the [`TrustLevel`] discriminant.
///
/// # JavaScript
///
/// ```js
/// set_trust_level(handle, 'agent-001', 'finance', 4, 'owner');
/// ```
#[wasm_bindgen]
pub fn set_trust_level(
    handle: u32,
    agent_id: &str,
    scope: &str,
    level: u8,
    assigned_by: &str,
) {
    let trust_level = match TrustLevel::from_u8(level) {
        Some(level) => level,
        None => return,
    };
    ENGINES.with(|engines| {
        if let Some(engine) = engines.borrow_mut().get_mut(&handle) {
            engine.trust.set_level(agent_id, scope, trust_level, assigned_by);
        }
    });
}

/// Create a spending envelope for `category`.
///
/// * `limit`        — maximum cumulative spend per period
/// * `period_ms`    — period length in milliseconds (`0` = no reset)
/// * `starts_at_ms` — Unix epoch ms at which the period begins (`0` = epoch)
///
/// # JavaScript
///
/// ```js
/// create_budget(handle, 'financial', 1000.0, 86_400_000, 0);
/// ```
#[wasm_bindgen]
pub fn create_budget(
    handle: u32,
    category: &str,
    limit: f64,
    period_ms: u32,
    starts_at_ms: u32,
) {
    ENGINES.with(|engines| {
        if let Some(engine) = engines.borrow_mut().get_mut(&handle) {
            engine.budget.create_envelope(
                category,
                limit,
                period_ms as u64,
                starts_at_ms as u64,
            );
        }
    });
}

/// Record a consent grant for `(agent_id, action)`.
///
/// # JavaScript
///
/// ```js
/// record_consent(handle, 'agent-001', 'process_pii');
/// ```
#[wasm_bindgen]
pub fn record_consent(handle: u32, agent_id: &str, action: &str) {
    ENGINES.with(|engines| {
        if let Some(engine) = engines.borrow_mut().get_mut(&handle) {
            engine.consent.record(agent_id, action);
        }
    });
}

/// Revoke a previously recorded consent grant for `(agent_id, action)`.
///
/// # JavaScript
///
/// ```js
/// revoke_consent(handle, 'agent-001', 'process_pii');
/// ```
#[wasm_bindgen]
pub fn revoke_consent(handle: u32, agent_id: &str, action: &str) {
    ENGINES.with(|engines| {
        if let Some(engine) = engines.borrow_mut().get_mut(&handle) {
            engine.consent.revoke(agent_id, action);
        }
    });
}

/// Evaluate a governance action and return a JSON-serialised [`Decision`].
///
/// `context_json` must be a JSON string matching the [`Context`] shape:
///
/// ```json
/// {
///   "agent_id":       "agent-001",
///   "scope":          "finance",
///   "required_trust": 4,
///   "cost":           50.0,
///   "category":       "financial",
///   "data_type":      "process_pii",
///   "purpose":        null
/// }
/// ```
///
/// Returns a JSON string of the [`Decision`], or `{"error":"..."}` on
/// parse failure or unknown handle.
///
/// # JavaScript
///
/// ```js
/// const result = check_action(handle, 'send_payment', JSON.stringify({
///   agent_id: 'agent-001',
///   scope: 'finance',
///   required_trust: 4,
///   cost: 50.0,
///   category: 'financial',
///   data_type: 'process_pii',
///   purpose: null,
/// }));
/// const decision = JSON.parse(result);
/// ```
#[wasm_bindgen]
pub fn check_action(handle: u32, action: &str, context_json: &str) -> String {
    let context: Context = match serde_json::from_str(context_json) {
        Ok(ctx) => ctx,
        Err(error) => {
            return format!("{{\"error\":\"context parse error: {}\"}}", error);
        }
    };

    ENGINES.with(|engines| {
        let mut engines = engines.borrow_mut();
        match engines.get_mut(&handle) {
            Some(engine) => {
                let decision = engine.check(action, &context);
                serde_json::to_string(&decision).unwrap_or_else(|error| {
                    format!("{{\"error\":\"serialisation error: {}\"}}", error)
                })
            }
            None => {
                format!("{{\"error\":\"unknown engine handle {}\"}}", handle)
            }
        }
    })
}

/// Query the audit log and return a JSON-serialised array of [`AuditRecord`]s.
///
/// `filter_json` must be a JSON string matching the [`AuditFilter`] shape:
///
/// ```json
/// {
///   "agent_id":  "agent-001",
///   "action":    "send_payment",
///   "since_ms":  1700000000000,
///   "until_ms":  null,
///   "limit":     50
/// }
/// ```
///
/// Pass `"{}"` to retrieve all records.
///
/// Returns a JSON array string, or `"[]"` on error.
///
/// # JavaScript
///
/// ```js
/// const records = JSON.parse(query_audit(handle, JSON.stringify({ limit: 20 })));
/// ```
#[wasm_bindgen]
pub fn query_audit(handle: u32, filter_json: &str) -> String {
    let filter: AuditFilter = match serde_json::from_str(filter_json) {
        Ok(f) => f,
        Err(_) => AuditFilter::default(),
    };

    ENGINES.with(|engines| {
        let engines = engines.borrow();
        match engines.get(&handle) {
            Some(engine) => {
                let records = engine.audit.query(&filter);
                serde_json::to_string(&records).unwrap_or_else(|_| "[]".into())
            }
            None => "[]".into(),
        }
    })
}

/// Release the engine associated with `handle`, freeing its memory.
///
/// After calling this function the handle is no longer valid.
///
/// # JavaScript
///
/// ```js
/// destroy_engine(handle);
/// ```
#[wasm_bindgen]
pub fn destroy_engine(handle: u32) {
    ENGINES.with(|engines| {
        engines.borrow_mut().remove(&handle);
    });
}
