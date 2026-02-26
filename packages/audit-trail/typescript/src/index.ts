// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/audit-trail — Immutable, hash-chained decision logging for AI agent governance.
 *
 * Public API surface:
 *
 *   Classes:
 *     AuditLogger    — Primary logger: log(), query(), verify(), exportRecords(), count()
 *     HashChain      — Low-level hash-chain management (append + verify)
 *     AuditQuery     — Composable query facade over any AuditStorage backend
 *     MemoryStorage  — Volatile in-memory storage (default)
 *     FileStorage    — Append-only NDJSON file storage
 *
 *   Functions:
 *     exportJson     — Serialise records to JSON
 *     exportCsv      — Serialise records to CSV
 *     exportCef      — Serialise records to CEF (SIEM)
 *     exportRecords  — Format-dispatching export helper
 *     buildPendingRecord — Construct a pre-hash AuditRecord from raw input
 *     finaliseRecord     — Attach a computed hash to a pending record
 *
 *   Types:
 *     AuditRecord, GovernanceDecisionInput, AuditFilter,
 *     AuditConfig, AuditStorage, ChainVerificationResult, ExportFormat
 */

// Core classes
export { AuditLogger } from "./logger.js";
export { HashChain } from "./chain.js";
export { AuditQuery } from "./query.js";

// Storage
export { MemoryStorage } from "./storage/memory.js";
export { FileStorage } from "./storage/file.js";
export type { AuditStorage } from "./storage/interface.js";

// Record helpers
export { buildPendingRecord, finaliseRecord } from "./record.js";

// Export helpers
export { exportJson, exportCsv, exportCef, exportRecords } from "./export.js";

// Types
export type {
  AuditRecord,
  GovernanceDecisionInput,
  AuditFilter,
  AuditConfig,
  ChainVerificationResult,
  ExportFormat,
} from "./types.js";
