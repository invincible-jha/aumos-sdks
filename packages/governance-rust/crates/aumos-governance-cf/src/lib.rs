// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! # aumos-governance-cf
//!
//! Cloudflare Workers governance middleware for AumOS.
//!
//! This crate provides [`CfGovernanceMiddleware`], a thin integration layer
//! that evaluates the AumOS governance protocol against incoming HTTP
//! requests in a Cloudflare Workers environment. It uses Cloudflare KV to
//! look up agent trust levels and enforces static governance rules before
//! proxying permitted requests to an origin server.
//!
//! ## Architecture
//!
//! ```text
//! Incoming Request
//!     |
//!     v
//! [Extract agent ID from X-Agent-Id header]
//!     |
//!     v
//! [Look up trust level from Cloudflare KV]
//!     |
//!     v
//! [Evaluate GovernanceEngine.check()]
//!     |
//!     +--- Denied  --> 403 JSON response
//!     |
//!     +--- Allowed --> Proxy to origin
//! ```
//!
//! ## Configuration
//!
//! The middleware is configured via [`CfConfig`]:
//!
//! - `trust_kv_binding` -- name of the KV namespace binding in `wrangler.toml`
//! - `default_trust_level` -- trust level assigned to unknown agents (0..5)
//! - `required_trust_level` -- minimum trust level to pass the gate (0..5)
//! - `budget_category` -- category name for the spending envelope
//! - `budget_limit` -- maximum spend per period
//! - `require_consent` -- whether the consent gate is enforced
//!
//! ## Fire Line
//!
//! Trust levels stored in KV are set manually by operators. There is no
//! automatic promotion, no behavioural analysis, and no adaptive logic.

use aumos_governance_core::{
    config::Config,
    engine::GovernanceEngine,
    storage::InMemoryStorage,
    types::{AuditFilter, Context, TrustLevel},
};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Configuration for the Cloudflare Workers governance middleware.
///
/// # Example (wrangler.toml context)
///
/// ```toml
/// [vars]
/// AUMOS_TRUST_KV_BINDING = "TRUST_KV"
/// AUMOS_DEFAULT_TRUST = 0
/// AUMOS_REQUIRED_TRUST = 2
/// AUMOS_BUDGET_CATEGORY = "api-calls"
/// AUMOS_BUDGET_LIMIT = 1000.0
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CfConfig {
    /// Name of the Cloudflare KV namespace binding that stores agent trust
    /// level mappings. Each KV key is an agent ID; each value is a `u8`
    /// discriminant (`0..=5`).
    pub trust_kv_binding: String,

    /// Trust level assigned to agents not found in KV. Expressed as a `u8`
    /// discriminant (`0..=5`). Defaults to `0` (Observer).
    #[serde(default)]
    pub default_trust_level: u8,

    /// Minimum trust level required for a request to be permitted. Expressed
    /// as a `u8` discriminant (`0..=5`). Defaults to `2` (Suggest).
    #[serde(default = "default_required_trust")]
    pub required_trust_level: u8,

    /// Budget envelope category name. Defaults to `"api-calls"`.
    #[serde(default = "default_budget_category")]
    pub budget_category: String,

    /// Maximum spend per period for the budget envelope. Defaults to `1000.0`.
    #[serde(default = "default_budget_limit")]
    pub budget_limit: f64,

    /// Whether the consent gate is enforced. Defaults to `false`.
    #[serde(default)]
    pub require_consent: bool,
}

fn default_required_trust() -> u8 {
    2
}

fn default_budget_category() -> String {
    "api-calls".to_string()
}

fn default_budget_limit() -> f64 {
    1000.0
}

