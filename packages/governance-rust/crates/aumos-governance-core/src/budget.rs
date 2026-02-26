// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! Spending envelope management.
//!
//! [`BudgetManager`] exposes three operations only:
//!
//! * [`create_envelope`](BudgetManager::create_envelope) — define a new spending limit
//! * [`check`](BudgetManager::check)                    — verify headroom before spending
//! * [`record`](BudgetManager::record)                  — record a completed spend
//!
//! Budget allocations are **always static**.  There is no adaptive allocation,
//! no ML-based prediction, and no automatic rebalancing.

use alloc::string::String;

use crate::config::Config;
use crate::storage::Storage;
use crate::types::{BudgetResult, Envelope};

/// Manages static spending envelopes for named cost categories.
///
/// # Examples
///
/// ```rust
/// use aumos_governance_core::{
///     budget::BudgetManager,
///     storage::InMemoryStorage,
///     config::Config,
/// };
///
/// let mut manager = BudgetManager::new(Config::default(), InMemoryStorage::new());
///
/// // Create a $500 envelope for the "financial" category with a daily period.
/// manager.create_envelope("financial", 500.0, 86_400_000, 0);
///
/// // Check whether a $100 spend fits.
/// let result = manager.check("financial", 100.0);
/// assert!(result.permitted);
///
/// // Record the spend.
/// manager.record("financial", 100.0);
///
/// // Check again — $400 remains.
/// let result = manager.check("financial", 401.0);
/// assert!(!result.permitted);
/// ```
pub struct BudgetManager<S: Storage> {
    config: Config,
    storage: S,
}

impl<S: Storage> BudgetManager<S> {
    /// Create a new [`BudgetManager`].
    pub fn new(config: Config, storage: S) -> Self {
        Self { config, storage }
    }

    /// Define a new (or replace an existing) spending envelope for `category`.
    ///
    /// * `category`    — the logical cost category (e.g. `"llm-tokens"`)
    /// * `limit`       — maximum amount per period
    /// * `period_ms`   — period length in milliseconds (`0` means no period reset)
    /// * `starts_at_ms` — Unix epoch ms at which the period begins
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::{
    ///     budget::BudgetManager,
    ///     storage::InMemoryStorage,
    ///     config::Config,
    /// };
    ///
    /// let mut manager = BudgetManager::new(Config::default(), InMemoryStorage::new());
    /// manager.create_envelope("api-calls", 1000.0, 3_600_000, 0);
    /// ```
    pub fn create_envelope(
        &mut self,
        category: &str,
        limit: f64,
        period_ms: u64,
        starts_at_ms: u64,
    ) {
        let envelope = Envelope {
            category: category.into(),
            limit,
            spent: 0.0,
            period_ms,
            starts_at_ms,
        };
        self.storage.set_envelope(category, envelope);
    }

    /// Evaluate whether `amount` fits within the `category` envelope.
    ///
    /// Does **not** modify any state.  Call [`record`](Self::record) after the
    /// action completes to debit the envelope.
    ///
    /// When no envelope exists for `category`:
    /// - If `Config::pass_on_missing_envelope` is `true` → permitted.
    /// - If `false` → denied with an explanatory reason.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::{
    ///     budget::BudgetManager,
    ///     storage::InMemoryStorage,
    ///     config::Config,
    /// };
    ///
    /// let mut manager = BudgetManager::new(Config::default(), InMemoryStorage::new());
    /// manager.create_envelope("financial", 200.0, 0, 0);
    ///
    /// assert!(manager.check("financial", 150.0).permitted);
    /// assert!(!manager.check("financial", 250.0).permitted);
    /// ```
    pub fn check(&self, category: &str, amount: f64) -> BudgetResult {
        match self.storage.get_envelope(category) {
            Some(envelope) => {
                let available = envelope.available();
                let permitted = envelope.can_spend(amount);
                let reason: String = if permitted {
                    format!(
                        "Spend of {:.4} fits within envelope '{}' (available: {:.4}).",
                        amount, category, available
                    )
                } else {
                    format!(
                        "Spend of {:.4} exceeds envelope '{}' (available: {:.4}, limit: {:.4}).",
                        amount, category, available, envelope.limit
                    )
                };
                BudgetResult {
                    permitted,
                    available,
                    requested: amount,
                    category: category.into(),
                    reason,
                }
            }
            None => {
                if self.config.pass_on_missing_envelope {
                    BudgetResult {
                        permitted: true,
                        available: f64::MAX,
                        requested: amount,
                        category: category.into(),
                        reason: format!(
                            "No envelope configured for '{}'; passing (open budget).",
                            category
                        ),
                    }
                } else {
                    BudgetResult {
                        permitted: false,
                        available: 0.0,
                        requested: amount,
                        category: category.into(),
                        reason: format!(
                            "No envelope configured for '{}'; denying (strict mode).",
                            category
                        ),
                    }
                }
            }
        }
    }

    /// Debit `amount` from the `category` envelope.
    ///
    /// If no envelope exists this is a no-op.  Callers should call
    /// [`check`](Self::check) first; `record` does not re-validate.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::{
    ///     budget::BudgetManager,
    ///     storage::InMemoryStorage,
    ///     config::Config,
    /// };
    ///
    /// let mut manager = BudgetManager::new(Config::default(), InMemoryStorage::new());
    /// manager.create_envelope("financial", 500.0, 0, 0);
    /// manager.record("financial", 100.0);
    ///
    /// let result = manager.check("financial", 1.0);
    /// assert_eq!(result.available, 400.0);
    /// ```
    pub fn record(&mut self, category: &str, amount: f64) {
        if let Some(mut envelope) = self.storage.get_envelope(category) {
            envelope.spent += amount;
            self.storage.set_envelope(category, envelope);
        }
    }

    /// Retrieve the current envelope snapshot for `category`.
    pub fn get_envelope(&self, category: &str) -> Option<Envelope> {
        self.storage.get_envelope(category)
    }

    /// Borrow the underlying storage.
    pub fn storage(&self) -> &S {
        &self.storage
    }
}
