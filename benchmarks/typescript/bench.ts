// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * AumOS cross-language benchmark — TypeScript implementation.
 *
 * Runs five standard governance scenarios and writes a JSON results object
 * to stdout. No external benchmark framework — uses node:perf_hooks only.
 *
 * Usage:
 *   npx tsx bench.ts > results/typescript.json
 */

import { performance } from 'node:perf_hooks';
import { execSync } from 'node:child_process';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScenarioResult {
  readonly name: string;
  readonly iterations: number;
  readonly ops_per_sec: number;
  readonly mean_ns: number;
  readonly stdev_ns: number;
}

interface BenchmarkReport {
  readonly language: 'typescript';
  readonly version: string;
  readonly runtime: string;
  readonly timestamp: string;
  readonly scenarios: readonly ScenarioResult[];
}

type BenchmarkFn = () => void;

// ─── Timing helpers ───────────────────────────────────────────────────────────

/** Run `fn` for `iterations` cycles and return statistics in nanoseconds. */
function measureIterations(
  fn: BenchmarkFn,
  iterations: number,
): { meanNs: number; stdevNs: number } {
  const samples: number[] = [];

  // Warm-up — not included in results
  for (let warmup = 0; warmup < Math.min(1000, iterations / 10); warmup++) {
    fn();
  }

  for (let index = 0; index < iterations; index++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    samples.push((end - start) * 1_000_000); // convert ms -> ns
  }

  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance =
    samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
  const stdev = Math.sqrt(variance);

  return { meanNs: Math.round(mean), stdevNs: Math.round(stdev) };
}

function toScenarioResult(
  name: string,
  iterations: number,
  fn: BenchmarkFn,
): ScenarioResult {
  const { meanNs, stdevNs } = measureIterations(fn, iterations);
  const opsPerSec = meanNs > 0 ? Math.round(1_000_000_000 / meanNs) : 0;
  return { name, iterations, ops_per_sec: opsPerSec, mean_ns: meanNs, stdev_ns: stdevNs };
}

// ─── Inline governance stubs ──────────────────────────────────────────────────
// The benchmark stubs mirror the real SDK surface but use in-memory state only.
// This isolates the measurement to governance logic, not import overhead.

type TrustLevel = 'public' | 'verified' | 'privileged';

interface TrustPolicy {
  readonly requiredLevel: TrustLevel;
  readonly toolName: string;
}

interface BudgetState {
  tokenLimit: number;
  callLimit: number;
  tokensUsed: number;
  callsUsed: number;
}

interface AuditRecord {
  readonly event: string;
  readonly sessionId: string;
  readonly timestamp: number;
}

const TRUST_ORDER: Record<TrustLevel, number> = { public: 0, verified: 1, privileged: 2 };

function checkTrustLevel(agentLevel: TrustLevel, policy: TrustPolicy): boolean {
  return TRUST_ORDER[agentLevel] >= TRUST_ORDER[policy.requiredLevel];
}

function checkBudget(state: BudgetState): boolean {
  return state.tokensUsed < state.tokenLimit && state.callsUsed < state.callLimit;
}

function recordSpending(state: BudgetState, tokens: number): void {
  state.tokensUsed += tokens;
  state.callsUsed += 1;
}

function appendAuditRecord(log: AuditRecord[], record: AuditRecord): void {
  log.push(record);
}

// ─── Standard scenarios ───────────────────────────────────────────────────────

const ITERATIONS = 100_000;

function benchTrustCheck(): ScenarioResult {
  const policy: TrustPolicy = { requiredLevel: 'verified', toolName: 'file-reader' };

  return toScenarioResult('trust_check', ITERATIONS, () => {
    checkTrustLevel('verified', policy);
  });
}

function benchBudgetEnforcement(): ScenarioResult {
  const state: BudgetState = {
    tokenLimit: 10_000,
    callLimit: 100,
    tokensUsed: 0,
    callsUsed: 0,
  };

  return toScenarioResult('budget_enforcement', ITERATIONS, () => {
    checkBudget(state);
  });
}

function benchFullEvaluation(): ScenarioResult {
  const policy: TrustPolicy = { requiredLevel: 'verified', toolName: 'file-reader' };
  const state: BudgetState = {
    tokenLimit: 10_000,
    callLimit: 1_000_000,
    tokensUsed: 0,
    callsUsed: 0,
  };
  const log: AuditRecord[] = [];

  return toScenarioResult('full_evaluation', ITERATIONS, () => {
    if (checkTrustLevel('verified', policy) && checkBudget(state)) {
      recordSpending(state, 10);
      appendAuditRecord(log, { event: 'tool-call', sessionId: 'sess-bench', timestamp: 0 });
    }
  });
}

function benchAuditLog(): ScenarioResult {
  const log: AuditRecord[] = [];
  const record: AuditRecord = { event: 'tool-call', sessionId: 'sess-bench', timestamp: 0 };

  return toScenarioResult('audit_log', ITERATIONS, () => {
    appendAuditRecord(log, record);
  });
}

function benchConformanceVectors(): ScenarioResult {
  // Validates a fixed set of known-good / known-bad decisions.
  // Iteration count is lower — this checks correctness, not throughput.
  const vectors: Array<{ agentLevel: TrustLevel; requiredLevel: TrustLevel; expected: boolean }> =
    [
      { agentLevel: 'public', requiredLevel: 'public', expected: true },
      { agentLevel: 'verified', requiredLevel: 'public', expected: true },
      { agentLevel: 'privileged', requiredLevel: 'verified', expected: true },
      { agentLevel: 'public', requiredLevel: 'verified', expected: false },
      { agentLevel: 'verified', requiredLevel: 'privileged', expected: false },
    ];

  return toScenarioResult('conformance_vectors', 10_000, () => {
    for (const vector of vectors) {
      const result = checkTrustLevel(vector.agentLevel, {
        requiredLevel: vector.requiredLevel,
        toolName: 'bench',
      });
      if (result !== vector.expected) {
        throw new Error(
          `Conformance failure: ${vector.agentLevel} vs ${vector.requiredLevel}`,
        );
      }
    }
  });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

function getNodeVersion(): string {
  return `node-${process.version}`;
}

function getTsVersion(): string {
  try {
    const output = execSync('npx tsc --version', { encoding: 'utf8' }).trim();
    return output.replace('Version ', '');
  } catch {
    return 'unknown';
  }
}

function main(): void {
  const scenarios: ScenarioResult[] = [
    benchTrustCheck(),
    benchBudgetEnforcement(),
    benchFullEvaluation(),
    benchAuditLog(),
    benchConformanceVectors(),
  ];

  const report: BenchmarkReport = {
    language: 'typescript',
    version: getTsVersion(),
    runtime: getNodeVersion(),
    timestamp: new Date().toISOString(),
    scenarios,
  };

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main();