impl Default for CfConfig {
    fn default() -> Self {
        Self {
            trust_kv_binding: "TRUST_KV".to_string(),
            default_trust_level: 0,
            required_trust_level: default_required_trust(),
            budget_category: default_budget_category(),
            budget_limit: default_budget_limit(),
            require_consent: false,
        }
    }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/// Governance middleware for Cloudflare Workers.
///
/// Wraps a [`GovernanceEngine`] and evaluates incoming requests against the
/// configured governance policy.
///
/// # Usage (without the `cf-worker` feature, for testing)
///
/// ```rust
/// use aumos_governance_cf::{CfGovernanceMiddleware, CfConfig, MiddlewareDecision};
///
/// let config = CfConfig::default();
/// let middleware = CfGovernanceMiddleware::new(config);
///
/// // Simulate evaluating a request for an agent with trust level 3.
/// let decision = middleware.evaluate_agent("agent-001", 3, 1.0, "read_data");
/// assert!(matches!(decision, MiddlewareDecision::Allow { .. }));
/// ```
pub struct CfGovernanceMiddleware {
    config: CfConfig,
    engine: GovernanceEngine<InMemoryStorage>,
}

/// The result of middleware evaluation.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "outcome")]
pub enum MiddlewareDecision {
    /// The request is permitted. The caller should proxy to the origin.
    Allow {
        /// The agent's effective trust level.
        agent_trust_level: u8,
        /// Human-readable reason.
        reason: String,
    },
    /// The request is denied.
    Deny {
        /// HTTP status code to return (always 403).
        status: u16,
        /// Machine-readable denial code.
        code: String,
        /// Human-readable reason.
        reason: String,
    },
    /// The request is missing the required agent identification header.
    MissingAgent {
        /// HTTP status code to return (always 401).
        status: u16,
        /// Human-readable reason.
        reason: String,
    },
}

impl CfGovernanceMiddleware {
    /// Create a new middleware instance with the given configuration.
    ///
    /// The internal engine is initialised with [`InMemoryStorage`] and
    /// a default spending envelope derived from `config`.
    pub fn new(config: CfConfig) -> Self {
        let engine_config = Config {
            require_consent: config.require_consent,
            default_observer_on_missing: true,
            pass_on_missing_envelope: true,
        };

        let mut engine = GovernanceEngine::new(engine_config, InMemoryStorage::new());

        // Pre-create the budget envelope from config.
        engine.budget.create_envelope(
            &config.budget_category,
            config.budget_limit,
            86_400_000, // 24-hour period
            0,
        );

        Self { config, engine }
    }

    /// Evaluate an agent's request against the governance policy.
    ///
    /// This is the core logic, usable both in native tests and within the
    /// Cloudflare Workers `cf-worker` feature path.
    ///
    /// # Arguments
    ///
    /// * `agent_id` -- stable agent identifier extracted from the request
    /// * `trust_level_value` -- the agent's trust level as a `u8` (from KV)
    /// * `estimated_cost` -- estimated cost of the request
    /// * `action` -- human-readable action name
    pub fn evaluate_agent(
        &mut self,
        agent_id: &str,
        trust_level_value: u8,
        estimated_cost: f64,
        action: &str,
    ) -> MiddlewareDecision {
        // Resolve trust level from the raw u8, falling back to Observer.
        let trust_level = TrustLevel::from_u8(trust_level_value)
            .unwrap_or(TrustLevel::Observer);

        let required = TrustLevel::from_u8(self.config.required_trust_level)
            .unwrap_or(TrustLevel::Suggest);

        // Set the agent's trust level in the engine (manual assignment).
        self.engine.trust.set_level(agent_id, "default", trust_level, "kv-lookup");

        let context = Context {
            agent_id: agent_id.to_string(),
            scope: "default".to_string(),
            required_trust: required,
            cost: if estimated_cost > 0.0 {
                Some(estimated_cost)
            } else {
                None
            },
            category: self.config.budget_category.clone(),
            data_type: None,
            purpose: None,
        };

        let decision = self.engine.check(action, &context);

        if decision.permitted {
            MiddlewareDecision::Allow {
                agent_trust_level: trust_level as u8,
                reason: decision.reason,
            }
        } else {
            MiddlewareDecision::Deny {
                status: 403,
                code: "GOVERNANCE_DENIED".to_string(),
                reason: decision.reason,
            }
        }
    }

    /// Query the audit trail of governance decisions.
    ///
    /// Returns a JSON-serialisable vector of audit records.
    pub fn query_audit(&self, filter: &AuditFilter) -> String {
        let records = self.engine.audit.query(filter);
        serde_json::to_string(&records).unwrap_or_else(|_| "[]".to_string())
    }

