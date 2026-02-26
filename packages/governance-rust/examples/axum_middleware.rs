// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! # Axum Middleware Example
//!
//! Demonstrates how to integrate the governance engine into an Axum HTTP
//! server as a request-level middleware layer.
//!
//! Every inbound request carries `X-Agent-Id` and `X-Agent-Scope` headers.
//! The middleware extracts these, checks the trust gate, and either permits
//! the request downstream or rejects it with `403 Forbidden`.
//!
//! ## Running
//!
//! Add Axum and Tokio to a downstream crate's `Cargo.toml`:
//!
//! ```toml
//! axum            = "0.7"
//! tokio           = { version = "1", features = ["full"] }
//! tower           = "0.4"
//! tower-http      = { version = "0.5", features = ["trace"] }
//! aumos-governance-core = { path = "../crates/aumos-governance-core" }
//! aumos-governance-std  = { path = "../crates/aumos-governance-std" }
//! ```
//!
//! Then run:
//!
//! ```bash
//! cargo run --example axum_middleware
//! ```
//!
//! Test with:
//!
//! ```bash
//! # Permitted — agent has Suggest or higher
//! curl -H "X-Agent-Id: agent-api-001" \
//!      -H "X-Agent-Scope: api" \
//!      http://localhost:3000/data
//!
//! # Denied — no assignment for this agent/scope
//! curl -H "X-Agent-Id: unknown-agent" \
//!      -H "X-Agent-Scope: api" \
//!      http://localhost:3000/data
//! ```

// NOTE: This example requires `axum` and `tokio` as dev-dependencies in a
// crate that depends on aumos-governance-core.  The example is intentionally
// written as a self-contained illustration; the imports below are annotated
// with the crates they originate from.

use aumos_governance_core::{
    config::Config,
    engine::GovernanceEngine,
    storage::InMemoryStorage,
    types::{Context, TrustLevel},
};
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// Shared engine wrapper
// ---------------------------------------------------------------------------

/// Thread-safe engine handle that can be shared across Axum handlers.
///
/// In production you would replace `InMemoryStorage` with a storage
/// implementation backed by your database or `aumos-governance-std::FileStorage`.
type SharedEngine = Arc<Mutex<GovernanceEngine<InMemoryStorage>>>;

/// Construct a pre-seeded governance engine for the API server.
fn build_engine() -> GovernanceEngine<InMemoryStorage> {
    let storage = InMemoryStorage::new();
    let config = Config {
        default_observer_on_missing: false,
        pass_on_missing_envelope: true,
        require_consent: false,
    };

    let mut engine = GovernanceEngine::new(config, storage);

    // Pre-seed trust assignments for known API agents.
    // Trust is always set manually — never automatically promoted.
    engine
        .trust
        .set_level("agent-api-001", "api", TrustLevel::Suggest, "owner");
    engine
        .trust
        .set_level("agent-api-002", "api", TrustLevel::ActAndReport, "owner");

    engine
}

// ---------------------------------------------------------------------------
// Middleware logic (framework-agnostic helper)
// ---------------------------------------------------------------------------

/// Governance check result returned by the middleware gate.
#[derive(Debug)]
pub struct GateResult {
    /// Whether the request is permitted to proceed.
    pub permitted: bool,
    /// Human-readable explanation for the `403` body or log line.
    pub reason: String,
    /// The HTTP status code to use when denying.
    pub status: u16,
}

/// Evaluate whether the given agent is allowed to perform `action` in `scope`.
///
/// This function is the framework-agnostic core of the middleware.  Call it
/// from an Axum `middleware::from_fn` closure, a Tower layer, or any other
/// request interceptor.
pub fn governance_gate(
    engine: &mut GovernanceEngine<InMemoryStorage>,
    agent_id: &str,
    scope: &str,
    action: &str,
    required_trust: TrustLevel,
) -> GateResult {
    let context = Context {
        agent_id: agent_id.into(),
        scope: scope.into(),
        required_trust,
        cost: None,
        category: "api".into(),
        data_type: None,
        purpose: None,
    };

    let decision = engine.check(action, &context);

    GateResult {
        permitted: decision.permitted,
        reason: decision.reason,
        status: if decision.permitted { 200 } else { 403 },
    }
}

// ---------------------------------------------------------------------------
// Pseudo-main — illustrates how the middleware would be wired
// ---------------------------------------------------------------------------

fn main() {
    // Build the shared engine once at server startup.
    let engine: SharedEngine = Arc::new(Mutex::new(build_engine()));

    // ---------------------------------------------------------------------------
    // Illustrate the middleware logic without pulling in the full Axum stack so
    // this example compiles in the workspace without extra dependencies.
    // ---------------------------------------------------------------------------

    println!("AumOS Governance SDK — Axum Middleware Example\n");
    println!("Simulating three incoming HTTP requests:\n");

    let requests = vec![
        ("agent-api-001", "api", "GET /data",    TrustLevel::Suggest),
        ("agent-api-002", "api", "POST /mutate", TrustLevel::ActAndReport),
        ("unknown-agent", "api", "DELETE /nuke", TrustLevel::Autonomous),
    ];

    for (agent_id, scope, action, required) in requests {
        let mut locked_engine = engine.lock().unwrap();
        let result = governance_gate(&mut locked_engine, agent_id, scope, action, required);
        drop(locked_engine);

        if result.permitted {
            println!(
                "  PERMIT {} — {} ({})",
                agent_id, action, result.reason
            );
        } else {
            println!(
                "  DENY   {} — {} → HTTP {} ({})",
                agent_id, action, result.status, result.reason
            );
        }
    }

    println!("\nAxum wiring (pseudo-code):");
    println!(
        r#"
  // In your actual Axum server:

  let app = Router::new()
      .route("/data",   get(data_handler))
      .route("/mutate", post(mutate_handler))
      .layer(middleware::from_fn_with_state(
          engine.clone(),
          governance_middleware,
      ));

  async fn governance_middleware(
      State(engine): State<SharedEngine>,
      headers: HeaderMap,
      request: Request,
      next: Next,
  ) -> Response {{
      let agent_id = headers
          .get("x-agent-id")
          .and_then(|v| v.to_str().ok())
          .unwrap_or("unknown");
      let scope = headers
          .get("x-agent-scope")
          .and_then(|v| v.to_str().ok())
          .unwrap_or("default");

      let result = {{
          let mut engine = engine.lock().unwrap();
          governance_gate(&mut engine, agent_id, scope, "http_request", TrustLevel::Suggest)
      }};

      if result.permitted {{
          next.run(request).await
      }} else {{
          (StatusCode::FORBIDDEN, result.reason).into_response()
      }}
  }}
"#
    );

    println!("Done.");
}
