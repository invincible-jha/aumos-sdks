// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! AumOS cross-language benchmark suite — Rust implementation.
//!
//! Uses `criterion` for stable, statistically sound measurements.
//!
//! Run all benchmarks:
//! ```
//! cargo bench --bench governance
//! ```
//!
//! Export JSON results (requires the `export-results` binary):
//! ```
//! cargo bench --bench governance -- --output-format bencher 2>&1 | \
//!   cargo run --bin export-results > results/rust.json
//! ```

use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

// ─── Governance stubs ─────────────────────────────────────────────────────────
// Stubs mirror the real SDK surface but use in-memory state only.
// This isolates the measurement to governance logic.

/// Operator-assigned trust tier. Levels are set manually — never computed
/// or promoted automatically.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum TrustLevel {
    Public = 0,
    Verified = 1,
    Privileged = 2,
}

/// Static operator policy for a single tool.
#[derive(Debug, Clone)]
pub struct TrustPolicy {
    pub required_level: TrustLevel,
    pub tool_name: &'static str,
}

/// Returns `true` if `agent_level` meets or exceeds the policy's required level.
#[inline]
pub fn check_trust_level(agent_level: TrustLevel, policy: &TrustPolicy) -> bool {
    agent_level >= policy.required_level
}

/// Fixed limits and current usage for one session.
/// Limits are static — set at creation, never changed automatically.
#[derive(Debug, Clone)]
pub struct BudgetState {
    pub token_limit: u64,
    pub call_limit: u64,
    pub tokens_used: u64,
    pub calls_used: u64,
}

/// Returns `true` if the session has remaining token and call budget.
#[inline]
pub fn check_budget(state: &BudgetState) -> bool {
    state.tokens_used < state.token_limit && state.calls_used < state.call_limit
}

/// Updates the session's usage counters.
#[inline]
pub fn record_spending(state: &mut BudgetState, tokens: u64) {
    state.tokens_used += tokens;
    state.calls_used += 1;
}

/// A single, immutable governance event. Records are written once and never
/// modified — no analysis or anomaly detection.
#[derive(Debug, Clone, Serialize)]
pub struct AuditRecord {
    pub event: &'static str,
    pub session_id: &'static str,
    pub timestamp: u64,
}

/// Appends a record to the in-memory log.
#[inline]
pub fn append_audit_record(log: &mut Vec<AuditRecord>, record: AuditRecord) {
    log.push(record);
}

// ─── Standard benchmark functions ────────────────────────────────────────────

fn bench_trust_check(criterion: &mut Criterion) {
    let policy = TrustPolicy {
        required_level: TrustLevel::Verified,
        tool_name: "file-reader",
    };

    criterion.bench_function("trust_check", |bencher| {
        bencher.iter(|| {
            black_box(check_trust_level(
                black_box(TrustLevel::Verified),
                black_box(&policy),
            ))
        });
    });
}

fn bench_budget_enforcement(criterion: &mut Criterion) {
    let state = BudgetState {
        token_limit: 10_000,
        call_limit: 100,
        tokens_used: 0,
        calls_used: 0,
    };

    criterion.bench_function("budget_enforcement", |bencher| {
        bencher.iter(|| black_box(check_budget(black_box(&state))));
    });
}

fn bench_full_evaluation(criterion: &mut Criterion) {
    let policy = TrustPolicy {
        required_level: TrustLevel::Verified,
        tool_name: "file-reader",
    };
    let mut state = BudgetState {
        token_limit: u64::MAX,
        call_limit: u64::MAX,
        tokens_used: 0,
        calls_used: 0,
    };
    let mut log: Vec<AuditRecord> = Vec::with_capacity(1_000_000);
    let record = AuditRecord {
        event: "tool-call",
        session_id: "sess-bench",
        timestamp: 0,
    };

    criterion.bench_function("full_evaluation", |bencher| {
        bencher.iter(|| {
            if check_trust_level(black_box(TrustLevel::Verified), black_box(&policy))
                && check_budget(black_box(&state))
            {
                record_spending(&mut state, 10);
                append_audit_record(&mut log, record.clone());
            }
        });
    });
}

fn bench_audit_log(criterion: &mut Criterion) {
    let mut log: Vec<AuditRecord> = Vec::with_capacity(1_000_000);
    let record = AuditRecord {
        event: "tool-call",
        session_id: "sess-bench",
        timestamp: 0,
    };

    criterion.bench_function("audit_log", |bencher| {
        bencher.iter(|| {
            append_audit_record(&mut log, black_box(record.clone()));
        });
    });
}

