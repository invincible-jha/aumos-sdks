// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! Trust level management.
//!
//! [`TrustManager`] is responsible for three operations only:
//!
//! * [`set_level`](TrustManager::set_level) — assign a trust level (manual, by owner)
//! * [`get_level`](TrustManager::get_level) — retrieve the current assignment
//! * [`check_level`](TrustManager::check_level) — evaluate whether the agent meets a required level
//!
//! Trust levels are **always** set by an authorised owner.  The manager never
//! promotes or modifies a level on its own.

use alloc::string::String;

use crate::config::Config;
use crate::storage::Storage;
use crate::types::{TrustAssignment, TrustLevel, TrustResult};

/// Manages trust level assignments and checks for AI agents.
///
/// All mutations are explicit — there is no automatic progression.
///
/// # Examples
///
/// ```rust
/// use aumos_governance_core::{
///     storage::InMemoryStorage,
///     trust::TrustManager,
///     types::TrustLevel,
///     config::Config,
/// };
///
/// let mut manager = TrustManager::new(Config::default(), InMemoryStorage::new());
///
/// manager.set_level("agent-001", "default", TrustLevel::Suggest, "owner");
///
/// let result = manager.check_level("agent-001", "default", TrustLevel::Monitor);
/// assert!(result.permitted);
///
/// let result = manager.check_level("agent-001", "default", TrustLevel::Autonomous);
/// assert!(!result.permitted);
/// ```
pub struct TrustManager<S: Storage> {
    config: Config,
    storage: S,
}

impl<S: Storage> TrustManager<S> {
    /// Create a new [`TrustManager`] with the given configuration and storage.
    pub fn new(config: Config, storage: S) -> Self {
        Self { config, storage }
    }

    /// Assign a trust level to an agent within the given scope.
    ///
    /// This is the **only** way trust levels change.  Assignments are always
    /// initiated by an authorised owner — never by the engine itself.
    ///
    /// * `agent_id`    — stable identifier for the AI agent
    /// * `scope`       — domain label narrowing where this level applies (e.g. `"finance"`)
    /// * `level`       — the [`TrustLevel`] to assign
    /// * `assigned_by` — identity of the party granting the assignment
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::{
    ///     storage::InMemoryStorage,
    ///     trust::TrustManager,
    ///     types::TrustLevel,
    ///     config::Config,
    /// };
    ///
    /// let mut manager = TrustManager::new(Config::default(), InMemoryStorage::new());
    /// manager.set_level("agent-001", "billing", TrustLevel::ActAndReport, "owner");
    /// ```
    pub fn set_level(
        &mut self,
        agent_id: &str,
        scope: &str,
        level: TrustLevel,
        assigned_by: &str,
    ) {
        let assignment = TrustAssignment {
            agent_id: agent_id.into(),
            level,
            scope: scope.into(),
            assigned_at_ms: current_time_ms(),
            expires_at_ms: None,
            assigned_by: assigned_by.into(),
        };
        self.storage.set_trust(agent_id, scope, assignment);
    }

    /// Assign a trust level with an explicit expiry.
    ///
    /// After `expires_at_ms` the assignment is treated as absent.
    pub fn set_level_with_expiry(
        &mut self,
        agent_id: &str,
        scope: &str,
        level: TrustLevel,
        assigned_by: &str,
        expires_at_ms: u64,
    ) {
        let assignment = TrustAssignment {
            agent_id: agent_id.into(),
            level,
            scope: scope.into(),
            assigned_at_ms: current_time_ms(),
            expires_at_ms: Some(expires_at_ms),
            assigned_by: assigned_by.into(),
        };
        self.storage.set_trust(agent_id, scope, assignment);
    }

    /// Retrieve the current trust assignment for `(agent_id, scope)`.
    ///
    /// Returns `None` when no assignment exists or the assignment has expired.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::{
    ///     storage::InMemoryStorage,
    ///     trust::TrustManager,
    ///     types::TrustLevel,
    ///     config::Config,
    /// };
    ///
    /// let mut manager = TrustManager::new(Config::default(), InMemoryStorage::new());
    /// assert!(manager.get_level("agent-001", "default").is_none());
    ///
    /// manager.set_level("agent-001", "default", TrustLevel::Monitor, "owner");
    /// let assignment = manager.get_level("agent-001", "default").unwrap();
    /// assert_eq!(assignment.level, TrustLevel::Monitor);
    /// ```
    pub fn get_level(&self, agent_id: &str, scope: &str) -> Option<TrustAssignment> {
        let assignment = self.storage.get_trust(agent_id, scope)?;
        // Treat expired assignments as absent.
        if let Some(expiry) = assignment.expires_at_ms {
            if current_time_ms() > expiry {
                return None;
            }
        }
        Some(assignment)
    }

    /// Evaluate whether an agent's current trust level meets `required`.
    ///
    /// Returns a [`TrustResult`] that carries the outcome and a human-readable
    /// explanation.  When `Config::default_observer_on_missing` is `true`, a
    /// missing assignment is treated as [`TrustLevel::Observer`] instead of
    /// an automatic denial.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::{
    ///     storage::InMemoryStorage,
    ///     trust::TrustManager,
    ///     types::TrustLevel,
    ///     config::Config,
    /// };
    ///
    /// let mut manager = TrustManager::new(Config::default(), InMemoryStorage::new());
    /// manager.set_level("agent-001", "default", TrustLevel::ActAndReport, "owner");
    ///
    /// let result = manager.check_level("agent-001", "default", TrustLevel::Suggest);
    /// assert!(result.permitted);
    /// assert_eq!(result.current_level, TrustLevel::ActAndReport);
    /// ```
    pub fn check_level(
        &self,
        agent_id: &str,
        scope: &str,
        required: TrustLevel,
    ) -> TrustResult {
        match self.get_level(agent_id, scope) {
            Some(assignment) => {
                let permitted = assignment.level >= required;
                let reason: String = if permitted {
                    format!(
                        "Agent '{}' has trust level '{}' which meets required '{}'.",
                        agent_id,
                        assignment.level.display_name(),
                        required.display_name()
                    )
                } else {
                    format!(
                        "Agent '{}' has trust level '{}' which is below required '{}'.",
                        agent_id,
                        assignment.level.display_name(),
                        required.display_name()
                    )
                };
                TrustResult {
                    permitted,
                    current_level: assignment.level,
                    required_level: required,
                    reason,
                }
            }
            None => {
                if self.config.default_observer_on_missing {
                    let current = TrustLevel::Observer;
                    let permitted = current >= required;
                    TrustResult {
                        permitted,
                        current_level: current,
                        required_level: required,
                        reason: format!(
                            "No trust assignment found for agent '{}' in scope '{}'; defaulting to Observer.",
                            agent_id, scope
                        ),
                    }
                } else {
                    TrustResult {
                        permitted: false,
                        current_level: TrustLevel::Observer,
                        required_level: required,
                        reason: format!(
                            "No trust assignment found for agent '{}' in scope '{}'.",
                            agent_id, scope
                        ),
                    }
                }
            }
        }
    }

    /// Borrow the underlying storage (read-only).
    pub fn storage(&self) -> &S {
        &self.storage
    }

    /// Mutably borrow the underlying storage.
    pub fn storage_mut(&mut self) -> &mut S {
        &mut self.storage
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Return current Unix epoch milliseconds.
///
/// In `std` mode this delegates to [`std::time::SystemTime`].
/// In `no_std` mode it returns `0` — the caller is expected to inject time
/// via `set_level_with_expiry` if expiry semantics are needed.
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