    /// Access the current configuration.
    pub fn config(&self) -> &CfConfig {
        &self.config
    }
}

// ---------------------------------------------------------------------------
// Cloudflare Workers integration (behind feature flag)
// ---------------------------------------------------------------------------

/// Handle an incoming Cloudflare Workers request through the governance
/// middleware.
///
/// This function is only available when the `cf-worker` feature is enabled.
///
/// # Protocol
///
/// 1. Extract `X-Agent-Id` header from the request.
/// 2. Look up the agent's trust level from the configured KV namespace.
/// 3. Evaluate the governance engine.
/// 4. Return `403` JSON on deny, or proxy to origin on allow.
///
/// # Errors
///
/// Returns a `worker::Error` if KV access fails or the response cannot be
/// constructed.
#[cfg(feature = "cf-worker")]
pub async fn handle_request(
    req: worker::Request,
    env: worker::Env,
    config: &CfConfig,
) -> worker::Result<worker::Response> {
    // Step 1: Extract agent ID from the request header.
    let agent_id = match req.headers().get("X-Agent-Id")? {
        Some(id) => id,
        None => {
            let body = serde_json::json!({
                "outcome": "missing_agent",
                "status": 401,
                "reason": "Missing X-Agent-Id header"
            });
            return worker::Response::from_json(&body)
                .map(|resp| resp.with_status(401));
        }
    };

    // Step 2: Look up trust level from Cloudflare KV.
    let kv = env.kv(&config.trust_kv_binding)?;
    let trust_value: u8 = match kv.get(&agent_id).text().await? {
        Some(value) => value.parse::<u8>().unwrap_or(config.default_trust_level),
        None => config.default_trust_level,
    };

    // Step 3: Evaluate governance.
    let mut middleware = CfGovernanceMiddleware::new(config.clone());
    let action = req.path();
    let decision = middleware.evaluate_agent(&agent_id, trust_value, 1.0, &action);

    // Step 4: Return result.
    match decision {
        MiddlewareDecision::Allow { .. } => {
            // In a real deployment, this would proxy to the origin using
            // `Fetch::new_with_request`. For the middleware pattern, we
            // return a 200 with the decision body.
            worker::Response::from_json(&decision)
        }
        MiddlewareDecision::Deny { status, .. } => {
            worker::Response::from_json(&decision)
                .map(|resp| resp.with_status(status))
        }
        MiddlewareDecision::MissingAgent { status, .. } => {
            worker::Response::from_json(&decision)
                .map(|resp| resp.with_status(status))
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = CfConfig::default();
        assert_eq!(config.trust_kv_binding, "TRUST_KV");
        assert_eq!(config.default_trust_level, 0);
        assert_eq!(config.required_trust_level, 2);
        assert_eq!(config.budget_category, "api-calls");
    }

    #[test]
    fn test_middleware_allow_sufficient_trust() {
        let config = CfConfig {
            required_trust_level: 2,
            ..CfConfig::default()
        };
        let mut middleware = CfGovernanceMiddleware::new(config);
        let decision = middleware.evaluate_agent("agent-001", 3, 0.0, "read_data");
        assert!(matches!(decision, MiddlewareDecision::Allow { .. }));
    }

    #[test]
    fn test_middleware_deny_insufficient_trust() {
        let config = CfConfig {
            required_trust_level: 4,
            ..CfConfig::default()
        };
        let mut middleware = CfGovernanceMiddleware::new(config);
        let decision = middleware.evaluate_agent("agent-001", 1, 0.0, "delete_resource");
        assert!(matches!(decision, MiddlewareDecision::Deny { .. }));
    }

    #[test]
    fn test_middleware_deny_serialises_to_json() {
        let config = CfConfig {
            required_trust_level: 5,
            ..CfConfig::default()
        };
        let mut middleware = CfGovernanceMiddleware::new(config);
        let decision = middleware.evaluate_agent("agent-001", 0, 0.0, "nuke_prod");
        let json = serde_json::to_string(&decision).expect("serialisation should succeed");
        assert!(json.contains("GOVERNANCE_DENIED"));
    }

    #[test]
    fn test_config_deserialises_from_json() {
        let json = r#"{
            "trust_kv_binding": "MY_KV",
            "default_trust_level": 1,
            "required_trust_level": 3,
            "budget_category": "llm-tokens",
            "budget_limit": 500.0,
            "require_consent": true
        }"#;
        let config: CfConfig = serde_json::from_str(json).expect("should parse");
        assert_eq!(config.trust_kv_binding, "MY_KV");
        assert_eq!(config.required_trust_level, 3);
        assert!(config.require_consent);
    }

    #[test]
    fn test_audit_trail_populated_after_evaluation() {
        let config = CfConfig::default();
        let mut middleware = CfGovernanceMiddleware::new(config);
        let _ = middleware.evaluate_agent("agent-001", 3, 1.0, "test_action");
        let trail = middleware.query_audit(&AuditFilter::default());
        assert_ne!(trail, "[]");
    }

    #[test]
    fn test_budget_enforcement() {
        let config = CfConfig {
            budget_limit: 10.0,
            ..CfConfig::default()
        };
        let mut middleware = CfGovernanceMiddleware::new(config);

        // Set sufficient trust so only budget matters.
        let decision = middleware.evaluate_agent("agent-001", 4, 5.0, "action_1");
        assert!(matches!(decision, MiddlewareDecision::Allow { .. }));

        let decision = middleware.evaluate_agent("agent-001", 4, 5.0, "action_2");
        assert!(matches!(decision, MiddlewareDecision::Allow { .. }));

        // Budget is now exhausted (10.0 spent of 10.0 limit).
        let decision = middleware.evaluate_agent("agent-001", 4, 1.0, "action_3");
        assert!(matches!(decision, MiddlewareDecision::Deny { .. }));
    }
}
