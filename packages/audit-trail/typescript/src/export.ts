// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

import type { AuditRecord, ExportFormat } from "./types.js";

// ---------------------------------------------------------------------------
// JSON export
// ---------------------------------------------------------------------------

/**
 * Serialise records to a JSON array string.
 * The output is human-readable with 2-space indentation.
 */
export function exportJson(records: AuditRecord[]): string {
  return JSON.stringify(records, null, 2);
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  "id",
  "timestamp",
  "agentId",
  "action",
  "permitted",
  "trustLevel",
  "requiredLevel",
  "budgetUsed",
  "budgetRemaining",
  "reason",
  "metadata",
  "previousHash",
  "recordHash",
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];

/**
 * Escape a value for CSV embedding:
 * - Wrap in double quotes if the value contains commas, newlines, or quotes.
 * - Double any embedded double-quote characters.
 */
function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function recordToCsvRow(record: AuditRecord): string {
  const values = CSV_COLUMNS.map((column: CsvColumn) => {
    const raw = record[column];
    if (raw === undefined || raw === null) {
      return "";
    }
    if (typeof raw === "object") {
      return escapeCsvField(JSON.stringify(raw));
    }
    return escapeCsvField(String(raw));
  });
  return values.join(",");
}

/**
 * Serialise records to CSV format.
 * The first row contains column headers.  All fields are present on every row;
 * optional fields that are absent on a particular record are left empty.
 */
export function exportCsv(records: AuditRecord[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = records.map(recordToCsvRow);
  return [header, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// CEF export (Common Event Format — SIEM integration)
// ---------------------------------------------------------------------------

/**
 * Map a governance decision to a CEF severity level (0–10).
 * Denied decisions at lower trust levels warrant higher severity.
 */
function cefSeverity(record: AuditRecord): number {
  if (!record.permitted) {
    // Denied decisions are inherently more significant for security review.
    return 7;
  }
  return 3;
}

/**
 * Escape a CEF extension field value.
 * Per the ArcSight CEF spec: backslash and equals-sign must be escaped.
 */
function escapeCefExtension(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/=/g, "\\=");
}

/**
 * Escape a CEF header field value.
 * Per the ArcSight CEF spec: pipe characters and backslashes must be escaped.
 */
function escapeCefHeader(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

/**
 * Serialise a single AuditRecord to a CEF event line.
 *
 * Format:
 * `CEF:0|Vendor|Product|Version|SignatureId|Name|Severity|Extension`
 */
function recordToCefLine(record: AuditRecord): string {
  const severity = cefSeverity(record);
  const signatureId = escapeCefHeader(record.action);
  const name = escapeCefHeader(`Governance Decision: ${record.action}`);

  const extensions: string[] = [
    `rt=${escapeCefExtension(record.timestamp)}`,
    `src=${escapeCefExtension(record.agentId)}`,
    `act=${escapeCefExtension(record.action)}`,
    `outcome=${record.permitted ? "permitted" : "denied"}`,
    `cs1Label=recordId`,
    `cs1=${escapeCefExtension(record.id)}`,
    `cs2Label=previousHash`,
    `cs2=${escapeCefExtension(record.previousHash)}`,
    `cs3Label=recordHash`,
    `cs3=${escapeCefExtension(record.recordHash)}`,
  ];

  if (record.trustLevel !== undefined) {
    extensions.push(`cn1Label=trustLevel`, `cn1=${record.trustLevel}`);
  }
  if (record.requiredLevel !== undefined) {
    extensions.push(`cn2Label=requiredLevel`, `cn2=${record.requiredLevel}`);
  }
  if (record.budgetUsed !== undefined) {
    extensions.push(`cn3Label=budgetUsed`, `cn3=${record.budgetUsed}`);
  }
  if (record.budgetRemaining !== undefined) {
    extensions.push(`cn4Label=budgetRemaining`, `cn4=${record.budgetRemaining}`);
  }
  if (record.reason !== undefined) {
    extensions.push(`msg=${escapeCefExtension(record.reason)}`);
  }

  const extensionString = extensions.join(" ");
  return `CEF:0|AumOS|AuditTrail|1.0|${signatureId}|${name}|${severity}|${extensionString}`;
}

/**
 * Serialise records to CEF format, one event per line.
 * Compatible with Splunk Universal Forwarder and Elastic Agent syslog inputs.
 */
export function exportCef(records: AuditRecord[]): string {
  return records.map(recordToCefLine).join("\n");
}

// ---------------------------------------------------------------------------
// Unified dispatcher
// ---------------------------------------------------------------------------

/**
 * Route export to the appropriate format handler.
 */
export function exportRecords(records: AuditRecord[], format: ExportFormat): string {
  switch (format) {
    case "json":
      return exportJson(records);
    case "csv":
      return exportCsv(records);
    case "cef":
      return exportCef(records);
    default: {
      // Exhaustive check — TypeScript will error here if a new format is added
      // to ExportFormat without a corresponding case above.
      const unreachable: never = format;
      throw new Error(`Unsupported export format: ${String(unreachable)}`);
    }
  }
}
