# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
AumOS cross-language benchmark comparison script.

Reads JSON output from all four language benchmarks, then produces:
  - Markdown comparison table (ops/sec per language per scenario)
  - Chart-ready JSON for plotting
  - CI threshold checks (exits non-zero on >10% regression)

Usage::

    # Generate report
    python compare.py --results-dir results/ --output report.md

    # CI mode — compare against baseline, fail on >10% regression
    python compare.py --results-dir results/ --baseline baseline/ --ci
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# ─── Data model ──────────────────────────────────────────────────────────────

KNOWN_SCENARIOS: list[str] = [
    "trust_check",
    "budget_enforcement",
    "full_evaluation",
    "audit_log",
    "conformance_vectors",
]

KNOWN_LANGUAGES: list[str] = ["typescript", "python", "go", "rust"]

REGRESSION_THRESHOLD: float = 0.10  # 10% regression triggers CI failure


@dataclass(frozen=True)
class ScenarioResult:
    name: str
    iterations: int
    ops_per_sec: int
    mean_ns: int
    stdev_ns: int


@dataclass(frozen=True)
class LanguageReport:
    language: str
    version: str
    runtime: str
    timestamp: str
    scenarios: list[ScenarioResult]

    def scenario_map(self) -> dict[str, ScenarioResult]:
        return {s.name: s for s in self.scenarios}


@dataclass
class ComparisonReport:
    results: list[LanguageReport]
    baseline: Optional[list[LanguageReport]] = field(default=None)

    def languages(self) -> list[str]:
        return [r.language for r in self.results]

    def scenarios(self) -> list[str]:
        all_names: set[str] = set()
        for report in self.results:
            for scenario in report.scenarios:
                all_names.add(scenario.name)
        # Return in canonical order, unknown names appended alphabetically
        ordered = [s for s in KNOWN_SCENARIOS if s in all_names]
        extras = sorted(all_names - set(KNOWN_SCENARIOS))
        return ordered + extras


# ─── I/O helpers ─────────────────────────────────────────────────────────────


def load_report(path: Path) -> LanguageReport:
    """Load a single language's JSON benchmark results file."""
    with path.open(encoding="utf-8") as file_handle:
        raw: dict[str, object] = json.load(file_handle)

    scenarios = [
        ScenarioResult(
            name=str(item["name"]),
            iterations=int(item["iterations"]),
            ops_per_sec=int(item["ops_per_sec"]),
            mean_ns=int(item["mean_ns"]),
            stdev_ns=int(item.get("stdev_ns", 0)),
        )
        for item in raw.get("scenarios", [])  # type: ignore[union-attr]
    ]

    return LanguageReport(
        language=str(raw.get("language", path.stem)),
        version=str(raw.get("version", "unknown")),
        runtime=str(raw.get("runtime", "unknown")),
        timestamp=str(raw.get("timestamp", "")),
        scenarios=scenarios,
    )


def load_results_dir(results_dir: Path) -> list[LanguageReport]:
    """Load all *.json files from a results directory."""
    reports: list[LanguageReport] = []
    for json_file in sorted(results_dir.glob("*.json")):
        try:
            reports.append(load_report(json_file))
        except (KeyError, TypeError, ValueError) as exc:
            print(f"Warning: could not parse {json_file}: {exc}", file=sys.stderr)
    return reports


# ─── Markdown table ───────────────────────────────────────────────────────────


def _format_ops(ops: int) -> str:
    """Format ops/sec with thousands separator."""
    if ops >= 1_000_000:
        return f"{ops / 1_000_000:.2f}M"
    if ops >= 1_000:
        return f"{ops / 1_000:.1f}K"
    return str(ops)


def render_markdown_table(comparison: ComparisonReport) -> str:
    """Render a Markdown ops/sec table with the fastest language bolded."""
    languages = comparison.languages()
    scenarios = comparison.scenarios()

    # Build lookup: scenario -> language -> ops_per_sec
    table: dict[str, dict[str, int]] = {}
    for report in comparison.results:
        scenario_map = report.scenario_map()
        for scenario_name in scenarios:
            if scenario_name not in table:
                table[scenario_name] = {}
            if scenario_name in scenario_map:
                table[scenario_name][report.language] = scenario_map[scenario_name].ops_per_sec

    lines: list[str] = []
    lines.append("## Benchmark Results — ops/sec (higher is better)\n")

    # Header
    header = "| Scenario | " + " | ".join(lang.capitalize() for lang in languages) + " |"
    separator = "|" + "---|" * (len(languages) + 1)
    lines.append(header)
    lines.append(separator)

    for scenario_name in scenarios:
        row_data = table.get(scenario_name, {})
        max_ops = max(row_data.values(), default=0)

        cells: list[str] = [f"`{scenario_name}`"]
        for language in languages:
            ops = row_data.get(language)
            if ops is None:
                cells.append("—")
            elif ops == max_ops and max_ops > 0:
                cells.append(f"**{_format_ops(ops)}**")
            else:
                cells.append(_format_ops(ops))

        lines.append("| " + " | ".join(cells) + " |")

    # Per-scenario winner summary
    lines.append("\n### Fastest by Scenario\n")
    for scenario_name in scenarios:
        row_data = table.get(scenario_name, {})
        if not row_data:
            continue
        fastest_language = max(row_data, key=lambda lang: row_data[lang])
        fastest_ops = row_data[fastest_language]
        lines.append(f"- **{scenario_name}**: {fastest_language} ({_format_ops(fastest_ops)} ops/sec)")

    return "\n".join(lines)


# ─── Chart-ready JSON ─────────────────────────────────────────────────────────


