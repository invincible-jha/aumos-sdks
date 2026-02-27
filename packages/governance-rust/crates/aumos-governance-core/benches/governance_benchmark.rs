// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

//! Criterion benchmark suite for the AumOS governance engine.
//!
//! Benchmarks cover the four core governance operations:
//!
//! - Trust level comparison
//! - Budget enforcement (check + record)
//! - Full governance pipeline evaluation
//! - Audit log append + hash chain computation
//! - Conformance vector evaluation
//!
//! Run with: `cargo bench --bench governance_benchmark`

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};

use aumos_governance_core::{
    audit::AuditLogger,
    budget::BudgetManager,
    config::Config,
    consent::ConsentManager,
    engine::GovernanceEngine,
    storage::InMemoryStorage,
    trust::TrustManager,
    types::{
        AuditFilter, BudgetResult, ConsentResult, Context, Decision, TrustLevel, TrustResult,
    },
};

// ---------------------------------------------------------------------------
// Trust check benchmark
// ---------------------------------------------------------------------------

/// Benchmark 10K iterations of trust level comparison.
///
/// Measures the cost of looking up an agent's trust level from in-memory
/// storage and comparing it against a required level.
fn trust_check_benchmark(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("trust_check");

    // Pre-populate a TrustManager with several agents.
    let config = Config::default();
    let mut manager = TrustManager::new(config, InMemoryStorage::new());

    for index in 0..100 {
        let agent_id = format!("agent-{:04}", index);
        manager.set_level(&agent_id, "default", TrustLevel::ActAndReport, "owner");
    }

    group.bench_function("check_existing_agent", |bencher| {
        bencher.iter(|| {
            let result = manager.check_level(
                black_box("agent-0042"),
                black_box("default"),
                black_box(TrustLevel::Suggest),
            );
            black_box(result);
        });
    });

    group.bench_function("check_missing_agent", |bencher| {
        bencher.iter(|| {
            let result = manager.check_level(
                black_box("nonexistent-agent"),
                black_box("default"),
                black_box(TrustLevel::Observer),
            );
            black_box(result);
        });
    });

    group.bench_function("check_level_comparison_all_variants", |bencher| {
        let levels = [
            TrustLevel::Observer,
            TrustLevel::Monitor,
            TrustLevel::Suggest,
            TrustLevel::ActWithApproval,
            TrustLevel::ActAndReport,
            TrustLevel::Autonomous,
        ];
        bencher.iter(|| {
            for &required in &levels {
                let result = manager.check_level(
                    black_box("agent-0001"),
                    black_box("default"),
                    black_box(required),
                );
                black_box(result);
            }
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Budget enforcement benchmark
// ---------------------------------------------------------------------------

/// Benchmark 10K iterations of budget check operations.
///
/// Measures the cost of verifying that a spend fits within a static
/// spending envelope.
fn budget_enforcement_benchmark(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("budget_enforcement");

    let config = Config::default();
    let mut manager = BudgetManager::new(config, InMemoryStorage::new());

    // Create envelopes for several categories.
    for index in 0..50 {
        let category = format!("category-{:03}", index);
        manager.create_envelope(&category, 10_000.0, 86_400_000, 0);
    }

    group.bench_function("check_within_budget", |bencher| {
        bencher.iter(|| {
            let result = manager.check(
                black_box("category-025"),
                black_box(10.0),
            );
            black_box(result);
        });
    });

    group.bench_function("check_exceeds_budget", |bencher| {
        // Pre-spend most of the budget.
        manager.record("category-049", 9_999.0);

        bencher.iter(|| {
            let result = manager.check(
                black_box("category-049"),
                black_box(50.0),
            );
            black_box(result);
        });
    });

    group.bench_function("check_missing_envelope", |bencher| {
        bencher.iter(|| {
            let result = manager.check(
                black_box("nonexistent-category"),
                black_box(1.0),
            );
            black_box(result);
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Full evaluation benchmark
// ---------------------------------------------------------------------------

/// Benchmark 1K iterations of the complete governance pipeline.
///
/// This exercises trust check, budget check, consent check, and audit log
/// append in a single call to `GovernanceEngine::check`.
fn full_evaluation_benchmark(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("full_evaluation");

    let config = Config {
        require_consent: false,
        default_observer_on_missing: false,
        pass_on_missing_envelope: true,
    };

    let mut engine = GovernanceEngine::new(config, InMemoryStorage::new());

    // Pre-populate trust and budget for several agents.
    for index in 0..20 {
        let agent_id = format!("agent-{:03}", index);
        engine.trust.set_level(&agent_id, "default", TrustLevel::ActAndReport, "owner");
        engine.budget.create_envelope(
            &format!("budget-{:03}", index),
            100_000.0,
            86_400_000,
            0,
        );
    }

    let context_permit = Context {
        agent_id: "agent-005".to_string(),
        scope: "default".to_string(),
        required_trust: TrustLevel::Suggest,
        cost: Some(1.0),
        category: "budget-005".to_string(),
        data_type: None,
        purpose: None,
    };

    let context_deny_trust = Context {
        agent_id: "unknown-agent".to_string(),
        scope: "default".to_string(),
        required_trust: TrustLevel::Autonomous,
        cost: None,
        category: "default".to_string(),
        data_type: None,
        purpose: None,
    };

    group.bench_function("permit_path", |bencher| {
        bencher.iter(|| {
            let decision = engine.check(black_box("bench_action"), black_box(&context_permit));
            black_box(decision);
        });
    });

    group.bench_function("deny_trust_path", |bencher| {
        bencher.iter(|| {
            let decision = engine.check(black_box("bench_action"), black_box(&context_deny_trust));
            black_box(decision);
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Audit log benchmark
// ---------------------------------------------------------------------------

/// Benchmark 10K iterations of audit entry append + hash chain.
///
/// Measures the cost of logging a governance decision, including hash
/// chain computation.
fn audit_log_benchmark(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("audit_log");

    let mut logger = AuditLogger::new(InMemoryStorage::new());

    let sample_decision = Decision {
        permitted: true,
        action: "benchmark_action".to_string(),
        timestamp_ms: 1_700_000_000_000,
        reason: "All governance gates passed.".to_string(),
        trust: TrustResult {
            permitted: true,
            current_level: TrustLevel::ActAndReport,
            required_level: TrustLevel::Suggest,
            reason: "Sufficient trust".to_string(),
        },
        budget: BudgetResult {
            permitted: true,
            available: 999.0,
            requested: 1.0,
            category: "benchmark".to_string(),
            reason: "Within budget".to_string(),
        },
        consent: ConsentResult {
            permitted: true,
            reason: "Consent granted".to_string(),
        },
    };

    group.bench_function("append_entry", |bencher| {
        bencher.iter(|| {
            logger.log(black_box(sample_decision.clone()));
        });
    });

    group.bench_function("query_empty_filter", |bencher| {
        // Logger now has accumulated entries from the append benchmark.
        let filter = AuditFilter::default();
        bencher.iter(|| {
            let records = logger.query(black_box(&filter));
            black_box(records);
        });
    });

    group.bench_function("query_with_action_filter", |bencher| {
        let filter = AuditFilter {
            action: Some("benchmark_action".to_string()),
            limit: Some(10),
            ..AuditFilter::default()
        };
        bencher.iter(|| {
            let records = logger.query(black_box(&filter));
            black_box(records);
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Conformance vector benchmark
// ---------------------------------------------------------------------------

/// Benchmark the Basic conformance vectors: a set of minimal governance
/// evaluations covering the most common patterns.
///
/// Each iteration runs 5 representative governance checks:
/// 1. Observer agent requesting Observer-level action (permit)
/// 2. Monitor agent requesting Autonomous action (deny - trust)
/// 3. Agent with budget requesting a spend (permit + debit)
/// 4. Agent with consent requesting a data action (permit)
/// 5. Agent without consent requesting a data action (deny - consent)
fn conformance_vector_benchmark(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("conformance_vectors");

    group.bench_function("basic_conformance_suite", |bencher| {
        bencher.iter(|| {
            let config = Config {
                require_consent: false,
                default_observer_on_missing: true,
                pass_on_missing_envelope: true,
            };
            let mut engine = GovernanceEngine::new(config, InMemoryStorage::new());

            // Setup
            engine.trust.set_level("agent-obs", "scope", TrustLevel::Observer, "owner");
            engine.trust.set_level("agent-mon", "scope", TrustLevel::Monitor, "owner");
            engine.trust.set_level("agent-act", "scope", TrustLevel::ActAndReport, "owner");
            engine.budget.create_envelope("tokens", 1000.0, 86_400_000, 0);
            engine.consent.record("agent-act", "read_pii");

            // Vector 1: Observer requesting Observer (permit)
            let v1 = Context {
                agent_id: "agent-obs".into(),
                scope: "scope".into(),
                required_trust: TrustLevel::Observer,
                cost: None,
                category: "default".into(),
                data_type: None,
                purpose: None,
            };
            let d1 = engine.check(black_box("observe"), black_box(&v1));
            assert!(d1.permitted);

            // Vector 2: Monitor requesting Autonomous (deny)
            let v2 = Context {
                agent_id: "agent-mon".into(),
                scope: "scope".into(),
                required_trust: TrustLevel::Autonomous,
                cost: None,
                category: "default".into(),
                data_type: None,
                purpose: None,
            };
            let d2 = engine.check(black_box("delete_all"), black_box(&v2));
            assert!(!d2.permitted);

            // Vector 3: Budget spend (permit + debit)
            let v3 = Context {
                agent_id: "agent-act".into(),
                scope: "scope".into(),
                required_trust: TrustLevel::Suggest,
                cost: Some(50.0),
                category: "tokens".into(),
                data_type: None,
                purpose: None,
            };
            let d3 = engine.check(black_box("call_llm"), black_box(&v3));
            assert!(d3.permitted);

            // Vector 4: With consent (permit)
            let v4 = Context {
                agent_id: "agent-act".into(),
                scope: "scope".into(),
                required_trust: TrustLevel::Suggest,
                cost: None,
                category: "default".into(),
                data_type: Some("read_pii".into()),
                purpose: None,
            };
            let d4 = engine.check(black_box("read_user_data"), black_box(&v4));
            assert!(d4.permitted);

            // Vector 5: Without consent (deny via consent config — only if
            // require_consent is true, so we test via data_type match)
            let v5 = Context {
                agent_id: "agent-act".into(),
                scope: "scope".into(),
                required_trust: TrustLevel::Suggest,
                cost: None,
                category: "default".into(),
                data_type: Some("write_pii".into()),
                purpose: None,
            };
            let d5 = engine.check(black_box("write_user_data"), black_box(&v5));
            // This will be denied because consent for "write_pii" was never recorded.
            assert!(!d5.permitted);

            black_box((d1, d2, d3, d4, d5));
        });
    });

    group.finish();
}

// ---------------------------------------------------------------------------
// Criterion harness
// ---------------------------------------------------------------------------

criterion_group!(
    benches,
    trust_check_benchmark,
    budget_enforcement_benchmark,
    full_evaluation_benchmark,
    audit_log_benchmark,
    conformance_vector_benchmark,
);

criterion_main!(benches);
