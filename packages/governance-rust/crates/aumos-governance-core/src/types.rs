// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! Shared data types used across all governance sub-systems.
//!
//! All types implement [`Clone`], [`Debug`], [`serde::Serialize`], and
//! [`serde::Deserialize`] so they can be serialised to JSON, stored, and
//! transmitted across WASM boundaries without additional conversion steps.

use alloc::string::String;
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

/// Six-level graduated trust hierarchy for AI agent authorisation.
///
/// Each variant's discriminant value (`repr(u8)`) reflects its position in the
/// hierarchy.  Higher numeric values represent broader permission.  Trust
/// levels are assigned manually by an owner — they are never promoted
/// automatically.
///
/// # Examples
///
/// ```rust
/// use aumos_governance_core::types::TrustLevel;
///
/// assert!(TrustLevel::ActAndReport > TrustLevel::Suggest);
/// assert_eq!(TrustLevel::Observer as u8, 0);
/// ```
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum TrustLevel {
    /// Read-only observer. No side-effecting actions permitted.
    Observer = 0,
    /// Active monitoring with alerting capability. No mutations.
    Monitor = 1,
    /// Proposals and suggestions only; all outputs require human review.
    Suggest = 2,
    /// Can act but every action requires explicit human approval.
    ActWithApproval = 3,
    /// Can act autonomously; all actions must be reported post-hoc.
    ActAndReport = 4,
    /// Fully autonomous within the assigned scope.
    Autonomous = 5,
}

impl TrustLevel {
    /// Human-readable display name for logging and UI surfaces.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::types::TrustLevel;
    /// assert_eq!(TrustLevel::Observer.display_name(), "Observer");
    /// assert_eq!(TrustLevel::Autonomous.display_name(), "Autonomous");
    /// ```
    pub fn display_name(self) -> &'static str {
        match self {
            TrustLevel::Observer       => "Observer",
            TrustLevel::Monitor        => "Monitor",
            TrustLevel::Suggest        => "Suggest",
            TrustLevel::ActWithApproval => "Act-with-Approval",
            TrustLevel::ActAndReport   => "Act-and-Report",
            TrustLevel::Autonomous     => "Autonomous",
        }
    }

    /// Try to construct a [`TrustLevel`] from its raw `u8` discriminant.
    ///
    /// Returns `None` for values outside `0..=5`.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::types::TrustLevel;
    /// assert_eq!(TrustLevel::from_u8(3), Some(TrustLevel::ActWithApproval));
    /// assert_eq!(TrustLevel::from_u8(99), None);
    /// ```
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(TrustLevel::Observer),
            1 => Some(TrustLevel::Monitor),
            2 => Some(TrustLevel::Suggest),
            3 => Some(TrustLevel::ActWithApproval),
            4 => Some(TrustLevel::ActAndReport),
            5 => Some(TrustLevel::Autonomous),
            _ => None,
        }
    }
}

/// Immutable record of a trust level assignment.
///
/// Produced by every call to [`TrustManager::set_level`].  Trust changes are
/// always initiated by an authorised owner — they are never generated
/// automatically by the system.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustAssignment {
    /// Stable identifier for the AI agent.
    pub agent_id: String,
    /// The trust level granted.
    pub level: TrustLevel,
    /// Scope label that narrows the domain of this assignment (e.g. "finance").
    pub scope: String,
    /// Unix epoch milliseconds at which the assignment was recorded.
    pub assigned_at_ms: u64,
    /// Optional Unix epoch milliseconds after which this assignment expires.
    pub expires_at_ms: Option<u64>,
    /// Identity of the party that issued this assignment.
    pub assigned_by: String,
}

/// Result of a [`TrustManager::check_level`] evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustResult {
    /// Whether the agent's current level meets or exceeds the required level.
    pub permitted: bool,
    /// The agent's effective trust level at the time of evaluation.
    pub current_level: TrustLevel,
    /// The minimum level required by the requested action.
    pub required_level: TrustLevel,
    /// Human-readable explanation of the outcome.
    pub reason: String,
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/// A bounded spending allocation for a named cost category.
///
/// Managed by [`BudgetManager`] and persisted via the [`Storage`] trait.
/// Budget allocations are always static — there is no adaptive or ML-based
/// reallocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    /// Logical category this envelope tracks (e.g. "llm-tokens", "financial").
    pub category: String,
    /// Maximum amount permitted within the current period.
    pub limit: f64,
    /// Cumulative amount spent in the current period.
    pub spent: f64,
    /// Duration of one budget period in milliseconds.
    pub period_ms: u64,
    /// Unix epoch milliseconds at which the current period began.
    pub starts_at_ms: u64,
}

