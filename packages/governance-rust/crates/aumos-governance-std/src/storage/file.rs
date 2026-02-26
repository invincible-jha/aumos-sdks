// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! File-based JSON storage backend.
//!
//! [`FileStorage`] persists all governance state to a single JSON file on
//! disk.  Every mutation flushes the file atomically (write-rename) so that a
//! crash mid-write does not corrupt existing data.
//!
//! ## Layout
//!
//! The JSON file has the shape:
//!
//! ```json
//! {
//!   "trust":     { "<agent_id>:<scope>": TrustAssignment, ... },
//!   "envelopes": { "<category>":         Envelope,         ... },
//!   "consent":   { "<agent_id>:<action>": true | false,    ... },
//!   "audit":     [ AuditRecord, ... ]
//! }
//! ```
//!
//! ## Caveats
//!
//! * [`FileStorage`] holds the full in-memory state and flushes on every
//!   mutation.  It is not intended for high-frequency write workloads.
//! * Concurrent access from multiple processes is not supported.  Use a
//!   proper database-backed storage implementation for multi-process
//!   deployments.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};

use aumos_governance_core::storage::Storage;
use aumos_governance_core::types::{AuditFilter, AuditRecord, Envelope, TrustAssignment};
use serde::{Deserialize, Serialize};

/// Snapshot of all governance state, serialised to / deserialised from disk.
#[derive(Debug, Default, Serialize, Deserialize)]
struct StorageSnapshot {
    trust:     HashMap<String, TrustAssignment>,
    envelopes: HashMap<String, Envelope>,
    consent:   HashMap<String, bool>,
    audit:     Vec<AuditRecord>,
}

/// A file-backed [`Storage`] implementation that persists state as JSON.
///
/// # Examples
///
/// ```rust,no_run
/// use aumos_governance_std::storage::file::FileStorage;
/// use aumos_governance_core::Storage;
///
/// let mut storage = FileStorage::open("/tmp/governance.json")
///     .expect("could not open storage");
///
/// storage.set_consent("agent-001", "read_pii", true);
/// assert!(storage.get_consent("agent-001", "read_pii"));
/// ```
pub struct FileStorage {
    path: PathBuf,
    data: StorageSnapshot,
}

impl FileStorage {
    /// Open an existing JSON storage file, or create a new empty one if the
    /// path does not exist.
    ///
    /// # Errors
    ///
    /// Returns an [`io::Error`] if the file exists but cannot be read or if
    /// the JSON is malformed.
    pub fn open<P: AsRef<Path>>(path: P) -> io::Result<Self> {
        let path = path.as_ref().to_path_buf();
        let data = if path.exists() {
            let raw = std::fs::read_to_string(&path)?;
            serde_json::from_str(&raw).map_err(|error| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("governance storage JSON parse error: {}", error),
                )
            })?
        } else {
            StorageSnapshot::default()
        };

        Ok(Self { path, data })
    }

    /// Flush the current in-memory state to disk using an atomic write-rename.
    ///
    /// The file is written to `<path>.tmp` first, then renamed over the
    /// target, so a crash during the write never leaves a partial file.
    ///
    /// # Errors
    ///
    /// Returns an [`io::Error`] if serialisation fails or the file cannot be
    /// written or renamed.
    pub fn flush(&self) -> io::Result<()> {
        let json = serde_json::to_string_pretty(&self.data).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("governance storage serialisation error: {}", error),
            )
        })?;

        let tmp_path = self.path.with_extension("tmp");
        std::fs::write(&tmp_path, json)?;
        std::fs::rename(&tmp_path, &self.path)?;
        Ok(())
    }

    /// Composite key used for both trust and consent maps.
    fn composite_key(left: &str, right: &str) -> String {
        format!("{}:{}", left, right)
    }
}

impl Storage for FileStorage {
    fn get_trust(&self, agent_id: &str, scope: &str) -> Option<TrustAssignment> {
        let key = Self::composite_key(agent_id, scope);
        self.data.trust.get(&key).cloned()
    }

    fn set_trust(&mut self, agent_id: &str, scope: &str, assignment: TrustAssignment) {
        let key = Self::composite_key(agent_id, scope);
        self.data.trust.insert(key, assignment);
        // Errors are silently ignored here; callers that need guaranteed
        // durability should call flush() explicitly and handle the Result.
        let _ = self.flush();
    }

    fn get_envelope(&self, category: &str) -> Option<Envelope> {
        self.data.envelopes.get(category).cloned()
    }

    fn set_envelope(&mut self, category: &str, envelope: Envelope) {
        self.data.envelopes.insert(category.to_string(), envelope);
        let _ = self.flush();
    }

    fn get_consent(&self, agent_id: &str, action: &str) -> bool {
        let key = Self::composite_key(agent_id, action);
        self.data.consent.get(&key).copied().unwrap_or(false)
    }

    fn set_consent(&mut self, agent_id: &str, action: &str, granted: bool) {
        let key = Self::composite_key(agent_id, action);
        self.data.consent.insert(key, granted);
        let _ = self.flush();
    }

    fn append_audit(&mut self, record: AuditRecord) {
        self.data.audit.push(record);
        let _ = self.flush();
    }

    fn query_audit(&self, filter: &AuditFilter) -> Vec<AuditRecord> {
        self.data
            .audit
            .iter()
            .filter(|record| {
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
