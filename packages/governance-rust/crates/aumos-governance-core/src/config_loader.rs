// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! Configuration loader for [`GovernanceEngine`].
//!
//! Supports two load strategies:
//!
//! 1. **TOML file** — [`load_config`] reads and deserialises a TOML file into
//!    a [`GovernanceConfig`] struct.
//! 2. **Environment variables** — [`load_config_from_env`] reads `AUMOS_`-prefixed
//!    environment variables and constructs a [`GovernanceConfig`].
//!
//! Both loaders are only available when the `std` feature is active
//! (the default).
//!
//! # File format
//!
//! ```toml
//! trust_threshold  = 2      # integer 0–5 matching TrustLevel discriminants
//! budget_limit     = 1000.0
//! audit_level      = "standard"   # "minimal" | "standard" | "detailed"
//! consent_required = false
//! ```
//!
//! # Environment variables
//!
//! | Variable                     | Type    | Default   |
//! |------------------------------|---------|-----------|
//! | `AUMOS_TRUST_THRESHOLD`      | integer | 2         |
//! | `AUMOS_BUDGET_LIMIT`         | float   | 1000.0    |
//! | `AUMOS_AUDIT_LEVEL`          | string  | "standard"|
//! | `AUMOS_CONSENT_REQUIRED`     | boolean | false     |

// Only compile this module when the "config-loader" feature is enabled.
// "config-loader" implies "std", so std facilities are always available here.
#![cfg(feature = "config-loader")]

use std::fmt;
use std::fs;
use std::num::ParseFloatError;
use std::num::ParseIntError;

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// GovernanceConfig
// ---------------------------------------------------------------------------

/// Audit level enumeration for serialisation purposes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AuditLevel {
    /// Record only the final decision outcome.
    Minimal,
    /// Record outcome, agent, action, and key gate results.
    #[default]
    Standard,
    /// Record all gate inputs, outputs, and full context.
    Detailed,
}

impl fmt::Display for AuditLevel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AuditLevel::Minimal  => write!(f, "minimal"),
            AuditLevel::Standard => write!(f, "standard"),
            AuditLevel::Detailed => write!(f, "detailed"),
        }
    }
}

impl AuditLevel {
    fn from_str_case_insensitive(s: &str) -> Result<Self, ConfigError> {
        match s.to_ascii_lowercase().as_str() {
            "minimal"  => Ok(AuditLevel::Minimal),
            "standard" => Ok(AuditLevel::Standard),
            "detailed" => Ok(AuditLevel::Detailed),
            other => Err(ConfigError::ParseField {
                field: "audit_level".into(),
                value: other.into(),
                reason: "expected one of: minimal, standard, detailed".into(),
            }),
        }
    }
}

/// Flat configuration struct for governance engine construction.
///
/// This is distinct from the engine-internal [`Config`] to provide a
/// stable, serialisation-friendly representation that can be loaded from
/// TOML files or environment variables without coupling to the engine's
/// internal representation.
///
/// Use [`Into<crate::config::Config>`] to convert after loading.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceConfig {
    /// Minimum trust level (0–5) required for actions not covered by an
    /// explicit rule. Corresponds to [`TrustLevel`] discriminants.
    #[serde(default = "default_trust_threshold")]
    pub trust_threshold: u8,

    /// Default per-agent budget limit in the engine's configured cost unit.
    #[serde(default = "default_budget_limit")]
    pub budget_limit: f64,

    /// Verbosity of audit records produced by the engine.
    #[serde(default)]
    pub audit_level: AuditLevel,

    /// When `true`, the consent gate is enforced for all actions regardless
    /// of whether `Context.data_type` is set.
    #[serde(default)]
    pub consent_required: bool,
}

fn default_trust_threshold() -> u8 { 2 }
fn default_budget_limit() -> f64 { 1000.0 }

impl Default for GovernanceConfig {
    fn default() -> Self {
        Self {
            trust_threshold:  default_trust_threshold(),
            budget_limit:     default_budget_limit(),
            audit_level:      AuditLevel::Standard,
            consent_required: false,
        }
    }
}

// ---------------------------------------------------------------------------
// ConfigError
// ---------------------------------------------------------------------------

/// Errors that can occur while loading or parsing governance configuration.
#[derive(Debug)]
pub enum ConfigError {
    /// A required file could not be opened.
    FileRead { path: String, source: std::io::Error },
    /// The TOML content could not be deserialised.
    TomlParse { source: toml::de::Error },
    /// A field could not be parsed to its expected type.
    ParseField { field: String, value: String, reason: String },
    /// A field value is outside the permitted range.
    InvalidRange { field: String, value: String, reason: String },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::FileRead { path, source } =>
                write!(f, "Failed to read config file \"{path}\": {source}"),
            ConfigError::TomlParse { source } =>
                write!(f, "Failed to parse TOML config: {source}"),
            ConfigError::ParseField { field, value, reason } =>
                write!(f, "Field \"{field}\": cannot parse \"{value}\" — {reason}"),
            ConfigError::InvalidRange { field, value, reason } =>
                write!(f, "Field \"{field}\": value \"{value}\" out of range — {reason}"),
        }
    }
}

