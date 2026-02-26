// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! Engine-level configuration.
//!
//! [`Config`] is the single entry point for tuning the governance engine at
//! construction time.  All fields are optional and have sensible defaults so
//! that `Config::default()` is always a valid starting point.

use serde::{Deserialize, Serialize};

/// Top-level configuration for [`GovernanceEngine`].
///
/// # Examples
///
/// ```rust
/// use aumos_governance_core::config::Config;
///
/// let config = Config {
///     require_consent: true,
///     ..Config::default()
/// };
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// When `true`, the consent gate is enforced even when `Context.data_type`
    /// is `None`.  Defaults to `false` (consent gate is opt-in per action).
    pub require_consent: bool,

    /// When `true`, a missing trust assignment is treated as
    /// [`TrustLevel::Observer`] rather than an outright denial.
    /// Defaults to `false` (missing assignment → denied).
    pub default_observer_on_missing: bool,

    /// When `true`, a missing spending envelope causes the budget gate to
    /// pass (open budget). When `false`, a missing envelope denies the action.
    /// Defaults to `true` (no envelope = no limit configured = pass).
    pub pass_on_missing_envelope: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            require_consent: false,
            default_observer_on_missing: false,
            pass_on_missing_envelope: true,
        }
    }
}