fn bench_conformance_vectors(criterion: &mut Criterion) {
    type Vector = (TrustLevel, TrustLevel, bool);
    let vectors: &[Vector] = &[
        (TrustLevel::Public, TrustLevel::Public, true),
        (TrustLevel::Verified, TrustLevel::Public, true),
        (TrustLevel::Privileged, TrustLevel::Verified, true),
        (TrustLevel::Public, TrustLevel::Verified, false),
        (TrustLevel::Verified, TrustLevel::Privileged, false),
    ];

    criterion.bench_with_input(
        BenchmarkId::new("conformance_vectors", "fixed-set"),
        vectors,
        |bencher, vectors| {
            bencher.iter(|| {
                for &(agent_level, required_level, expected) in black_box(vectors) {
                    let policy = TrustPolicy {
                        required_level,
                        tool_name: "bench",
                    };
                    let result = check_trust_level(agent_level, &policy);
                    assert_eq!(result, expected, "conformance failure");
                }
            });
        },
    );
}

// ─── Criterion groups ─────────────────────────────────────────────────────────

criterion_group!(
    governance_benchmarks,
    bench_trust_check,
    bench_budget_enforcement,
    bench_full_evaluation,
    bench_audit_log,
    bench_conformance_vectors,
);
criterion_main!(governance_benchmarks);

// ─── Standalone JSON export ───────────────────────────────────────────────────
// This module is compiled when running `cargo test --bench governance --features export`.
// It writes the standardized cross-language JSON format.

#[cfg(test)]
mod export {
    use super::*;
    use std::time::Instant;

    #[derive(Serialize)]
    struct ScenarioResult {
        name: String,
        iterations: u64,
        ops_per_sec: u64,
        mean_ns: u64,
        stdev_ns: u64,
    }

    #[derive(Serialize)]
    struct BenchmarkReport {
        language: String,
        version: String,
        runtime: String,
        timestamp: String,
        scenarios: Vec<ScenarioResult>,
    }

    fn measure(iterations: u64, mut fn_: impl FnMut()) -> (u64, u64) {
        // Warm-up
        for _ in 0..iterations / 10 {
            fn_();
        }
        let mut samples = Vec::with_capacity(iterations as usize);
        for _ in 0..iterations {
            let start = Instant::now();
            fn_();
            samples.push(start.elapsed().as_nanos() as f64);
        }
        let mean = samples.iter().sum::<f64>() / samples.len() as f64;
        let variance = samples.iter().map(|v| (v - mean).powi(2)).sum::<f64>()
            / samples.len() as f64;
        let stdev = variance.sqrt();
        (mean as u64, stdev as u64)
    }

    #[test]
    fn export_results() {
        const ITERATIONS: u64 = 100_000;

        let policy = TrustPolicy {
            required_level: TrustLevel::Verified,
            tool_name: "file-reader",
        };
        let mut full_state = BudgetState {
            token_limit: u64::MAX,
            call_limit: u64::MAX,
            tokens_used: 0,
            calls_used: 0,
        };
        let mut audit_log: Vec<AuditRecord> = Vec::with_capacity(ITERATIONS as usize);
        let record = AuditRecord {
            event: "tool-call",
            session_id: "sess-bench",
            timestamp: 0,
        };

        let mut scenarios = Vec::new();

        let add = |name: &str, iters: u64, mean: u64, stdev: u64, scenarios: &mut Vec<ScenarioResult>| {
            let ops = if mean > 0 { 1_000_000_000 / mean } else { 0 };
            scenarios.push(ScenarioResult {
                name: name.to_string(),
                iterations: iters,
                ops_per_sec: ops,
                mean_ns: mean,
                stdev_ns: stdev,
            });
        };

        let (mean, stdev) = measure(ITERATIONS, || {
            let _ = black_box(check_trust_level(TrustLevel::Verified, &policy));
        });
        add("trust_check", ITERATIONS, mean, stdev, &mut scenarios);

        let budget_state = BudgetState { token_limit: 10_000, call_limit: 100, tokens_used: 0, calls_used: 0 };
        let (mean, stdev) = measure(ITERATIONS, || {
            let _ = black_box(check_budget(&budget_state));
        });
        add("budget_enforcement", ITERATIONS, mean, stdev, &mut scenarios);

        let (mean, stdev) = measure(ITERATIONS, || {
            if check_trust_level(TrustLevel::Verified, &policy) && check_budget(&full_state) {
                record_spending(&mut full_state, 10);
                append_audit_record(&mut audit_log, record.clone());
            }
        });
        add("full_evaluation", ITERATIONS, mean, stdev, &mut scenarios);

        let (mean, stdev) = measure(ITERATIONS, || {
            append_audit_record(&mut audit_log, black_box(record.clone()));
        });
        add("audit_log", ITERATIONS, mean, stdev, &mut scenarios);

        let (mean, stdev) = measure(10_000, || {
            let _ = check_trust_level(TrustLevel::Public, &TrustPolicy { required_level: TrustLevel::Public, tool_name: "bench" });
        });
        add("conformance_vectors", 10_000, mean, stdev, &mut scenarios);

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let report = BenchmarkReport {
            language: "rust".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            runtime: format!("rustc-{}", env!("CARGO_PKG_VERSION")),
            timestamp: format!("{}", timestamp),
            scenarios,
        };

        println!("{}", serde_json::to_string_pretty(&report).unwrap());
    }
}
