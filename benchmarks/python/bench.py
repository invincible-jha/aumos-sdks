# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
AumOS cross-language benchmark — Python implementation.

Runs five standard governance scenarios and writes a JSON results object
to stdout. Uses time.perf_counter_ns and statistics from the standard library.

Usage::

    python bench.py > results/python.json
"""

from __future__ import annotations

import json
import platform
import statistics
import sys
import time
from dataclasses import dataclass, field
from typing import Callable


# ─── Types ───────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ScenarioResult:
    name: str
    iterations: int
    ops_per_sec: int
    mean_ns: int
    stdev_ns: int

    def to_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "iterations": self.iterations,
            "ops_per_sec": self.ops_per_sec,
            "mean_ns": self.mean_ns,
            "stdev_ns": self.stdev_ns,
        }


@dataclass(frozen=True)
class BenchmarkReport:
    language: str
    version: str
    runtime: str
    timestamp: str
    scenarios: list[ScenarioResult]

    def to_dict(self) -> dict[str, object]:
        return {
            "language": self.language,
            "version": self.version,
            "runtime": self.runtime,
            "timestamp": self.timestamp,
            "scenarios": [s.to_dict() for s in self.scenarios],
        }


# ─── Timing helpers ───────────────────────────────────────────────────────────


def measure_iterations(fn: Callable[[], None], iterations: int) -> tuple[int, int]:
    """
    Run fn for `iterations` cycles and return (mean_ns, stdev_ns).
    """
    # Warm-up — not included in results
    warmup_count = min(1000, iterations // 10)
    for _ in range(warmup_count):
        fn()

    samples: list[float] = []
    for _ in range(iterations):
        start = time.perf_counter_ns()
        fn()
        end = time.perf_counter_ns()
        samples.append(float(end - start))

    mean_ns = round(statistics.mean(samples))
    stdev_ns = round(statistics.stdev(samples)) if len(samples) > 1 else 0
    return mean_ns, stdev_ns


def to_scenario_result(
    name: str,
    iterations: int,
    fn: Callable[[], None],
) -> ScenarioResult:
    mean_ns, stdev_ns = measure_iterations(fn, iterations)
    ops_per_sec = round(1_000_000_000 / mean_ns) if mean_ns > 0 else 0
    return ScenarioResult(
        name=name,
        iterations=iterations,
        ops_per_sec=ops_per_sec,
        mean_ns=mean_ns,
        stdev_ns=stdev_ns,
    )


# ─── Inline governance stubs ──────────────────────────────────────────────────
# Stubs mirror the real SDK surface but use in-memory state only.
# This isolates the measurement to governance logic.

TRUST_ORDER: dict[str, int] = {"public": 0, "verified": 1, "privileged": 2}


def check_trust_level(agent_level: str, required_level: str) -> bool:
    return TRUST_ORDER[agent_level] >= TRUST_ORDER[required_level]


@dataclass
class BudgetState:
    token_limit: int
    call_limit: int
    tokens_used: int = field(default=0)
    calls_used: int = field(default=0)


def check_budget(state: BudgetState) -> bool:
    return state.tokens_used < state.token_limit and state.calls_used < state.call_limit


def record_spending(state: BudgetState, tokens: int) -> None:
    state.tokens_used += tokens
    state.calls_used += 1


@dataclass
class AuditRecord:
    event: str
    session_id: str
    timestamp: int


def append_audit_record(log: list[AuditRecord], record: AuditRecord) -> None:
    log.append(record)


# ─── Standard scenarios ───────────────────────────────────────────────────────

ITERATIONS = 100_000


def bench_trust_check() -> ScenarioResult:
    def run() -> None:
        check_trust_level("verified", "verified")

    return to_scenario_result("trust_check", ITERATIONS, run)


def bench_budget_enforcement() -> ScenarioResult:
    state = BudgetState(token_limit=10_000, call_limit=100)

    def run() -> None:
        check_budget(state)

    return to_scenario_result("budget_enforcement", ITERATIONS, run)


def bench_full_evaluation() -> ScenarioResult:
    state = BudgetState(token_limit=10_000, call_limit=1_000_000)
    log: list[AuditRecord] = []
    record = AuditRecord(event="tool-call", session_id="sess-bench", timestamp=0)

    def run() -> None:
        if check_trust_level("verified", "verified") and check_budget(state):
            record_spending(state, 10)
            append_audit_record(log, record)

    return to_scenario_result("full_evaluation", ITERATIONS, run)


def bench_audit_log() -> ScenarioResult:
    log: list[AuditRecord] = []
    record = AuditRecord(event="tool-call", session_id="sess-bench", timestamp=0)

    def run() -> None:
        append_audit_record(log, record)

    return to_scenario_result("audit_log", ITERATIONS, run)


def bench_conformance_vectors() -> ScenarioResult:
    vectors: list[tuple[str, str, bool]] = [
        ("public", "public", True),
        ("verified", "public", True),
        ("privileged", "verified", True),
        ("public", "verified", False),
        ("verified", "privileged", False),
    ]

    def run() -> None:
        for agent_level, required_level, expected in vectors:
            result = check_trust_level(agent_level, required_level)
            if result != expected:
                raise AssertionError(
                    f"Conformance failure: {agent_level} vs {required_level}"
                )

    return to_scenario_result("conformance_vectors", 10_000, run)


# ─── Entry point ─────────────────────────────────────────────────────────────


def main() -> None:
    scenarios = [
        bench_trust_check(),
        bench_budget_enforcement(),
        bench_full_evaluation(),
        bench_audit_log(),
        bench_conformance_vectors(),
    ]

    python_version = (
        f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    )
    runtime = f"cpython-{python_version}-{platform.machine()}"

    report = BenchmarkReport(
        language="python",
        version=python_version,
        runtime=runtime,
        timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        scenarios=scenarios,
    )

    json.dump(report.to_dict(), sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
