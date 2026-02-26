// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! Storage abstraction for the governance engine.
//!
//! The [`Storage`] trait is the single interface between the governance engine
//! and any persistence layer.  This crate ships [`InMemoryStorage`] for
//! development and testing.  Production implementations (file-based, database,
//! etc.) live in downstream crates so that this core crate remains `no_std`.
//!
//! # Implementing `Storage`
//!
//! ```rust,no_run
//! use aumos_governance_core::storage::{Storage, AuditFilter};
//! use aumos_governance_core::types::{AuditRecord, Envelope, TrustAssignment};
//!
//! struct MyStorage;
//!
//! impl Storage for MyStorage {
//!     fn get_trust(&self, agent_id: &str, scope: &str) -> Option<TrustAssignment> {
//!         None // read from your backend
//!     }
//!     fn set_trust(&mut self, _agent_id: &str, _scope: &str, _assignment: TrustAssignment) {}
//!     fn get_envelope(&self, _category: &str) -> Option<Envelope> { None }
//!     fn set_envelope(&mut self, _category: &str, _envelope: Envelope) {}
//!     fn get_consent(&self, _agent_id: &str, _action: &str) -> bool { false }
//!     fn set_consent(&mut self, _agent_id: &str, _action: &str, _granted: bool) {}
//!     fn append_audit(&mut self, _record: AuditRecord) {}
//!     fn query_audit(&self, _filter: &AuditFilter) -> alloc::vec::Vec<AuditRecord> {
//!         alloc::vec::Vec::new()
//!     }
//! }
//! ```

use alloc::vec::Vec;
use hashbrown::HashMap;

use crate::types::{AuditFilter, AuditRecord, Envelope, TrustAssignment};

// ---------------------------------------------------------------------------
// Storage trait
// ---------------------------------------------------------------------------

/// Pluggable persistence interface for the governance engine.
///
/// Every method operates on owned strings for the keys and owned structs for
/// the values so that implementations are free to handle memory however they
/// see fit.  The engine always passes `&str` references for key parameters,
/// keeping the call-site allocation-free.
///
/// Implementations MUST be `Send + Sync` so the engine can be shared across
/// threads when wrapped in `Arc<Mutex<...>>`.
pub trait Storage: Send + Sync {
    // ------------------------------------------------------------------
    // Trust
    // ------------------------------------------------------------------

    /// Retrieve the trust assignment for `(agent_id, scope)`, if any.
    fn get_trust(&self, agent_id: &str, scope: &str) -> Option<TrustAssignment>;

    /// Persist or overwrite the trust assignment for `(agent_id, scope)`.
    fn set_trust(&mut self, agent_id: &str, scope: &str, assignment: TrustAssignment);

    // ------------------------------------------------------------------
    // Budget
    // ------------------------------------------------------------------

    /// Retrieve the spending envelope for `category`, if any.
    fn get_envelope(&self, category: &str) -> Option<Envelope>;

    /// Persist or overwrite the spending envelope for `category`.
    fn set_envelope(&mut self, category: &str, envelope: Envelope);

    // ------------------------------------------------------------------
    // Consent
    // ------------------------------------------------------------------

    /// Return `true` if active consent exists for `(agent_id, action)`.
    fn get_consent(&self, agent_id: &str, action: &str) -> bool;

    /// Record or update the consent flag for `(agent_id, action)`.
    fn set_consent(&mut self, agent_id: &str, action: &str, granted: bool);

    // ------------------------------------------------------------------
    // Audit
    // ------------------------------------------------------------------

    /// Append an immutable audit record to the log.
    fn append_audit(&mut self, record: AuditRecord);

    /// Return all audit records that satisfy `filter`.
    fn query_audit(&self, filter: &AuditFilter) -> Vec<AuditRecord>;
}

// ---------------------------------------------------------------------------
// InMemoryStorage
// ---------------------------------------------------------------------------

