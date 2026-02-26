// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * basic_trust.ts
 *
 * Demonstrates the fundamental TrustLadder API: manually assigning trust
 * levels, checking permissions, and revoking assignments.
 *
 * Run with:
 *   npx tsx examples/basic_trust.ts
 */

import {
  TrustLadder,
  TRUST_LEVELS,
  trustLevelName,
  trustLevelDescription,
} from "../typescript/src/index.js";

// ---------------------------------------------------------------------------
// 1. Create a ladder with decay disabled (the default)
// ---------------------------------------------------------------------------

const ladder = new TrustLadder({ decay: { enabled: false } });

console.log("=== AumOS Trust Ladder — Basic Example ===\n");

// ---------------------------------------------------------------------------
// 2. Assign trust levels manually (the ONLY way levels change)
// ---------------------------------------------------------------------------

ladder.assign("agent-alpha", TRUST_LEVELS.SUGGEST, "content-review", {
  reason: "Cleared for content suggestion after onboarding review.",
  assignedBy: "operator-jane",
});

ladder.assign("agent-beta", TRUST_LEVELS.ACT_WITH_APPROVAL, "payments", {
  reason: "Approved for payment initiation with human sign-off required.",
  assignedBy: "operator-john",
});

ladder.assign("agent-gamma", TRUST_LEVELS.AUTONOMOUS, "internal-data", {
  reason: "Fully trusted for internal data operations within scope.",
  assignedBy: "operator-jane",
});

// ---------------------------------------------------------------------------
// 3. Inspect effective levels
// ---------------------------------------------------------------------------

const agents = ["agent-alpha", "agent-beta", "agent-gamma"];
const scopes: Record<string, string> = {
  "agent-alpha": "content-review",
  "agent-beta": "payments",
  "agent-gamma": "internal-data",
};

console.log("Current effective trust levels:");
for (const agentId of agents) {
  const scope = scopes[agentId]!;
  const level = ladder.getLevel(agentId, scope);
  console.log(
    `  ${agentId} (${scope}): L${level} — ${trustLevelName(level)}`
  );
  console.log(`    ${trustLevelDescription(level)}`);
}

// ---------------------------------------------------------------------------
// 4. Permission checks
// ---------------------------------------------------------------------------

console.log("\nPermission checks:");

const alphaCheck = ladder.check("agent-alpha", TRUST_LEVELS.ACT_WITH_APPROVAL, "content-review");
console.log(
  `  agent-alpha ACT_WITH_APPROVAL on content-review: ${alphaCheck.permitted ? "PERMITTED" : "DENIED"}`
);
console.log(`    effective=${alphaCheck.effectiveLevel}, required=${alphaCheck.requiredLevel}`);

const betaCheck = ladder.check("agent-beta", TRUST_LEVELS.SUGGEST, "payments");
console.log(
  `  agent-beta SUGGEST on payments: ${betaCheck.permitted ? "PERMITTED" : "DENIED"}`
);

const gammaCheck = ladder.check("agent-gamma", TRUST_LEVELS.AUTONOMOUS, "internal-data");
console.log(
  `  agent-gamma AUTONOMOUS on internal-data: ${gammaCheck.permitted ? "PERMITTED" : "DENIED"}`
);

// ---------------------------------------------------------------------------
// 5. Scope isolation — check for a scope without an assignment
// ---------------------------------------------------------------------------

console.log("\nScope isolation:");
const unknownScope = ladder.check("agent-alpha", TRUST_LEVELS.OBSERVER, "payments");
console.log(
  `  agent-alpha OBSERVER on payments (no assignment): ${unknownScope.permitted ? "PERMITTED" : "DENIED"}`
);
console.log(`  effective level for unassigned scope: L${unknownScope.effectiveLevel}`);

// ---------------------------------------------------------------------------
// 6. Upgrade trust (re-assign to a higher level)
// ---------------------------------------------------------------------------

console.log("\nUpgrading agent-alpha to ACT_AND_REPORT on content-review...");
ladder.assign("agent-alpha", TRUST_LEVELS.ACT_AND_REPORT, "content-review", {
  reason: "Demonstrated reliable suggestions over 30-day evaluation window.",
  assignedBy: "operator-john",
});

const alphaUpgraded = ladder.getLevel("agent-alpha", "content-review");
console.log(
  `  agent-alpha now: L${alphaUpgraded} — ${trustLevelName(alphaUpgraded)}`
);

// ---------------------------------------------------------------------------
// 7. Assignment history
// ---------------------------------------------------------------------------

console.log("\nChange history for agent-alpha (content-review):");
const history = ladder.getHistory("agent-alpha", "content-review");
for (const record of history) {
  const from = record.previousLevel !== undefined ? `L${record.previousLevel}` : "none";
  console.log(
    `  [${new Date(record.changedAt).toISOString()}] ${from} -> L${record.newLevel} (${record.changeKind})`
  );
  if (record.reason) {
    console.log(`    reason: ${record.reason}`);
  }
}

// ---------------------------------------------------------------------------
// 8. Revoke an assignment
// ---------------------------------------------------------------------------

console.log("\nRevoking agent-beta from payments scope...");
ladder.revoke("agent-beta", "payments");

const betaAfterRevoke = ladder.getLevel("agent-beta", "payments");
console.log(`  agent-beta effective level after revocation: L${betaAfterRevoke}`);

// ---------------------------------------------------------------------------
// 9. List all remaining assignments
// ---------------------------------------------------------------------------

console.log("\nAll current assignments:");
const allAssignments = ladder.listAssignments();
for (const assignment of allAssignments) {
  console.log(
    `  ${assignment.agentId} (${assignment.scope}): L${assignment.assignedLevel} — ${trustLevelName(assignment.assignedLevel)}`
  );
}

console.log("\nDone.");
