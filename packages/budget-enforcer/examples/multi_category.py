# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
multi_category.py

Shows an agent with separate envelopes for different cost categories:
  - llm-inference  (daily)
  - web-search     (hourly)
  - storage-writes (monthly)

Also demonstrates commit/release for pre-authorising uncertain costs.

Run with:  python examples/multi_category.py
(from the python/ directory with budget-enforcer installed)
"""

from dataclasses import dataclass

from budget_enforcer import BudgetEnforcer, BudgetUtilization, EnvelopeConfig

# ─── Setup ────────────────────────────────────────────────────────────────────

enforcer = BudgetEnforcer()

enforcer.create_envelope(EnvelopeConfig(category="llm-inference", limit=2.00, period="daily"))
enforcer.create_envelope(EnvelopeConfig(category="web-search", limit=0.50, period="hourly"))
enforcer.create_envelope(EnvelopeConfig(category="storage-writes", limit=5.00, period="monthly"))

# ─── Helper ───────────────────────────────────────────────────────────────────


def print_utilization(utilization: BudgetUtilization) -> None:
    filled = round(utilization.utilization_percent / 5)
    bar = ("=" * filled).ljust(20, "-")
    print(
        f"  {utilization.category:<16} [{bar}] "
        f"{utilization.utilization_percent:>5.1f}%  "
        f"${utilization.spent:.4f} / ${utilization.limit:.2f}"
    )


# ─── Scenario: multi-step research task ──────────────────────────────────────


@dataclass(frozen=True)
class AgentStep:
    action: str
    category: str
    estimated_cost: float
    actual_cost: float


steps = [
    AgentStep("Plan research outline", "llm-inference", 0.10, 0.08),
    AgentStep("Search: market trends", "web-search", 0.05, 0.05),
    AgentStep("Search: competitor analysis", "web-search", 0.05, 0.05),
    AgentStep("Synthesise search results", "llm-inference", 0.40, 0.35),
    AgentStep("Write report draft", "llm-inference", 0.80, 0.90),
    AgentStep("Save draft to storage", "storage-writes", 0.02, 0.02),
    AgentStep("Revise and finalise", "llm-inference", 0.70, 0.65),
]

print("── Research agent: multi-category budget enforcement ──\n")

for step in steps:
    # Pre-authorise the estimated cost before starting the step.
    commit_result = enforcer.commit(step.category, step.estimated_cost)

    if not commit_result.permitted:
        print(
            f"BLOCKED  \"{step.action}\"  "
            f"[{step.category}] estimated=${step.estimated_cost:.4f}  "
            f"reason={commit_result.reason}"
        )
        continue

    # Step runs here. Release the commit and record actual cost.
    assert commit_result.commit_id is not None
    enforcer.release(commit_result.commit_id)
    tx = enforcer.record(step.category, step.actual_cost, description=step.action)

    print(
        f"OK       \"{step.action}\"  "
        f"[{step.category}] actual=${step.actual_cost:.4f}  "
        f"txId={tx.id[:8]}"
    )

# ─── Summary across all categories ───────────────────────────────────────────

print("\n── Budget utilization ────────────────────────────────")
for envelope in enforcer.list_envelopes():
    print_utilization(enforcer.utilization(envelope.category))
print("──────────────────────────────────────────────────────")

# ─── Per-category transaction counts ─────────────────────────────────────────

from budget_enforcer import TransactionFilter  # noqa: E402 (local import for clarity)

print("\n── Transactions per category ─────────────────────────")
for envelope in enforcer.list_envelopes():
    transactions = enforcer.get_transactions(TransactionFilter(category=envelope.category))
    total = sum(t.amount for t in transactions)
    print(f"  {envelope.category:<16} {len(transactions)} tx   total=${total:.4f}")