/// A volatile, heap-allocated [`Storage`] implementation backed by
/// [`hashbrown::HashMap`].
///
/// All data lives in process memory and is lost when the engine is dropped.
/// This implementation is suitable for integration testing and WASM environments
/// where persistent storage is managed outside the engine.
///
/// # Examples
///
/// ```rust
/// use aumos_governance_core::storage::InMemoryStorage;
/// use aumos_governance_core::Storage;
///
/// let mut store = InMemoryStorage::new();
/// store.set_consent("agent-001", "read_pii", true);
/// assert!(store.get_consent("agent-001", "read_pii"));
/// assert!(!store.get_consent("agent-001", "delete_records"));
/// ```
#[derive(Debug, Default, Clone)]
pub struct InMemoryStorage {
    /// Key: `"{agent_id}:{scope}"` → trust assignment.
    trust: HashMap<alloc::string::String, TrustAssignment>,
    /// Key: category name → spending envelope.
    envelopes: HashMap<alloc::string::String, Envelope>,
    /// Key: `"{agent_id}:{action}"` → consent flag.
    consent: HashMap<alloc::string::String, bool>,
    /// Append-only audit log.
    audit: Vec<AuditRecord>,
}

impl InMemoryStorage {
    /// Create a new, empty [`InMemoryStorage`].
    pub fn new() -> Self {
        Self::default()
    }

    /// Composite key used for both trust and consent maps.
    fn composite_key(left: &str, right: &str) -> alloc::string::String {
        let mut key = alloc::string::String::with_capacity(left.len() + 1 + right.len());
        key.push_str(left);
        key.push(':');
        key.push_str(right);
        key
    }
}

impl Storage for InMemoryStorage {
    fn get_trust(&self, agent_id: &str, scope: &str) -> Option<TrustAssignment> {
        let key = Self::composite_key(agent_id, scope);
        self.trust.get(&key).cloned()
    }

    fn set_trust(&mut self, agent_id: &str, scope: &str, assignment: TrustAssignment) {
        let key = Self::composite_key(agent_id, scope);
        self.trust.insert(key, assignment);
    }

    fn get_envelope(&self, category: &str) -> Option<Envelope> {
        self.envelopes.get(category).cloned()
    }

    fn set_envelope(&mut self, category: &str, envelope: Envelope) {
        self.envelopes.insert(category.into(), envelope);
    }

    fn get_consent(&self, agent_id: &str, action: &str) -> bool {
        let key = Self::composite_key(agent_id, action);
        self.consent.get(&key).copied().unwrap_or(false)
    }

    fn set_consent(&mut self, agent_id: &str, action: &str, granted: bool) {
        let key = Self::composite_key(agent_id, action);
        self.consent.insert(key, granted);
    }

    fn append_audit(&mut self, record: AuditRecord) {
        self.audit.push(record);
    }

    fn query_audit(&self, filter: &AuditFilter) -> Vec<AuditRecord> {
        self.audit
            .iter()
            .filter(|record| {
                // agent_id filter: the AuditLogger embeds a record id with the
                // format "<action>-<hash_prefix>".  The agent is not directly
                // stored on the record; filter by action or timestamp instead.
                // If the caller has set agent_id we fall back to a prefix match
                // on the record id for compatibility with callers that set the
                // id to include the agent (e.g. custom Storage impls).
                if let Some(ref agent_id) = filter.agent_id {
                    if !record.id.starts_with(agent_id.as_str()) {
                        return false;
                    }
                }
                if let Some(ref action) = filter.action {
                    if &record.decision.action != action {
                        return false;
                    }
                }
                if let Some(since_ms) = filter.since_ms {
                    if record.timestamp_ms < since_ms {
                        return false;
                    }
                }
                if let Some(until_ms) = filter.until_ms {
                    if record.timestamp_ms > until_ms {
                        return false;
                    }
                }
                true
            })
            .take(filter.limit.unwrap_or(usize::MAX))
            .cloned()
            .collect()
    }
}
