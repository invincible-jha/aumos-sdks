// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! Async governance engine backed by Tokio.
//!
//! This module is only compiled when the `async` feature flag is enabled:
//!
//! ```toml
//! [dependencies]
//! aumos-governance-core = { version = "0.1", features = ["async"] }
//! ```
//!
//! # Design
//!
//! [`AsyncGovernanceEngine`] wraps each governance manager in a
//! [`tokio::sync::RwLock`] so that trust, budget, consent, and audit state
//! can be safely accessed from multiple Tokio tasks concurrently.
//!
//! Read operations (check_*) acquire a shared read lock.
//! Write operations (set_*, record_*, log) acquire an exclusive write lock.
//!
//! The evaluation pipeline remains sequential and non-configurable —
//! exactly as in the sync [`GovernanceEngine`]:
//!
//! 1. Trust gate
//! 2. Budget gate (skipped when cost is None)
//! 3. Consent gate (skipped when data_type is None)
//! 4. Audit log (always written)
//!
//! # Example
//!
//! ```rust,no_run
//! # #[cfg(feature = "async")]
//! # {
//! use aumos_governance_core::{
//!     async_engine::AsyncGovernanceEngine,
//!     storage::InMemoryStorage,
//!     types::{Context, TrustLevel},
//!     config::Config,
//! };
//!
//! #[tokio::main]
//! async fn main() {
//!     let engine = AsyncGovernanceEngine::new(Config::default(), InMemoryStorage::new());
//!
//!     engine.set_trust_level("agent-001", "ops", TrustLevel::ActAndReport, "owner").await;
//!
//!     let ctx = Context {
//!         agent_id:       "agent-001".into(),
//!         scope:          "ops".into(),
//!         required_trust: TrustLevel::Suggest,
//!         cost:           None,
//!         category:       "ops".into(),
//!         data_type:      None,
//!         purpose:        None,
//!     };
//!     let decision = engine.check("read_logs", &ctx).await;
//!     assert!(decision.permitted);
//! }
//! # }
//! ```

#![cfg(feature = "async")]

use std::sync::Arc;

use tokio::sync::RwLock;

use crate::audit::AuditLogger;
use crate::budget::BudgetManager;
use crate::config::Config;
use crate::consent::ConsentManager;
use crate::storage::Storage;
use crate::trust::TrustManager;
use crate::types::{
    AuditFilter, AuditRecord, BudgetResult, ConsentResult, Context, Decision,
    TrustLevel, TrustResult,
};

// ---------------------------------------------------------------------------
// AsyncGovernanceEngine
// ---------------------------------------------------------------------------

/// Async governance engine with Tokio `RwLock`-protected managers.
///
/// Constructed via [`AsyncGovernanceEngine::new`] when the storage type
/// implements `Clone`, or via [`AsyncGovernanceEngine::from_parts`] for
/// custom storage configurations.
pub struct AsyncGovernanceEngine<S: Storage> {
    trust:   Arc<RwLock<TrustManager<S>>>,
    budget:  Arc<RwLock<BudgetManager<S>>>,
    consent: Arc<RwLock<ConsentManager<S>>>,
    audit:   Arc<RwLock<AuditLogger<S>>>,
}

impl<S: Storage + Clone> AsyncGovernanceEngine<S> {
    /// Construct a new [`AsyncGovernanceEngine`].
    ///
    /// `storage` is cloned once per manager — same semantics as the sync
    /// [`GovernanceEngine::new`].
    pub fn new(config: Config, storage: S) -> Self {
        Self {
            trust:   Arc::new(RwLock::new(TrustManager::new(config.clone(), storage.clone()))),
            budget:  Arc::new(RwLock::new(BudgetManager::new(config.clone(), storage.clone()))),
            consent: Arc::new(RwLock::new(ConsentManager::new(config.clone(), storage.clone()))),
            audit:   Arc::new(RwLock::new(AuditLogger::new(storage))),
        }
    }
}

impl<S: Storage> AsyncGovernanceEngine<S> {
    /// Construct an [`AsyncGovernanceEngine`] from four pre-built managers.
    pub fn from_parts(
        trust:   TrustManager<S>,
        budget:  BudgetManager<S>,
        consent: ConsentManager<S>,
        audit:   AuditLogger<S>,
    ) -> Self {
        Self {
            trust:   Arc::new(RwLock::new(trust)),
            budget:  Arc::new(RwLock::new(budget)),
            consent: Arc::new(RwLock::new(consent)),
            audit:   Arc::new(RwLock::new(audit)),
        }
    }

    // -----------------------------------------------------------------------
    // Trust
    // -----------------------------------------------------------------------

    /// Assign a trust level to an agent asynchronously.
    ///
    /// Trust changes are always initiated by an authorised owner —
    /// they are never generated automatically by the system.
    pub async fn set_trust_level(
        &self,
        agent_id: &str,
        scope: &str,
        level: TrustLevel,
        assigned_by: &str,
    ) {
        let mut manager = self.trust.write().await;
        manager.set_level(agent_id, scope, level, assigned_by);
    }

    /// Check whether an agent holds the required trust level.
    pub async fn check_trust(
        &self,
        agent_id: &str,
        scope: &str,
        required: TrustLevel,
    ) -> TrustResult {
        let manager = self.trust.read().await;
        manager.check_level(agent_id, scope, required)
    }

