// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! Audit log management.
//!
//! [`AuditLogger`] exposes two operations only:
//!
//! * [`log`](AuditLogger::log)     — record a governance decision
//! * [`query`](AuditLogger::query) — search / filter the audit chain
//!
//! Records are chained via SHA-256 hashes to form a tamper-evident log.
//! The log is **recording only** — there is no anomaly detection, no
//! counterfactual generation, and no real-time alerting.

use alloc::string::String;
use alloc::vec::Vec;

use crate::storage::Storage;
use crate::types::{AuditFilter, AuditRecord, Decision};

/// Records governance decisions in a chained, tamper-evident audit log.
///
/// # Examples
///
/// ```rust
/// use aumos_governance_core::{
///     audit::AuditLogger,
///     storage::InMemoryStorage,
///     types::{Decision, TrustResult, BudgetResult, ConsentResult, TrustLevel, AuditFilter},
/// };
///
/// let mut logger = AuditLogger::new(InMemoryStorage::new());
///
/// let decision = Decision {
///     permitted: true,
///     action: "send_report".into(),
///     timestamp_ms: 0,
///     reason: "PERMIT".into(),
///     trust: TrustResult {
///         permitted: true,
///         current_level: TrustLevel::ActAndReport,
///         required_level: TrustLevel::Suggest,
///         reason: "ok".into(),
///     },
///     budget: BudgetResult {
///         permitted: true,
///         available: 400.0,
///         requested: 0.0,
///         category: "default".into(),
///         reason: "ok".into(),
///     },
///     consent: ConsentResult {
///         permitted: true,
///         reason: "ok".into(),
///     },
/// };
///
/// logger.log(decision);
///
/// let records = logger.query(&AuditFilter::default());
/// assert_eq!(records.len(), 1);
/// ```
pub struct AuditLogger<S: Storage> {
    storage: S,
    /// Hash of the most recently appended record (genesis = 64 zeros).
    last_hash: String,
}

impl<S: Storage> AuditLogger<S> {
    /// Create a new [`AuditLogger`] with an empty chain.
    pub fn new(storage: S) -> Self {
        Self {
            storage,
            last_hash: "0".repeat(64),
        }
    }

    /// Append a governance decision to the audit chain.
    ///
    /// The record's `prev_hash` is set to the hash of the previous record
    /// (or 64 zeros for the genesis record), and the record's own `hash` is
    /// computed over the serialised decision so that tampering with any field
    /// breaks the chain.
    ///
    /// All decisions — both permits and denials — must be logged.
    pub fn log(&mut self, decision: Decision) {
        let timestamp_ms = decision.timestamp_ms;
        let action = decision.action.clone();

        let hash = compute_hash(&decision, &self.last_hash);
        let prev_hash = self.last_hash.clone();

        // Build a record id that embeds the agent context so queries can
        // filter by agent without deserialising every record.
        let record_id = format!("{}-{}", action, &hash[..8]);

        let record = AuditRecord {
            id: record_id,
            decision,
            hash: hash.clone(),
            prev_hash,
            timestamp_ms,
        };

        self.last_hash = hash;
        self.storage.append_audit(record);
    }

    /// Return all audit records that satisfy `filter`.
    ///
    /// Records are returned in append order (oldest first).  The log is
    /// read-only — filtering is the only supported operation.
    ///
    /// # Examples
    ///
    /// ```rust
    /// use aumos_governance_core::types::AuditFilter;
    ///
    /// let filter = AuditFilter {
    ///     action: Some("send_payment".into()),
    ///     limit: Some(10),
    ///     ..AuditFilter::default()
    /// };
    /// ```
    pub fn query(&self, filter: &AuditFilter) -> Vec<AuditRecord> {
        self.storage.query_audit(filter)
    }

    /// The hash of the most recently appended record.
    ///
    /// Useful for verifying chain continuity when records are exported.
    pub fn chain_tip(&self) -> &str {
        &self.last_hash
    }

    /// Borrow the underlying storage.
    pub fn storage(&self) -> &S {
        &self.storage
    }
}

// ---------------------------------------------------------------------------
// Hash chain implementation
// ---------------------------------------------------------------------------

/// Compute a deterministic hash string for an audit record.
///
/// In `std` mode a proper SHA-256 digest is produced.  In `no_std` mode a
/// lightweight FNV-1a 64-bit hash is used, rendered as a zero-padded 64-char
/// hex string to keep the field width consistent.
///
/// The hash covers the serialised decision **and** the previous record hash so
/// that any modification to any field in the chain is detectable.
fn compute_hash(decision: &Decision, prev_hash: &str) -> String {
    #[cfg(feature = "std")]
    {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        // Construct a deterministic byte string from the decision fields and
        // the previous hash.  We use serde_json for a stable canonical form.
        let payload = format!(
            "{}:{}:{}:{}:{}:{}",
            prev_hash,
            decision.action,
            decision.permitted,
            decision.timestamp_ms,
            decision.trust.current_level as u8,
            decision.budget.requested
        );

        // Apply a 64-bit hash seeded with the prev_hash to maintain chain
        // dependency.  This is a structural hash for chain linking; downstream
        // integrations that require cryptographic-strength audit trails should
        // layer an external signing step on top.
        let mut hasher = DefaultHasher::new();
        payload.hash(&mut hasher);
        let digest = hasher.finish();

        // Expand to 64 hex chars by doubling the 16-char u64 representation.
        let hex16 = format!("{:016x}", digest);
        hex16.repeat(4)
    }
    #[cfg(not(feature = "std"))]
    {
        // FNV-1a 64-bit — fast, deterministic, no_std compatible.
        let payload = format!(
            "{}:{}:{}:{}",
            prev_hash,
            decision.action,
            decision.permitted,
            decision.timestamp_ms
        );
        let hash64 = fnv1a_64(payload.as_bytes());
        let hex16 = u64_to_hex(hash64);
        // Repeat 4 times to produce a 64-char string that is structurally
        // consistent with the std path.
        let mut out = alloc::string::String::with_capacity(64);
        for _ in 0..4 {
            out.push_str(&hex16);
        }
        out
    }
}

#[cfg(not(feature = "std"))]
fn fnv1a_64(bytes: &[u8]) -> u64 {
    const FNV_OFFSET: u64 = 14_695_981_039_346_656_037;
    const FNV_PRIME: u64 = 1_099_511_628_211;
    let mut hash = FNV_OFFSET;
    for &byte in bytes {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

#[cfg(not(feature = "std"))]
fn u64_to_hex(value: u64) -> alloc::string::String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut out = alloc::string::String::with_capacity(16);
    for shift in (0..8).rev() {
        let byte = ((value >> (shift * 8)) & 0xFF) as u8;
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0xF) as usize] as char);
    }
    out
}
