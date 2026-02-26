// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * decay_demo.ts
 *
 * Demonstrates cliff decay and gradual decay mechanics by simulating time
 * advancement using the DecayEngine directly with explicit timestamps.
 *
 * Run with:
 *   npx tsx examples/decay_demo.ts
 */

import {
  DecayEngine,
  computeEffectiveLevel,
  timeUntilNextDecay,
  TRUST_LEVELS,
  trustLevelName,
} from "../typescript/src/index.js";
import type { TrustAssignment } from "../typescript/src/index.js";

console.log("=== AumOS Trust Ladder — Decay Demo ===\n");

const BASE_TIME = 1_700_000_000_000; // arbitrary fixed epoch for demo

// ---------------------------------------------------------------------------
// 1. Cliff decay
// ---------------------------------------------------------------------------

console.log("--- Cliff Decay (ttlMs = 60_000) ---\n");

const cliffEngine = new DecayEngine({
  enabled: true,
  type: "cliff",
  ttlMs: 60_000,
});

const cliffAssignment: TrustAssignment = {
  agentId: "agent-cliff",
  scope: "ops",
  assignedLevel: TRUST_LEVELS.ACT_AND_REPORT,
  assignedAt: BASE_TIME,
  reason: "Temporary elevated access for ops task.",
  assignedBy: "operator-jane",
};

const cliffCheckpoints = [0, 30_000, 59_999, 60_000, 90_000];

for (const offsetMs of cliffCheckpoints) {
  const nowMs = BASE_TIME + offsetMs;
  const result = cliffEngine.compute(cliffAssignment, nowMs);
  const nextDecay = timeUntilNextDecay(cliffAssignment, { enabled: true, type: "cliff", ttlMs: 60_000 }, nowMs);
  console.log(
    `  t+${String(offsetMs).padStart(6, " ")}ms → L${result.effectiveLevel} ` +
    `(${trustLevelName(result.effectiveLevel)})` +
    (nextDecay !== null ? `, next decay in ${nextDecay}ms` : ", at floor")
  );
}

// ---------------------------------------------------------------------------
// 2. Gradual decay
// ---------------------------------------------------------------------------

console.log("\n--- Gradual Decay (stepIntervalMs = 3_600_000) ---\n");

const gradualEngine = new DecayEngine({
  enabled: true,
  type: "gradual",
  stepIntervalMs: 3_600_000, // 1 hour
});

const gradualAssignment: TrustAssignment = {
  agentId: "agent-gradual",
  scope: "analytics",
  assignedLevel: TRUST_LEVELS.AUTONOMOUS, // L5
  assignedAt: BASE_TIME,
  reason: "Full access for analytics pipeline run.",
  assignedBy: "operator-john",
};

const gradualCheckpoints = [
  0,
  3_600_000,       // 1h  — L5 -> L4
  7_200_000,       // 2h  — L4 -> L3
  10_800_000,      // 3h  — L3 -> L2
  14_400_000,      // 4h  — L2 -> L1
  18_000_000,      // 5h  — L1 -> L0
  21_600_000,      // 6h  — stays L0 (floor)
];

for (const offsetMs of gradualCheckpoints) {
  const nowMs = BASE_TIME + offsetMs;
  const result = gradualEngine.compute(gradualAssignment, nowMs);
  const hours = offsetMs / 3_600_000;
  console.log(
    `  t+${String(hours).padStart(2, " ")}h → L${result.effectiveLevel} ` +
    `(${trustLevelName(result.effectiveLevel)})` +
    (result.decayedToFloor ? " [at floor]" : "")
  );
}

// ---------------------------------------------------------------------------
// 3. Partial gradual decay — starting from a mid-level
// ---------------------------------------------------------------------------

console.log("\n--- Gradual Decay from L3 (ACT_WITH_APPROVAL, stepIntervalMs = 1_800_000) ---\n");

const midLevelAssignment: TrustAssignment = {
  agentId: "agent-mid",
  scope: "review",
  assignedLevel: TRUST_LEVELS.ACT_WITH_APPROVAL, // L3
  assignedAt: BASE_TIME,
  reason: "Provisional approval for review workflow.",
};

const midConfig = { enabled: true as const, type: "gradual" as const, stepIntervalMs: 1_800_000 };

const midCheckpoints = [0, 1_800_000, 3_600_000, 5_400_000, 7_200_000];
for (const offsetMs of midCheckpoints) {
  const nowMs = BASE_TIME + offsetMs;
  const effective = computeEffectiveLevel(midLevelAssignment, midConfig, nowMs);
  const nextDecay = timeUntilNextDecay(midLevelAssignment, midConfig, nowMs);
  const mins = offsetMs / 60_000;
  console.log(
    `  t+${String(mins).padStart(3, " ")}min → L${effective} (${trustLevelName(effective)})` +
    (nextDecay !== null ? `, next step in ${nextDecay / 60_000}min` : " [at floor]")
  );
}

// ---------------------------------------------------------------------------
// 4. No decay (decay disabled)
// ---------------------------------------------------------------------------

console.log("\n--- No Decay (enabled: false) ---\n");

const noDecayEngine = new DecayEngine({ enabled: false });

const permanentAssignment: TrustAssignment = {
  agentId: "agent-permanent",
  scope: "archive",
  assignedLevel: TRUST_LEVELS.MONITOR,
  assignedAt: BASE_TIME,
};

const farFuture = BASE_TIME + 365 * 24 * 3_600_000; // 1 year later
const noDecayResult = noDecayEngine.compute(permanentAssignment, farFuture);
console.log(
  `  1 year later → L${noDecayResult.effectiveLevel} (${trustLevelName(noDecayResult.effectiveLevel)}) — unchanged`
);

console.log("\nDone.");