    // -----------------------------------------------------------------------
    // Budget
    // -----------------------------------------------------------------------

    /// Check whether a spending envelope has sufficient headroom.
    pub async fn check_budget(&self, category: &str, amount: f64) -> BudgetResult {
        let manager = self.budget.read().await;
        manager.check(category, amount)
    }

    /// Record an actual spend against a budget envelope.
    pub async fn record_spend(&self, category: &str, amount: f64) {
        let mut manager = self.budget.write().await;
        manager.record(category, amount);
    }

    // -----------------------------------------------------------------------
    // Consent
    // -----------------------------------------------------------------------

    /// Check whether active consent exists for an agent to perform an action.
    pub async fn check_consent(&self, agent_id: &str, action: &str) -> ConsentResult {
        let manager = self.consent.read().await;
        manager.check(agent_id, action)
    }

    /// Record explicit consent for an agent to perform a class of action.
    pub async fn record_consent(
        &self,
        agent_id: &str,
        action: &str,
        expires_at_ms: Option<u64>,
    ) {
        let mut manager = self.consent.write().await;
        manager.record(agent_id, action, expires_at_ms);
    }

    /// Revoke consent for an agent / action pair.
    pub async fn revoke_consent(&self, agent_id: &str, action: &str) {
        let mut manager = self.consent.write().await;
        manager.revoke(agent_id, action);
    }

    // -----------------------------------------------------------------------
    // Core evaluation pipeline
    // -----------------------------------------------------------------------

    /// Evaluate a governance action asynchronously.
    ///
    /// The evaluation pipeline is sequential:
    /// 1. Trust gate
    /// 2. Budget gate (skipped when `ctx.cost` is `None`)
    /// 3. Consent gate (skipped when `ctx.data_type` is `None`)
    /// 4. Audit log (always written)
    pub async fn check(&self, action: &str, ctx: &Context) -> Decision {
        use std::time::{SystemTime, UNIX_EPOCH};
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        // Step 1: Trust gate.
        let trust_result: TrustResult = {
            let manager = self.trust.read().await;
            manager.check_level(&ctx.agent_id, &ctx.scope, ctx.required_trust)
        };

        if !trust_result.permitted {
            let decision = Decision {
                permitted: false,
                trust: trust_result,
                budget: skipped_budget_result(&ctx.category),
                consent: skipped_consent_result(),
                action: action.into(),
                timestamp_ms,
                reason: "Trust gate denied.".into(),
            };
            self.append_audit(decision.clone()).await;
            return decision;
        }

        // Step 2: Budget gate.
        let budget_result: BudgetResult = match ctx.cost {
            Some(amount) if amount > 0.0 => {
                let result = {
                    let manager = self.budget.read().await;
                    manager.check(&ctx.category, amount)
                };
                if result.permitted {
                    let mut manager = self.budget.write().await;
                    manager.record(&ctx.category, amount);
                }
                result
            }
            _ => skipped_budget_result(&ctx.category),
        };

        if !budget_result.permitted {
            let decision = Decision {
                permitted: false,
                trust: trust_result,
                budget: budget_result,
                consent: skipped_consent_result(),
                action: action.into(),
                timestamp_ms,
                reason: "Budget gate denied.".into(),
            };
            self.append_audit(decision.clone()).await;
            return decision;
        }

        // Step 3: Consent gate.
        let consent_result: ConsentResult = match &ctx.data_type {
            Some(data_type) => {
                let manager = self.consent.read().await;
                manager.check(&ctx.agent_id, data_type)
            }
            None => skipped_consent_result(),
        };

        if !consent_result.permitted {
            let decision = Decision {
                permitted: false,
                trust: trust_result,
                budget: budget_result,
                consent: consent_result,
                action: action.into(),
                timestamp_ms,
                reason: "Consent gate denied.".into(),
            };
            self.append_audit(decision.clone()).await;
            return decision;
        }

        // Step 4: All gates passed.
        let decision = Decision {
            permitted: true,
            trust: trust_result,
            budget: budget_result,
            consent: consent_result,
            action: action.into(),
            timestamp_ms,
            reason: "All governance gates passed.".into(),
        };

        self.append_audit(decision.clone()).await;
        decision
    }

    // -----------------------------------------------------------------------
    // Audit
    // -----------------------------------------------------------------------

    /// Append a decision to the audit log asynchronously.
    async fn append_audit(&self, decision: Decision) {
        let mut logger = self.audit.write().await;
        logger.log(decision);
    }

    /// Query the audit log asynchronously.
    pub async fn query_audit(&self, filter: &AuditFilter) -> Vec<AuditRecord> {
        let logger = self.audit.read().await;
        logger.query(filter)
    }
}

// ---------------------------------------------------------------------------
// Helpers (mirror the sync engine)
// ---------------------------------------------------------------------------

fn skipped_budget_result(category: &str) -> BudgetResult {
    BudgetResult {
        permitted: true,
        available: f64::MAX,
        requested: 0.0,
        category: category.into(),
        reason: "Budget gate skipped (no cost specified).".into(),
    }
}

fn skipped_consent_result() -> ConsentResult {
    ConsentResult {
        permitted: true,
        reason: "Consent gate skipped (no data type specified).".into(),
    }
}
