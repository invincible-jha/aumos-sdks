// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! # aumos-governance-core
//!
//! Core governance engine for the AumOS agent governance protocol.
//!
//! This crate is `no_std`-compatible (requires `alloc`).  Enable the `std`
//! feature (on by default) to lift that restriction and gain access to
//! standard-library conveniences.
//!
//! ## Architecture
//!
//! ```text
//! GovernanceEngine<S: Storage>
//!   ├── TrustManager<S>    — assign / query / check agent trust levels
//!   ├── BudgetManager<S>   — create / check / record spending envelopes
//!   ├── ConsentManager<S>  — record / check / revoke consent grants
//!   └── AuditLogger<S>     — log decisions, query audit chain
//! ```
//!
//! ## Quick Start
//!
//! ```rust
//! use aumos_governance_core::{
//!     engine::GovernanceEngine,
//!     storage::InMemoryStorage,
//!     types::{Context, TrustLevel},
//!     config::Config,
//! };
//!
//! let storage = InMemoryStorage::new();
//! let config  = Config::default();
//! let mut engine = GovernanceEngine::new(config, storage);
//!
//! // Assign a trust level to an agent (manual — never automatic).
//! engine.trust.set_level("agent-001", "finance", TrustLevel::ActAndReport, "owner");
//!
//! // Evaluate an action.
//! let ctx = Context {
//!     agent_id:      "agent-001".into(),
//!     scope:         "finance".into(),
//!     required_trust: TrustLevel::Suggest,
//!     cost:          Some(10.0),
//!     category:      "financial".into(),
//!     data_type:     None,
//!     purpose:       None,
//! };
//! let decision = engine.check("send_payment", &ctx);
//! assert!(decision.permitted);
//! ```

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub mod audit;
pub mod budget;
pub mod config;
pub mod consent;
pub mod engine;
pub mod storage;
pub mod trust;
pub mod types;

// Re-export the most commonly used items at the crate root so consumers can
// write `use aumos_governance_core::GovernanceEngine;` instead of the fully
// qualified path.
pub use engine::GovernanceEngine;
pub use storage::{InMemoryStorage, Storage};
pub use types::{
    AuditFilter, AuditRecord, BudgetResult, ConsentResult, Context, Decision, Envelope,
    TrustAssignment, TrustLevel, TrustResult,
};