impl std::error::Error for ConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ConfigError::FileRead { source, .. } => Some(source),
            ConfigError::TomlParse { source }    => Some(source),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// TOML loader
// ---------------------------------------------------------------------------

/// Load a [`GovernanceConfig`] from a TOML file.
///
/// # Arguments
///
/// * `path` — Path to the TOML configuration file (absolute or relative).
///
/// # Errors
///
/// Returns a [`ConfigError`] if the file cannot be read or if the TOML
/// content does not match the expected schema.
///
/// # Example
///
/// ```rust,no_run
/// use aumos_governance_core::config_loader::load_config;
///
/// let config = load_config("/etc/aumos/governance.toml").unwrap();
/// println!("Trust threshold: {}", config.trust_threshold);
/// ```
pub fn load_config(path: &str) -> Result<GovernanceConfig, ConfigError> {
    let content = fs::read_to_string(path).map_err(|source| ConfigError::FileRead {
        path: path.to_owned(),
        source,
    })?;

    toml::from_str::<GovernanceConfig>(&content)
        .map_err(|source| ConfigError::TomlParse { source })
}

// ---------------------------------------------------------------------------
// Environment variable loader
// ---------------------------------------------------------------------------

/// Load a [`GovernanceConfig`] from `AUMOS_`-prefixed environment variables.
///
/// Unset variables fall back to their defaults. Type conversion errors are
/// reported as [`ConfigError::ParseField`].
///
/// | Variable                 | Type    | Default   |
/// |--------------------------|---------|-----------|
/// | `AUMOS_TRUST_THRESHOLD`  | u8 0–5  | 2         |
/// | `AUMOS_BUDGET_LIMIT`     | f64 ≥ 0 | 1000.0    |
/// | `AUMOS_AUDIT_LEVEL`      | string  | "standard"|
/// | `AUMOS_CONSENT_REQUIRED` | bool    | false     |
///
/// # Errors
///
/// Returns a [`ConfigError::ParseField`] if any variable is set to a value
/// that cannot be parsed, or a [`ConfigError::InvalidRange`] for out-of-range
/// integers.
pub fn load_config_from_env() -> Result<GovernanceConfig, ConfigError> {
    let trust_threshold = read_env_u8("AUMOS_TRUST_THRESHOLD", default_trust_threshold())?;
    if trust_threshold > 5 {
        return Err(ConfigError::InvalidRange {
            field: "AUMOS_TRUST_THRESHOLD".into(),
            value: trust_threshold.to_string(),
            reason: "must be in range 0–5 (matching TrustLevel discriminants)".into(),
        });
    }

    let budget_limit = read_env_f64("AUMOS_BUDGET_LIMIT", default_budget_limit())?;
    if budget_limit < 0.0 {
        return Err(ConfigError::InvalidRange {
            field: "AUMOS_BUDGET_LIMIT".into(),
            value: budget_limit.to_string(),
            reason: "must be >= 0.0".into(),
        });
    }

    let audit_level = match std::env::var("AUMOS_AUDIT_LEVEL") {
        Ok(val) => AuditLevel::from_str_case_insensitive(&val)?,
        Err(_)  => AuditLevel::default(),
    };

    let consent_required = read_env_bool("AUMOS_CONSENT_REQUIRED", false)?;

    Ok(GovernanceConfig {
        trust_threshold,
        budget_limit,
        audit_level,
        consent_required,
    })
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

fn read_env_u8(key: &str, default: u8) -> Result<u8, ConfigError> {
    match std::env::var(key) {
        Ok(val) => val.trim().parse::<u8>().map_err(|source: ParseIntError| {
            ConfigError::ParseField {
                field: key.to_owned(),
                value: val,
                reason: source.to_string(),
            }
        }),
        Err(_) => Ok(default),
    }
}

fn read_env_f64(key: &str, default: f64) -> Result<f64, ConfigError> {
    match std::env::var(key) {
        Ok(val) => val.trim().parse::<f64>().map_err(|source: ParseFloatError| {
            ConfigError::ParseField {
                field: key.to_owned(),
                value: val,
                reason: source.to_string(),
            }
        }),
        Err(_) => Ok(default),
    }
}

fn read_env_bool(key: &str, default: bool) -> Result<bool, ConfigError> {
    match std::env::var(key) {
        Ok(val) => match val.trim().to_ascii_lowercase().as_str() {
            "true"  | "1" | "yes" | "on"  => Ok(true),
            "false" | "0" | "no"  | "off" => Ok(false),
            other => Err(ConfigError::ParseField {
                field: key.to_owned(),
                value: other.to_owned(),
                reason: "expected one of: true/false, 1/0, yes/no, on/off".into(),
            }),
        },
        Err(_) => Ok(default),
    }
}
