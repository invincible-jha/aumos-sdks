// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * Trust level audit report generator.
 *
 * Produces structured audit reports from a list of TrustAssignment records,
 * including summary statistics, level distributions, time-at-level metrics,
 * and change history timelines. All data is read-only — this module does not
 * modify assignments or perform any automatic trust changes.
 *
 * @module @aumos/trust-ladder/audit-report
 */

import type { TrustAssignment } from "./types.js";
import type { TrustLevelValue } from "./levels.js";
import { TRUST_LEVEL_NAMES } from "./levels.js";

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

/** Count of agents at a specific trust level. */
export interface LevelDistribution {
  readonly level: TrustLevelValue;
  readonly levelName: string;
  readonly count: number;
  readonly percentage: number;
}

/** Time-at-level metric for a single agent-scope assignment. */
export interface TimeAtLevelMetric {
  readonly agentId: string;
  readonly scope: string;
  readonly assignedLevel: TrustLevelValue;
  readonly assignedAtIso: string;
  readonly durationSeconds: number;
}

/** A single entry in the chronological assignment timeline. */
export interface AssignmentEntry {
  readonly agentId: string;
  readonly scope: string;
  readonly assignedLevel: TrustLevelValue;
  readonly levelName: string;
  readonly assignedAtIso: string;
  readonly reason?: string;
  readonly assignedBy?: string;
}

/** High-level summary statistics for the audit report. */
export interface ReportSummary {
  readonly totalAssignments: number;
  readonly uniqueAgents: number;
  readonly uniqueScopes: number;
  readonly highestLevelAssigned: TrustLevelValue;
  readonly lowestLevelAssigned: TrustLevelValue;
  readonly generatedAtIso: string;
}

/**
 * Complete trust audit report.
 *
 * Contains summary statistics, level distribution, time-at-level metrics,
 * and a chronological assignment timeline.
 */