impl Envelope {
    /// Amount remaining in this envelope before the limit is reached.
    pub fn available(&self) -> f64 {
        (self.limit - self.spent).max(0.0)
    }

    /// Whether the given `amount` fits within the remaining headroom.
    pub fn can_spend(&self, amount: f64) -> bool {
        self.spent + amount <= self.limit
    }
}

/// Result of a [`BudgetManager::check`] evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetResult {
    /// Whether the requested spend is within the envelope limit.
    pub permitted: bool,
    /// Amount remaining in the envelope before this request.
    pub available: f64,
    /// Amount requested by the action.
    pub requested: f64,
    /// The category envelope that was checked.
    pub category: String,
    /// Human-readable explanation of the outcome.
    pub reason: String,
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/// A single recorded consent grant.
///
/// Produced by [`ConsentManager::record`] and invalidated by
/// [`ConsentManager::revoke`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsentRecord {
    /// Stable identifier for the AI agent the consent applies to.
    pub agent_id: String,
    /// The data type or action class this consent covers.
    pub action: String,
    /// Whether this consent is currently active.
    pub granted: bool,
    /// Unix epoch milliseconds at which the consent was recorded.
    pub recorded_at_ms: u64,
    /// Optional Unix epoch milliseconds after which the consent expires.
    pub expires_at_ms: Option<u64>,
}

/// Result of a [`ConsentManager::check`] evaluation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsentResult {
    /// Whether active consent exists for the given agent and action.
    pub permitted: bool,
    /// Human-readable explanation of the outcome.
    pub reason: String,
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/// An immutable record of a single governance decision.
///
/// Records are chained via `prev_hash` to form a tamper-evident log.
/// The chain is recording-only — there is no anomaly detection or
/// counterfactual generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRecord {
    /// Unique record identifier (hex string of the record hash).
    pub id: String,
    /// The governance decision that was made.
    pub decision: Decision,
    /// SHA-256 hex digest of the serialised `decision` field.
    pub hash: String,
    /// Hash of the immediately preceding record, or an all-zero string for the
    /// genesis record.
    pub prev_hash: String,
    /// Unix epoch milliseconds at which the record was appended.
    pub timestamp_ms: u64,
}

/// Filter used to narrow the results of [`AuditLogger::query`].
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuditFilter {
    /// If set, only return records for this agent.
    pub agent_id: Option<String>,
    /// If set, only return records where `decision.action` matches exactly.
    pub action: Option<String>,
    /// If set, only return records at or after this Unix epoch millisecond.
    pub since_ms: Option<u64>,
    /// If set, only return records at or before this Unix epoch millisecond.
    pub until_ms: Option<u64>,
    /// If set, limit the number of returned records.
    pub limit: Option<usize>,
}

// ---------------------------------------------------------------------------
// Governance engine
// ---------------------------------------------------------------------------

/// The action submitted to [`GovernanceEngine::check`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Context {
    /// Stable identifier for the AI agent requesting the action.
    pub agent_id: String,
    /// Scope label forwarded to the trust check (e.g. "finance").
    pub scope: String,
    /// Minimum trust level required to perform the action.
    pub required_trust: TrustLevel,
    /// Optional cost amount; if `None`, the budget gate is skipped.
    pub cost: Option<f64>,
    /// Cost category used to identify the spending envelope.
    pub category: String,
    /// Optional data type; if `None`, the consent gate is skipped.
    pub data_type: Option<String>,
    /// Optional purpose label for consent matching.
    pub purpose: Option<String>,
}

/// Unified result of a [`GovernanceEngine::check`] call.
///
/// The sequential evaluation pipeline always produces exactly one `Decision`.
/// All decisions — both permits and denials — are appended to the audit log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    /// `true` if all governance checks passed; `false` on the first failure.
    pub permitted: bool,
    /// Outcome of the trust gate.
    pub trust: TrustResult,
    /// Outcome of the budget gate.
    pub budget: BudgetResult,
    /// Outcome of the consent gate.
    pub consent: ConsentResult,
    /// Human-readable name of the action that was evaluated.
    pub action: String,
    /// Unix epoch milliseconds at which the decision was produced.
    pub timestamp_ms: u64,
    /// The gate that produced the final verdict, or "PERMIT" on success.
    pub reason: String,
}

/// Collect audit records into a [`Vec`] for return from query operations.
pub type AuditPage = Vec<AuditRecord>;
