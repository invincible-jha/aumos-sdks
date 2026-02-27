# AumOS SDK — Cross-Language Governance Benchmark Suite

Measures the overhead of each governance component across all four supported
languages so library authors and integrators can make informed decisions.

---

## Standard Scenarios

Every language implementation runs the same five scenarios in the same order.
Results are comparable because each scenario performs an identical logical operation.

| # | Scenario | What it measures |
|---|----------|-----------------|
| 1 | **Trust Check** | Cost of a single trust-level comparison against a static policy |
| 2 | **Budget Enforcement** | Cost of a single budget check (token limit + call limit) |
| 3 | **Full Evaluation** | Sequential: trust check, then budget check, then audit log |
| 4 | **Audit Log** | Cost of appending one structured record to the in-memory log |
| 5 | **Conformance Vectors** | Validates a fixed set of known-good/known-bad governance decisions |

All operations use in-memory state only. No I/O, no network, no database.

---

## Running Benchmarks

### TypeScript

```bash
cd benchmarks/typescript
npm install
npx tsx bench.ts > results/typescript.json
```

Requires Node.js 20+. Uses `node:perf_hooks` — no external benchmark framework.

### Python

```bash
cd benchmarks/python
pip install aumos-governance agent-audit-trail budget-enforcer
python bench.py > results/python.json
```

Requires Python 3.10+. Uses `time.perf_counter_ns` from the standard library.

### Go

```bash
cd benchmarks/go
go test -bench=. -benchmem -count=3 -json > results/go-raw.json
go run export_results.go results/go-raw.json > results/go.json
```

Requires Go 1.22+. Uses the standard `testing.B` benchmark harness.

### Rust

```bash
cd benchmarks/rust
cargo bench --bench governance -- --output-format bencher 2>&1 | \
  cargo run --bin export-results > results/rust.json
```

Requires Rust 1.78+. Uses the `criterion` crate.

---

## Generating Comparison Reports

Run all four benchmarks first, then:

```bash
cd benchmarks
python compare.py --results-dir results/ --output report.md
```

The comparison script produces:

- `report.md` — Markdown table with ops/sec per language per scenario,
  fastest language highlighted with `**bold**`
- `report-chart.json` — Chart-ready JSON for plotting (see format below)
- Stdout summary with fastest/slowest for each scenario

### CI Mode

```bash
python compare.py --results-dir results/ --baseline baseline/ --ci
```

In CI mode the script exits non-zero if any language regresses more than 10%
from the baseline stored in `baseline/`. Use this in your PR pipeline.

---

## Results Format Specification

Each language benchmark outputs a single JSON object to stdout:

```json
{
  "language": "typescript",
  "version": "5.4.0",
  "runtime": "node-v22.0.0",
  "timestamp": "2026-02-26T12:00:00Z",
  "scenarios": [
    {
      "name": "trust_check",
      "iterations": 100000,
      "ops_per_sec": 4250000,
      "mean_ns": 235,
      "stdev_ns": 12
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `language` | string | One of `typescript`, `python`, `go`, `rust` |
| `version` | string | Language/compiler version |
| `runtime` | string | Runtime identifier (Node version, CPython version, etc.) |
| `timestamp` | ISO 8601 | When the benchmark ran |
| `scenarios[].name` | string | Scenario identifier (snake_case) |
| `scenarios[].iterations` | integer | Total iterations completed |
| `scenarios[].ops_per_sec` | integer | Operations per second (rounded) |
| `scenarios[].mean_ns` | integer | Mean nanoseconds per operation |
| `scenarios[].stdev_ns` | integer | Standard deviation in nanoseconds |

Scenario `name` values are fixed:

```
trust_check
budget_enforcement
full_evaluation
audit_log
conformance_vectors
```

---

## Interpreting Results

- **ops/sec** is the primary metric. Higher is better.
- **mean_ns** is provided for readability. Lower is better.
- Compile-to-native languages (Go, Rust) will have higher ops/sec than
  interpreted languages (TypeScript, Python). Cross-language comparison is
  useful for understanding the relative cost within each ecosystem.
- The **conformance_vectors** scenario does not measure throughput — it
  validates correctness. All four languages must pass identical test vectors
  or the suite fails.

---

## Adding a New Language

1. Create `benchmarks/<language>/` directory
2. Implement all five scenarios
3. Output JSON matching the results format specification above
4. Add run instructions to this README
5. Update `compare.py` to read the new language's output file

---

Copyright (c) 2026 MuVeraAI Corporation