def render_chart_json(comparison: ComparisonReport) -> dict[str, object]:
    """
    Produce a chart-ready JSON structure.

    Format::

        {
          "scenarios": ["trust_check", ...],
          "series": [
            {"language": "typescript", "ops_per_sec": [4250000, ...]},
            ...
          ]
        }
    """
    scenarios = comparison.scenarios()
    series: list[dict[str, object]] = []

    for report in comparison.results:
        scenario_map = report.scenario_map()
        ops_values = [
            scenario_map[name].ops_per_sec if name in scenario_map else 0
            for name in scenarios
        ]
        series.append(
            {
                "language": report.language,
                "version": report.version,
                "ops_per_sec": ops_values,
                "mean_ns": [
                    scenario_map[name].mean_ns if name in scenario_map else 0
                    for name in scenarios
                ],
            }
        )

    return {"scenarios": scenarios, "series": series}


# ─── CI regression check ──────────────────────────────────────────────────────


def check_regressions(
    current: list[LanguageReport],
    baseline: list[LanguageReport],
    threshold: float = REGRESSION_THRESHOLD,
) -> list[str]:
    """
    Compare current results against baseline.

    Returns a list of regression messages. If the list is empty, all checks
    passed. Each message describes the language, scenario, and regression %.
    """
    baseline_map: dict[str, dict[str, ScenarioResult]] = {}
    for report in baseline:
        baseline_map[report.language] = report.scenario_map()

    regressions: list[str] = []

    for report in current:
        baseline_scenarios = baseline_map.get(report.language)
        if baseline_scenarios is None:
            continue  # No baseline for this language — skip

        for scenario in report.scenarios:
            baseline_scenario = baseline_scenarios.get(scenario.name)
            if baseline_scenario is None:
                continue  # No baseline for this scenario — skip

            if baseline_scenario.ops_per_sec == 0:
                continue

            regression_fraction = (
                baseline_scenario.ops_per_sec - scenario.ops_per_sec
            ) / baseline_scenario.ops_per_sec

            if regression_fraction > threshold:
                regressions.append(
                    f"REGRESSION [{report.language}/{scenario.name}]: "
                    f"{scenario.ops_per_sec:,} ops/sec vs baseline "
                    f"{baseline_scenario.ops_per_sec:,} ops/sec "
                    f"({regression_fraction * 100:.1f}% slower)"
                )

    return regressions


# ─── Main entry point ─────────────────────────────────────────────────────────


def compare_results(
    results_dir: str,
    baseline_dir: Optional[str] = None,
    output_path: Optional[str] = None,
    ci_mode: bool = False,
) -> ComparisonReport:
    """
    Load benchmark results and generate comparison artifacts.

    Args:
        results_dir:  Directory containing *.json result files.
        baseline_dir: Optional directory containing baseline *.json files.
                      Required for CI regression checks.
        output_path:  Write the Markdown report to this file.
                      Defaults to stdout if None.
        ci_mode:      Exit non-zero if any language regresses >10% from baseline.

    Returns:
        The ComparisonReport data structure (useful for programmatic access).
    """
    results = load_results_dir(Path(results_dir))
    if not results:
        print(f"Error: no result files found in {results_dir}", file=sys.stderr)
        if ci_mode:
            sys.exit(1)
        return ComparisonReport(results=[])

    baseline_reports: Optional[list[LanguageReport]] = None
    if baseline_dir is not None:
        baseline_reports = load_results_dir(Path(baseline_dir))

    comparison = ComparisonReport(results=results, baseline=baseline_reports)

    # Markdown report
    markdown_content = render_markdown_table(comparison)
    if output_path:
        Path(output_path).write_text(markdown_content + "\n", encoding="utf-8")
        print(f"Report written to {output_path}", file=sys.stderr)
    else:
        print(markdown_content)

    # Chart JSON — written alongside the markdown output
    chart_data = render_chart_json(comparison)
    chart_path = (
        str(Path(output_path).with_suffix(".chart.json"))
        if output_path
        else None
    )
    if chart_path:
        Path(chart_path).write_text(
            json.dumps(chart_data, indent=2) + "\n", encoding="utf-8"
        )
        print(f"Chart JSON written to {chart_path}", file=sys.stderr)

    # CI regression checks
    if ci_mode:
        if baseline_reports is None:
            print(
                "Error: --ci requires --baseline to be specified", file=sys.stderr
            )
            sys.exit(1)

        regressions = check_regressions(results, baseline_reports)
        if regressions:
            print("\nCI FAILURE — regressions detected:\n", file=sys.stderr)
            for message in regressions:
                print(f"  {message}", file=sys.stderr)
            sys.exit(1)
        else:
            print("CI PASS — no regressions detected.", file=sys.stderr)

    return comparison


def _build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Compare AumOS cross-language benchmark results."
    )
    parser.add_argument(
        "--results-dir",
        required=True,
        help="Directory containing *.json result files from each language.",
    )
    parser.add_argument(
        "--baseline",
        default=None,
        help="Directory containing baseline *.json files for regression comparison.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Write Markdown report to this file path (default: stdout).",
    )
    parser.add_argument(
        "--ci",
        action="store_true",
        help="CI mode: exit non-zero if any language regresses >10%% from baseline.",
    )
    return parser


if __name__ == "__main__":
    argument_parser = _build_argument_parser()
    arguments = argument_parser.parse_args()

    compare_results(
        results_dir=arguments.results_dir,
        baseline_dir=arguments.baseline,
        output_path=arguments.output,
        ci_mode=arguments.ci,
    )
