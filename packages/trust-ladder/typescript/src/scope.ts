// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { TrustAssignment, TrustChangeRecord } from "./types.js";

/**
 * Query helpers for inspecting assignments and history across multiple scopes.
 *
 * These are pure functions operating over read-only collections — they do not
 * mutate any state. The TrustLadder class owns the AssignmentStore and passes
 * snapshot data into these helpers as needed.
 */

/**
 * Filter a list of assignments to those belonging to a specific agentId.
 * Returns a new array; does not mutate the input.
 */
export function assignmentsForAgent(
  allAssignments: readonly TrustAssignment[],
  agentId: string
): readonly TrustAssignment[] {
  return allAssignments.filter((a) => a.agentId === agentId);
}

/**
 * Filter a list of assignments to those belonging to a specific scope.
 * Returns a new array; does not mutate the input.
 */
export function assignmentsForScope(
  allAssignments: readonly TrustAssignment[],
  scope: string
): readonly TrustAssignment[] {
  return allAssignments.filter((a) => a.scope === scope);
}

/**
 * Return all unique scope strings present in a list of assignments.
 */
export function distinctScopes(
  allAssignments: readonly TrustAssignment[]
): readonly string[] {
  const seen = new Set<string>();
  for (const assignment of allAssignments) {
    seen.add(assignment.scope);
  }
  return Array.from(seen);
}

/**
 * Return all unique agentIds present in a list of assignments.
 */
export function distinctAgentIds(
  allAssignments: readonly TrustAssignment[]
): readonly string[] {
  const seen = new Set<string>();
  for (const assignment of allAssignments) {
    seen.add(assignment.agentId);
  }
  return Array.from(seen);
}

/**
 * Summarise the highest assigned level held by any agent per scope.
 * Returns a Map from scope string to the maximum assignedLevel in that scope.
 *
 * Note: these are the raw assigned levels, not effective (post-decay) levels.
 * For effective levels, callers should invoke TrustLadder.getLevel() per entry.
 */
export function maxLevelPerScope(
  allAssignments: readonly TrustAssignment[]
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const assignment of allAssignments) {
    const current = result.get(assignment.scope) ?? -1;
    if (assignment.assignedLevel > current) {
      result.set(assignment.scope, assignment.assignedLevel);
    }
  }
  return result;
}

/**
 * Filter a history log to entries within a given time window.
 * startMs and endMs are inclusive bounds (ms since Unix epoch).
 */
export function historyInWindow(
  history: readonly TrustChangeRecord[],
  startMs: number,
  endMs: number
): readonly TrustChangeRecord[] {
  return history.filter((r) => r.changedAt >= startMs && r.changedAt <= endMs);
}

/**
 * Filter a history log to entries of a specific change kind.
 */
export function historyByKind(
  history: readonly TrustChangeRecord[],
  kind: TrustChangeRecord["changeKind"]
): readonly TrustChangeRecord[] {
  return history.filter((r) => r.changeKind === kind);
}