export interface TrustAuditReport {
  readonly summary: ReportSummary;
  readonly levelDistribution: readonly LevelDistribution[];
  readonly timeAtLevel: readonly TimeAtLevelMetric[];
  readonly assignmentTimeline: readonly AssignmentEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msToIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function trustLevelNameSafe(level: TrustLevelValue): string {
  return TRUST_LEVEL_NAMES[level] ?? `UNKNOWN_${String(level)}`;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

/**
 * Generate a structured trust audit report from a list of trust assignments.
 *
 * This function is purely analytical — it reads assignment data and produces
 * a report. It does not modify any assignments or trigger trust changes.
 *
 * @param assignments - List of TrustAssignment records to analyse.
 * @param nowMs - Optional current time in ms since Unix epoch.
 *                Defaults to the actual current wall-clock time.
 * @returns A TrustAuditReport containing summary, distribution, time metrics,
 *          and a chronological assignment timeline.
 */
export function generateTrustAuditReport(
  assignments: readonly TrustAssignment[],
  nowMs?: number,
): TrustAuditReport {
  const now = nowMs ?? Date.now();
  const generatedAtIso = msToIso(now);

  // --- Summary ---
  const uniqueAgents = new Set<string>();
  const uniqueScopes = new Set<string>();
  const levelCounts = new Map<TrustLevelValue, number>();

  for (const assignment of assignments) {
    uniqueAgents.add(assignment.agentId);
    uniqueScopes.add(assignment.scope);
    const current = levelCounts.get(assignment.assignedLevel) ?? 0;
    levelCounts.set(assignment.assignedLevel, current + 1);
  }

  let highestLevel: TrustLevelValue = 0 as TrustLevelValue;
  let lowestLevel: TrustLevelValue = 0 as TrustLevelValue;

  if (assignments.length > 0) {
    const levels = Array.from(levelCounts.keys());
    highestLevel = Math.max(...levels) as TrustLevelValue;
    lowestLevel = Math.min(...levels) as TrustLevelValue;
  }

  const summary: ReportSummary = {
    totalAssignments: assignments.length,
    uniqueAgents: uniqueAgents.size,
    uniqueScopes: uniqueScopes.size,
    highestLevelAssigned: highestLevel,
    lowestLevelAssigned: lowestLevel,
    generatedAtIso,
  };

  // --- Level distribution ---
  const total = assignments.length || 1; // avoid division by zero
  const levelDistribution: LevelDistribution[] = [];
  for (let level = 0; level <= 5; level++) {
    const typedLevel = level as TrustLevelValue;
    const count = levelCounts.get(typedLevel) ?? 0;
    const percentage =
      assignments.length > 0
        ? Math.round((count / total) * 10000) / 100
        : 0;
    levelDistribution.push({
      level: typedLevel,
      levelName: trustLevelNameSafe(typedLevel),
      count,
      percentage,
    });
  }

  // --- Time at level ---
  const timeAtLevel: TimeAtLevelMetric[] = assignments.map((assignment) => {
    const durationMs = Math.max(0, now - assignment.assignedAt);
    const durationSeconds = Math.floor(durationMs / 1000);
    return {
      agentId: assignment.agentId,
      scope: assignment.scope,
      assignedLevel: assignment.assignedLevel,
      assignedAtIso: msToIso(assignment.assignedAt),
      durationSeconds,
    };
  });

  // --- Assignment timeline (chronological) ---
  const sorted = [...assignments].sort((a, b) => a.assignedAt - b.assignedAt);
  const assignmentTimeline: AssignmentEntry[] = sorted.map((assignment) => ({
    agentId: assignment.agentId,
    scope: assignment.scope,
    assignedLevel: assignment.assignedLevel,
    levelName: trustLevelNameSafe(assignment.assignedLevel),
    assignedAtIso: msToIso(assignment.assignedAt),
    reason: assignment.reason,
    assignedBy: assignment.assignedBy,
  }));

  return {
    summary,
    levelDistribution,
    timeAtLevel,
    assignmentTimeline,
  };
}

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

/**
 * Export a TrustAuditReport to a JSON string with 2-space indentation.
 */
export function exportReportJson(report: TrustAuditReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Export a TrustAuditReport to a human-readable Markdown string.
 */
export function exportReportMarkdown(report: TrustAuditReport): string {
  const lines: string[] = [];

  lines.push("# Trust Audit Report");
  lines.push("");
  lines.push(`**Generated:** ${report.summary.generatedAtIso}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total assignments:** ${String(report.summary.totalAssignments)}`);
  lines.push(`- **Unique agents:** ${String(report.summary.uniqueAgents)}`);
  lines.push(`- **Unique scopes:** ${String(report.summary.uniqueScopes)}`);
  lines.push(
    `- **Highest level assigned:** L${String(report.summary.highestLevelAssigned)}`,
  );
  lines.push(
    `- **Lowest level assigned:** L${String(report.summary.lowestLevelAssigned)}`,
  );
  lines.push("");

  // Level distribution
  lines.push("## Level Distribution");
  lines.push("");
  lines.push("| Level | Name | Count | Percentage |");
  lines.push("|------:|------|------:|-----------:|");
  for (const dist of report.levelDistribution) {
    lines.push(
      `| L${String(dist.level)} | ${dist.levelName} | ${String(dist.count)} | ${String(dist.percentage)}% |`,
    );
  }
  lines.push("");

  // Time at level
  lines.push("## Time at Level");
  lines.push("");
  lines.push("| Agent | Scope | Level | Assigned At | Duration (s) |");
  lines.push("|-------|-------|------:|-------------|-------------:|");
  for (const metric of report.timeAtLevel) {
    lines.push(
      `| ${metric.agentId} | ${metric.scope} | L${String(metric.assignedLevel)} | ${metric.assignedAtIso} | ${String(metric.durationSeconds)} |`,
    );
  }
  lines.push("");

  // Timeline
  lines.push("## Assignment Timeline");
  lines.push("");
  for (const entry of report.assignmentTimeline) {
    const byText = entry.assignedBy ? ` by ${entry.assignedBy}` : "";
    const reasonText = entry.reason ? ` — ${entry.reason}` : "";
    lines.push(
      `- **${entry.assignedAtIso}** — \`${entry.agentId}\` assigned L${String(entry.assignedLevel)} (${entry.levelName}) in scope \`${entry.scope}\`${byText}${reasonText}`,
    );
  }
  lines.push("");

  return lines.join("\n");
}
