# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
basic_trust.py

Demonstrates the fundamental TrustLadder API: manually assigning trust levels,
checking permissions, and revoking assignments.

Run with:
    python examples/basic_trust.py
"""

from __future__ import annotations

import sys
import os

# Allow running from the examples directory without installation
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python", "src"))

from trust_ladder import (
    TrustLadder,
    TrustLevel,
    trust_level_description,
    trust_level_name,
)

# ---------------------------------------------------------------------------
# 1. Create a ladder with decay disabled (the default)
# ---------------------------------------------------------------------------

ladder = TrustLadder()

print("=== AumOS Trust Ladder — Basic Example ===\n")

# ---------------------------------------------------------------------------
# 2. Assign trust levels manually (the ONLY way levels change)
# ---------------------------------------------------------------------------

ladder.assign(
    "agent-alpha",
    TrustLevel.SUGGEST,
    scope="content-review",
    reason="Cleared for content suggestion after onboarding review.",
    assigned_by="operator-jane",
)

ladder.assign(
    "agent-beta",
    TrustLevel.ACT_WITH_APPROVAL,
    scope="payments",
    reason="Approved for payment initiation with human sign-off required.",
    assigned_by="operator-john",
)

ladder.assign(
    "agent-gamma",
    TrustLevel.AUTONOMOUS,
    scope="internal-data",
    reason="Fully trusted for internal data operations within scope.",
    assigned_by="operator-jane",
)

# ---------------------------------------------------------------------------
# 3. Inspect effective levels
# ---------------------------------------------------------------------------

agent_scopes = {
    "agent-alpha": "content-review",
    "agent-beta": "payments",
    "agent-gamma": "internal-data",
}

print("Current effective trust levels:")
for agent_id, scope in agent_scopes.items():
    level = ladder.get_level(agent_id, scope)
    print(f"  {agent_id} ({scope}): L{level.value} — {trust_level_name(level.value)}")
    print(f"    {trust_level_description(level.value)}")

# ---------------------------------------------------------------------------
# 4. Permission checks
# ---------------------------------------------------------------------------

print("\nPermission checks:")

alpha_check = ladder.check("agent-alpha", TrustLevel.ACT_WITH_APPROVAL, "content-review")
status = "PERMITTED" if alpha_check.permitted else "DENIED"
print(f"  agent-alpha ACT_WITH_APPROVAL on content-review: {status}")
print(f"    effective={alpha_check.effective_level.value}, required={alpha_check.required_level.value}")

beta_check = ladder.check("agent-beta", TrustLevel.SUGGEST, "payments")
print(f"  agent-beta SUGGEST on payments: {'PERMITTED' if beta_check.permitted else 'DENIED'}")

gamma_check = ladder.check("agent-gamma", TrustLevel.AUTONOMOUS, "internal-data")
print(f"  agent-gamma AUTONOMOUS on internal-data: {'PERMITTED' if gamma_check.permitted else 'DENIED'}")

# ---------------------------------------------------------------------------
# 5. Scope isolation — check for a scope without an assignment
# ---------------------------------------------------------------------------

print("\nScope isolation:")
unknown_scope = ladder.check("agent-alpha", TrustLevel.OBSERVER, "payments")
status = "PERMITTED" if unknown_scope.permitted else "DENIED"
print(f"  agent-alpha OBSERVER on payments (no assignment): {status}")
print(f"  effective level for unassigned scope: L{unknown_scope.effective_level.value}")

# ---------------------------------------------------------------------------
# 6. Upgrade trust (re-assign to a higher level)
# ---------------------------------------------------------------------------

print("\nUpgrading agent-alpha to ACT_AND_REPORT on content-review...")
ladder.assign(
    "agent-alpha",
    TrustLevel.ACT_AND_REPORT,
    scope="content-review",
    reason="Demonstrated reliable suggestions over 30-day evaluation window.",
    assigned_by="operator-john",
)

alpha_upgraded = ladder.get_level("agent-alpha", "content-review")
print(f"  agent-alpha now: L{alpha_upgraded.value} — {trust_level_name(alpha_upgraded.value)}")

# ---------------------------------------------------------------------------
# 7. Assignment history
# ---------------------------------------------------------------------------

print("\nChange history for agent-alpha (content-review):")
history = ladder.get_history("agent-alpha", "content-review")
for record in history:
    from_level = f"L{record.previous_level.value}" if record.previous_level is not None else "none"
    print(f"  {from_level} -> L{record.new_level.value} ({record.change_kind})")
    if record.reason:
        print(f"    reason: {record.reason}")

# ---------------------------------------------------------------------------
# 8. Revoke an assignment
# ---------------------------------------------------------------------------

print("\nRevoking agent-beta from payments scope...")
ladder.revoke("agent-beta", "payments")

beta_after_revoke = ladder.get_level("agent-beta", "payments")
print(f"  agent-beta effective level after revocation: L{beta_after_revoke.value}")

# ---------------------------------------------------------------------------
# 9. List all remaining assignments
# ---------------------------------------------------------------------------

print("\nAll current assignments:")
for assignment in ladder.list_assignments():
    print(
        f"  {assignment.agent_id} ({assignment.scope}): "
        f"L{assignment.assigned_level.value} — {trust_level_name(assignment.assigned_level.value)}"
    )

print("\nDone.")
