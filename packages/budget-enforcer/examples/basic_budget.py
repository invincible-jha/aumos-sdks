# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
basic_budget.py

Demonstrates the minimal loop for budget-gated AI agent calls:
  1. Create an enforcer and one envelope.
  2. Check before spending.
  3. Record after the operation completes.
  4. Inspect utilization at the end.

Run with:  python examples/basic_budget.py
(from the python/ directory with budget-enforcer installed)
"""

from budget_enforcer import BudgetEnforcer, EnvelopeConfig, TransactionFilter

# ─── Setup ────────────────────────────────────────────────────────────────────

enforcer = BudgetEnforcer()
enforcer.create_envelope(EnvelopeConfig(category="llm-calls", limit=1.00, period="daily"))

# ─── Simulate a sequence of LLM calls ─────────────────────────────────────────

call_costs = [0.02, 0.05, 0.03, 0.08, 0.50, 0.40, 0.10]

for call_number, cost in enumerate(call_costs, start=1):
    check_result = enforcer.check("llm-calls", cost)

    if not check_result.permitted:
        print(
            f"Call {call_number}: DENIED  ${cost:.4f}  "
            f"reason={check_result.reason}  available=${check_result.available:.4f}"
        )
        continue

    # Simulate the LLM call here — stub.
    _response = f"[LLM response for call {call_number}]"

    enforcer.record("llm-calls", cost, description=f"Simulated call {call_number}")
    utilization = enforcer.utilization("llm-calls")
    print(
        f"Call {call_number}: RECORDED ${cost:.4f}  "
        f"available_after=${utilization.available:.4f}"
    )

# ─── Final utilization snapshot ───────────────────────────────────────────────

utilization = enforcer.utilization("llm-calls")

print("\n── Budget summary ────────────────────────────────────")
print(f"  Category    : {utilization.category}")
print(f"  Period      : {utilization.period}")
print(f"  Limit       : ${utilization.limit:.2f}")
print(f"  Spent       : ${utilization.spent:.4f}")
print(f"  Committed   : ${utilization.committed:.4f}")
print(f"  Available   : ${utilization.available:.4f}")
print(f"  Utilization : {utilization.utilization_percent:.1f}%")
print("──────────────────────────────────────────────────────")

# ─── Transaction log ──────────────────────────────────────────────────────────

transactions = enforcer.get_transactions(TransactionFilter(category="llm-calls"))
print(f"\n{len(transactions)} transactions recorded:")
for transaction in transactions:
    print(
        f"  [{transaction.id[:8]}] ${transaction.amount:.4f}  "
        f"{transaction.description or ''}"
    )
