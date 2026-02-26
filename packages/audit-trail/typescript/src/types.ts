// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * An immutable, hash-chained audit record capturing a single governance decision.
 * Fields are readonly to prevent accidental mutation after creation.
 */
export interface AuditRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly agentId: string;
  readonly action: string;
  readonly permitted: boolean;
  readonly trustLevel?: number;
  readonly requiredLevel?: number;
  readonly budgetUsed?: number;
  readonly budgetRemaining?: number;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
  readonly previousHash: string;
  readonly recordHash: string;
}

/**
 * Input for logging a governance decision. Does not include hash fields —
 * those are computed by the chain on append.
 */
export interface GovernanceDecisionInput {
  readonly agentId: string;
  readonly action: string;
  readonly permitted: boolean;
  readonly trustLevel?: number;
  readonly requiredLevel?: number;
  readonly budgetUsed?: number;
  readonly budgetRemaining?: number;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Filter parameters for querying the audit log.
 * All fields are optional — omitting a field means no filter on that dimension.
 */
export interface AuditFilter {
  readonly agentId?: string;
  readonly action?: string;
  readonly permitted?: boolean;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Result returned after verifying the integrity of the hash chain.
 */
export type ChainVerificationResult =
  | { readonly valid: true; readonly recordCount: number }
  | {
      readonly valid: false;
      readonly recordCount: number;
      readonly brokenAt: number;
      readonly reason: string;
    };

/**
 * Export format identifiers.
 */
export type ExportFormat = "json" | "csv" | "cef";

/**
 * Configuration for constructing an AuditLogger.
 */
export interface AuditConfig {
  /**
   * Storage backend to use. Defaults to in-memory storage when omitted.
   */
  readonly storage?: import("./storage/interface.js").AuditStorage;
}
