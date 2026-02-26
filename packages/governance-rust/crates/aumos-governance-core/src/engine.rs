// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! Governance engine — the top-level composition of all protocol components.
//!
//! [`GovernanceEngine`] owns a single [`Storage`] instance and exposes the
//! four protocol managers as public fields that borrow from it.  Because Rust
//! requires unique ownership of mutable references, each manager receives its
//! own storage instance — they communicate through the shared [`Storage`]
//! trait contract rather than shared memory.
//!
//! ## Design
//!
//! For `InMemoryStorage` (and similar single-owner stores), construct the
//! engine with `GovernanceEngine::new`.  The storage is internally moved into
//! the engine's `inner` field; all managers get access to the same data
//! through the `inner` reference set during `check()`.
//!
//! For shared storage (multi-thread, multi-process), wrap the store in
//! `Arc<Mutex<S>>`, implement `Storage` on the wrapper, and pass it to
//! `GovernanceEngine::new`.  Clone the wrapper (cheap Arc clone) to populate
//! all four managers.
//!
//! ## Evaluation Order
//!
//! 1. **Trust gate** — does the agent's current trust level meet `required_trust`?
//! 2. **Budget gate** — if `cost` is `Some`, does the envelope have headroom?
//! 3. **Consent gate** — if `data_type` is `Some`, does active consent exist?
//! 4. **Audit** — record the decision regardless of outcome.
//!
//! Any gate failure short-circuits the remaining steps and returns a denied
//! [`Decision`] immediately.  The audit record is always written.
//!
//! There is no cross-protocol optimisation, no parallel evaluation, and no
//! conditional gate skipping.

use alloc::string::String;
use alloc::vec::Vec;

use crate::audit::AuditLogger;
use crate::budget::BudgetManager;
use crate::config::Config;
use crate::consent::ConsentManager;
use crate::storage::Storage;
use crate::trust::TrustManager;
use crate::types::{
    AuditFilter, AuditRecord, BudgetResult, ConsentResult, Context, Decision, TrustResult,
};

/// Composes all governance protocol components into a single evaluation API.
///
/// The engine is generic over `S: Storage` so it can operate with any
/// persistence backend — from the built-in [`InMemoryStorage`] to a custom
/// file or network store.
///
/// # Construction (single-owner storage)
///
/// ```rust
/// use aumos_governance_core::{
///     engine::GovernanceEngine,
///     storage::InMemoryStorage,
///     config::Config,
/// };
///
/// let engine = GovernanceEngine::new(Config::default(), InMemoryStorage::new());
/// ```
///
/// # Construction (shared storage via Arc<Mutex<...>>)
///
/// ```rust,no_run
/// use std::sync::{Arc, Mutex};
/// use aumos_governance_core::{
///     engine::GovernanceEngine,
///     storage::{InMemoryStorage, Storage},
///     config::Config,
///     types::{AuditFilter, AuditRecord, Envelope, TrustAssignment},
/// };
///
/// // Implement Storage for Arc<Mutex<InMemoryStorage>> in your own crate,
/// // then pass the wrapper to GovernanceEngine::new_with_shared.
/// ```
///
/// # Evaluation
///
/// ```rust
/// use aumos_governance_core::{
///     engine::GovernanceEngine,
///     storage::InMemoryStorage,
///     types::{Context, TrustLevel},
///     config::Config,
/// };
///
/// let mut engine = GovernanceEngine::new(Config::default(), InMemoryStorage::new());
///
/// engine.trust.set_level("agent-001", "default", TrustLevel::ActAndReport, "owner");
///
/// let ctx = Context {
///     agent_id:       "agent-001".into(),
///     scope:          "default".into(),
///     required_trust: TrustLevel::Suggest,
///     cost:           None,
///     category:       "default".into(),
///     data_type:      None,
///     purpose:        None,
/// };
///
/// let decision = engine.check("send_report", &ctx);
/// assert!(decision.permitted);
/// ```
pub struct GovernanceEngine<S: Storage> {
    /// Trust level assignment and checking.
    pub trust: TrustManager<S>,
    /// Spending envelope management.
    pub budget: BudgetManager<S>,
    /// Consent grant management.
    pub consent: ConsentManager<S>,
    /// Immutable audit chain.
    pub audit: AuditLogger<S>,
}

impl<S: Storage + Clone> GovernanceEngine<S> {
    /// Construct a new [`GovernanceEngine`].
    ///
    /// `storage` is cloned once per manager.  When `S` is `InMemoryStorage`
    /// the clone produces four independent in-memory stores.  This is correct
    /// behaviour: trust data written via `engine.trust` is readable by
    /// `engine.trust`, budget data written via `engine.budget` is readable by
    /// `engine.budget`, and so on.  The four managers all operate on the same
    /// logical data model because the engine routes every `check()` call
    /// through each manager in sequence.
    ///
    /// When you need all four managers to observe each other's writes (e.g. a
    /// trust assignment affecting a budget query) use a reference-counted
    /// storage wrapper such as `Arc<Mutex<S>>` and implement `Clone` on the
    /// wrapper to share the inner store.
    pub fn new(config: Config, storage: S) -> Self {
        Self {
            trust:   TrustManager::new(config.clone(), storage.clone()),
            budget:  BudgetManager::new(config.clone(), storage.clone()),
            consent: ConsentManager::new(config.clone(), storage.clone()),
            audit:   AuditLogger::new(storage),
        }
    }
}

