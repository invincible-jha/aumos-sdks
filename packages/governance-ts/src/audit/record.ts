// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { GovernanceDecision } from '../types.js';

/**
 * A single immutable audit record persisted to the in-memory audit log.
 *
 * AuditRecord captures the outcome of a governance decision alongside any
 * caller-supplied context.  Records are append-only — once written they are
 * never modified.
 */
export interface AuditRecord {
  /** Unique identifier for this record. */
  readonly id: string;
  /** The agent whose action was evaluated. */
  readonly agentId: string;
  /** The action identifier supplied by the caller. */
  readonly action: string;
  /** The overall governance outcome. */
  readonly outcome: 'permit' | 'deny';
  /** The protocol sub-system that produced the final verdict. */
  readonly protocol: string;
  /** Human-readable reason attached to the GovernanceDecision. */
  readonly reason: string;
  /** When the governance decision was recorded. */
  readonly timestamp: string;
  /**
   * Supplementary details forwarded from GovernanceDecision.details plus
   * any extra context supplied by the caller at log time.
   */
  readonly metadata: Record<string, unknown>;
}

/** Context the caller may supply when logging a governance decision. */
export interface AuditContext {
  /** Agent identifier, required when the action context includes it. */
  agentId?: string;
  /** The action name, if not already embedded in the decision. */
  action?: string;
  /** Any additional key/value pairs to attach to the record. */
  [key: string]: unknown;
}

/**
 * Creates an AuditRecord from a GovernanceDecision and optional context.
 *
 * This factory is intentionally pure — it takes no mutable state and
 * produces a fully populated record ready for storage.
 */
export function createAuditRecord(
  decision: GovernanceDecision,
  context: AuditContext = {},
): AuditRecord {
  const { agentId = 'unknown', action = 'unknown', ...rest } = context;

  return {
    id: crypto.randomUUID(),
    agentId: typeof agentId === 'string' ? agentId : 'unknown',
    action: typeof action === 'string' ? action : 'unknown',
    outcome: decision.permitted ? 'permit' : 'deny',
    protocol: decision.protocol,
    reason: decision.reason,
    timestamp: decision.timestamp,
    metadata: {
      ...(decision.details ?? {}),
      ...rest,
    },
  };
}
