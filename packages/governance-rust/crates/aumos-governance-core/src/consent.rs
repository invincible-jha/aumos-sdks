// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! Consent management.
//!
//! [`ConsentManager`] exposes three operations only:
//!
//! * [`record`](ConsentManager::record)  — record a consent grant
//! * [`check`](ConsentManager::check)   — check whether active consent exists
//! * [`revoke`](ConsentManager::revoke) — revoke an existing consent
//!
//! Consent is always explicitly granted or revoked by an authorised party.
//! The manager never generates proactive consent suggestions.

use alloc::string::String;

use crate::config::Config;
use crate::storage::Storage;
use crate::types::ConsentResult;

/// Manages consent grants for agent-action pairs.
///
/// # Examples
///
/// ```rust
/// use aumos_governance_core::{
///     consent::ConsentManager,
///     storage::InMemoryStorage,
///     config::Config,
/// };
///
/// let mut manager = ConsentManager::new(Config::default(), InMemoryStorage::new());
///
/// // No consent yet.
/// let result = manager.check("agent-001", "read_pii");
/// assert!(!result.permitted);
///
/// // Record consent.
/// manager.record("agent-001", "read_pii");
/// assert!(manager.check("agent-001", "read_pii").permitted);
///
/// // Revoke consent.
/// manager.revoke("agent-001", "read_pii");
/// assert!(!manager.check("agent-001", "read_pii").permitted);
/// ```
pub struct ConsentManager<S: Storage> {
    config: Config,
    storage: S,
}

impl<S: Storage> ConsentManager<S> {
    /// Create a new [`ConsentManager`].
    pub fn new(config: Config, storage: S) -> Self {
        Self { config, storage }
    }

    /// Record that consent has been granted for `(agent_id, action)`.
    ///
    /// Consent is always granted by an authorised party — never by the engine
    /// automatically.  Calling `record` again on an already-consented pair is
    /// idempotent.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::{
    ///     consent::ConsentManager,
    ///     storage::InMemoryStorage,
    ///     config::Config,
    /// };
    ///
    /// let mut manager = ConsentManager::new(Config::default(), InMemoryStorage::new());
    /// manager.record("agent-001", "send_email");
    /// assert!(manager.check("agent-001", "send_email").permitted);
    /// ```
    pub fn record(&mut self, agent_id: &str, action: &str) {
        self.storage.set_consent(agent_id, action, true);
    }

    /// Check whether active consent exists for `(agent_id, action)`.
    ///
    /// When `Config::require_consent` is `false` **and** the action does not
    /// carry a `data_type`, the engine skips this check entirely (handled in
    /// [`GovernanceEngine::check`]).  This method always evaluates faithfully
    /// regardless of config — use it for direct consent queries.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::{
    ///     consent::ConsentManager,
    ///     storage::InMemoryStorage,
    ///     config::Config,
    /// };
    ///
    /// let mut manager = ConsentManager::new(Config::default(), InMemoryStorage::new());
    /// let result = manager.check("agent-001", "read_logs");
    /// assert!(!result.permitted);
    /// assert!(result.reason.contains("No consent"));
    /// ```
    pub fn check(&self, agent_id: &str, action: &str) -> ConsentResult {
        let granted = self.storage.get_consent(agent_id, action);
        let reason: String = if granted {
            format!(
                "Active consent exists for agent '{}' on action '{}'.",
                agent_id, action
            )
        } else {
            format!(
                "No consent recorded for agent '{}' on action '{}'.",
                agent_id, action
            )
        };
        ConsentResult {
            permitted: granted,
            reason,
        }
    }

    /// Revoke any previously recorded consent for `(agent_id, action)`.
    ///
    /// Calling `revoke` on a pair with no existing consent is a no-op.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::{
    ///     consent::ConsentManager,
    ///     storage::InMemoryStorage,
    ///     config::Config,
    /// };
    ///
    /// let mut manager = ConsentManager::new(Config::default(), InMemoryStorage::new());
    /// manager.record("agent-001", "send_email");
    /// manager.revoke("agent-001", "send_email");
    ///
    /// assert!(!manager.check("agent-001", "send_email").permitted);
    /// ```
    pub fn revoke(&mut self, agent_id: &str, action: &str) {
        self.storage.set_consent(agent_id, action, false);
    }

    /// Borrow the underlying storage.
    pub fn storage(&self) -> &S {
        &self.storage
    }
}
