// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! # aumos-governance-std
//!
//! `std`-only storage backends for `aumos-governance-core`.
//!
//! This crate provides [`FileStorage`], a JSON file-backed implementation of
//! the [`Storage`] trait suitable for CLI tools, local agents, and server-side
//! deployments that do not need a full database.
//!
//! ## Quick Start
//!
//! ```rust,no_run
//! use aumos_governance_std::storage::FileStorage;
//! use aumos_governance_core::{GovernanceEngine, config::Config};
//!
//! let storage = FileStorage::open("/var/lib/aumos/governance.json")
//!     .expect("failed to open storage file");
//!
//! let mut engine = GovernanceEngine::new(Config::default(), storage);
//! ```

pub mod storage;

pub use storage::file::FileStorage;
