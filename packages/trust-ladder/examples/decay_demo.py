# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation

"""
decay_demo.py

Demonstrates cliff decay and gradual decay mechanics by simulating time
advancement using the DecayEngine directly with explicit timestamps.

Run with:
    python examples/decay_demo.py
"""

from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python", "src"))

from trust_ladder import (
    TrustLevel,
    DecayEngine,
    CliffDecayConfig,
    GradualDecayConfig,
    NoDecayConfig,
    TrustAssignment,
    compute_effective_level,
    time_until_next_decay,
    trust_level_name,
)

print("=== AumOS Trust Ladder — Decay Demo ===\n")

BASE_TIME = 1_700_000_000_000  # arbitrary fixed epoch for demo (ms)

# ---------------------------------------------------------------------------
# 1. Cliff decay
# ---------------------------------------------------------------------------

print("--- Cliff Decay (ttl_ms = 60_000) ---\n")

cliff_config = CliffDecayConfig(ttl_ms=60_000)
cliff_engine = DecayEngine(cliff_config)

cliff_assignment = TrustAssignment(
    agent_id="agent-cliff",
    scope="ops",
    assigned_level=TrustLevel.ACT_AND_REPORT,
    assigned_at=BASE_TIME,
    reason="Temporary elevated access for ops task.",
    assigned_by="operator-jane",
)

cliff_checkpoints = [0, 30_000, 59_999, 60_000, 90_000]

for offset_ms in cliff_checkpoints:
    now_ms = BASE_TIME + offset_ms
    result = cliff_engine.compute(cliff_assignment, now_ms)
    next_decay = time_until_next_decay(cliff_assignment, cliff_config, now_ms)
    next_str = f", next decay in {next_decay}ms" if next_decay is not None else ", at floor"
    level = result.effective_level
    print(
        f"  t+{offset_ms:6d}ms -> L{level.value} ({trust_level_name(level.value)}){next_str}"
    )

# ---------------------------------------------------------------------------
# 2. Gradual decay
# ---------------------------------------------------------------------------

print("\n--- Gradual Decay (step_interval_ms = 3_600_000) ---\n")

gradual_config = GradualDecayConfig(step_interval_ms=3_600_000)
gradual_engine = DecayEngine(gradual_config)

gradual_assignment = TrustAssignment(
    agent_id="agent-gradual",
    scope="analytics",
    assigned_level=TrustLevel.AUTONOMOUS,  # L5
    assigned_at=BASE_TIME,
    reason="Full access for analytics pipeline run.",
    assigned_by="operator-john",
)

gradual_checkpoints = [
    0,
    3_600_000,    # 1h — L5 -> L4
    7_200_000,    # 2h — L4 -> L3
    10_800_000,   # 3h — L3 -> L2
    14_400_000,   # 4h — L2 -> L1
    18_000_000,   # 5h — L1 -> L0
    21_600_000,   # 6h — stays L0
]

for offset_ms in gradual_checkpoints:
    now_ms = BASE_TIME + offset_ms
    result = gradual_engine.compute(gradual_assignment, now_ms)
    hours = offset_ms / 3_600_000
    floor_str = " [at floor]" if result.decayed_to_floor else ""
    level = result.effective_level
    print(
        f"  t+{hours:4.1f}h -> L{level.value} ({trust_level_name(level.value)}){floor_str}"
    )

# ---------------------------------------------------------------------------
# 3. Partial gradual decay — starting from a mid-level
# ---------------------------------------------------------------------------

print("\n--- Gradual Decay from L3 (ACT_WITH_APPROVAL, step_interval_ms = 1_800_000) ---\n")

mid_config = GradualDecayConfig(step_interval_ms=1_800_000)

mid_assignment = TrustAssignment(
    agent_id="agent-mid",
    scope="review",
    assigned_level=TrustLevel.ACT_WITH_APPROVAL,  # L3
    assigned_at=BASE_TIME,
    reason="Provisional approval for review workflow.",
)

mid_checkpoints = [0, 1_800_000, 3_600_000, 5_400_000, 7_200_000]

for offset_ms in mid_checkpoints:
    now_ms = BASE_TIME + offset_ms
    effective = compute_effective_level(mid_assignment, mid_config, now_ms)
    next_decay = time_until_next_decay(mid_assignment, mid_config, now_ms)
    mins = offset_ms // 60_000
    next_str = (
        f", next step in {next_decay // 60_000}min"
        if next_decay is not None
        else " [at floor]"
    )
    print(
        f"  t+{mins:3d}min -> L{effective.value} ({trust_level_name(effective.value)}){next_str}"
    )

# ---------------------------------------------------------------------------
# 4. No decay (decay disabled)
# ---------------------------------------------------------------------------

print("\n--- No Decay (enabled: False) ---\n")

no_decay_config = NoDecayConfig()
no_decay_engine = DecayEngine(no_decay_config)

permanent_assignment = TrustAssignment(
    agent_id="agent-permanent",
    scope="archive",
    assigned_level=TrustLevel.MONITOR,
    assigned_at=BASE_TIME,
)

far_future = BASE_TIME + 365 * 24 * 3_600_000  # 1 year later
no_decay_result = no_decay_engine.compute(permanent_assignment, far_future)
level = no_decay_result.effective_level
print(
    f"  1 year later -> L{level.value} ({trust_level_name(level.value)}) — unchanged"
)

print("\nDone.")