impl<S: Storage> GovernanceEngine<S> {
    /// Construct a [`GovernanceEngine`] from four pre-built managers.
    ///
    /// Use this constructor when the storage type does not implement [`Clone`],
    /// or when you want to give each manager a different storage shard, or
    /// when you are using a shared reference type (e.g. `Arc<Mutex<S>>`).
    ///
    /// # Examples
    ///
    /// ```rust,no_run
    /// use aumos_governance_core::{
    ///     engine::GovernanceEngine,
    ///     trust::TrustManager,
    ///     budget::BudgetManager,
    ///     consent::ConsentManager,
    ///     audit::AuditLogger,
    ///     storage::InMemoryStorage,
    ///     config::Config,
    /// };
    ///
    /// // Each manager gets the same storage instance when InMemoryStorage
    /// // derives Clone (which it does via #[derive(Default)]).
    /// let store = InMemoryStorage::new();
    /// let config = Config::default();
    /// let engine = GovernanceEngine::from_parts(
    ///     TrustManager::new(config.clone(), store.clone()),
    ///     BudgetManager::new(config.clone(), store.clone()),
    ///     ConsentManager::new(config.clone(), store.clone()),
    ///     AuditLogger::new(store),
    /// );
    /// ```
    pub fn from_parts(
        trust: TrustManager<S>,
        budget: BudgetManager<S>,
        consent: ConsentManager<S>,
        audit: AuditLogger<S>,
    ) -> Self {
        Self { trust, budget, consent, audit }
    }

    /// Evaluate a governance action and return a [`Decision`].
    ///
    /// The pipeline is sequential and non-configurable:
    ///
    /// 1. Trust gate — fails if the agent's level is below `ctx.required_trust`.
    /// 2. Budget gate — fails if `ctx.cost` is `Some` and the envelope has
    ///    insufficient headroom.  When permitted, the envelope is debited.
    /// 3. Consent gate — fails if `ctx.data_type` is `Some` and no active
    ///    consent exists.
    /// 4. Audit — always appended, regardless of outcome.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::{
    ///     engine::GovernanceEngine,
    ///     storage::InMemoryStorage,
    ///     types::{Context, TrustLevel},
    ///     config::Config,
    /// };
    ///
    /// let mut engine = GovernanceEngine::new(Config::default(), InMemoryStorage::new());
    /// engine.trust.set_level("agent-002", "ops", TrustLevel::Monitor, "owner");
    ///
    /// let ctx = Context {
    ///     agent_id:       "agent-002".into(),
    ///     scope:          "ops".into(),
    ///     required_trust: TrustLevel::Autonomous,
    ///     cost:           None,
    ///     category:       "ops".into(),
    ///     data_type:      None,
    ///     purpose:        None,
    /// };
    ///
    /// let decision = engine.check("delete_cluster", &ctx);
    /// assert!(!decision.permitted);
    /// assert!(decision.reason.contains("Trust"));
    /// ```
    pub fn check(&mut self, action: &str, ctx: &Context) -> Decision {
        let timestamp_ms = current_time_ms();

        // ------------------------------------------------------------------
        // Step 1: Trust gate
        // ------------------------------------------------------------------
        let trust_result: TrustResult =
            self.trust.check_level(&ctx.agent_id, &ctx.scope, ctx.required_trust);

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
            self.audit.log(decision.clone());
            return decision;
        }

        // ------------------------------------------------------------------
        // Step 2: Budget gate (only when the action carries a positive cost)
        // ------------------------------------------------------------------
        let budget_result: BudgetResult = match ctx.cost {
            Some(amount) if amount > 0.0 => {
                let result = self.budget.check(&ctx.category, amount);
                if result.permitted {
                    // Debit the envelope so subsequent checks within the same
                    // period see the correct remaining headroom.
                    self.budget.record(&ctx.category, amount);
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
            self.audit.log(decision.clone());
            return decision;
        }

        // ------------------------------------------------------------------
        // Step 3: Consent gate (only when a data type is specified)
        // ------------------------------------------------------------------
        let consent_result: ConsentResult = match &ctx.data_type {
            Some(data_type) => self.consent.check(&ctx.agent_id, data_type),
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
            self.audit.log(decision.clone());
            return decision;
        }

        // ------------------------------------------------------------------
        // Step 4: All gates passed — permit
        // ------------------------------------------------------------------
        let decision = Decision {
            permitted: true,
            trust: trust_result,
            budget: budget_result,
            consent: consent_result,
            action: action.into(),
            timestamp_ms,
            reason: "All governance gates passed.".into(),
        };

        self.audit.log(decision.clone());
        decision
    }

    /// Query the audit log directly.
    ///
    /// Convenience wrapper around [`AuditLogger::query`].
    pub fn query_audit(&self, filter: &AuditFilter) -> Vec<AuditRecord> {
        self.audit.query(filter)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build a skipped-gate [`BudgetResult`] for actions without a cost.
fn skipped_budget_result(category: &str) -> BudgetResult {
    BudgetResult {
        permitted: true,
        available: f64::MAX,
        requested: 0.0,
        category: category.into(),
        reason: "Budget gate skipped (no cost specified).".into(),
    }
}

/// Build a skipped-gate [`ConsentResult`] for actions without a data type.
fn skipped_consent_result() -> ConsentResult {
    ConsentResult {
        permitted: true,
        reason: "Consent gate skipped (no data type specified).".into(),
    }
}

/// Return current Unix epoch milliseconds.
fn current_time_ms() -> u64 {
    #[cfg(feature = "std")]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }
    #[cfg(not(feature = "std"))]
    {
        0
    }
}
