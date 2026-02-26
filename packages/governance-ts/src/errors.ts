// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import type { TrustLevel } from './types.js';

/**
 * Base class for all @aumos/governance errors.
 *
 * Every SDK error includes a machine-readable `code` that calling code can
 * switch on without parsing human-readable messages.
 */
export class GovernanceError extends Error {
  /** Machine-readable error code. Always a SCREAMING_SNAKE_CASE string. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GovernanceError';
    this.code = code;
    // Maintain proper prototype chain for instanceof checks.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an action is denied because the agent's current trust level is
 * below the minimum required for the requested operation.
 *
 * Callers should surface `currentLevel` and `requiredLevel` in user-facing
 * messages so operators can make an informed decision about whether to
 * manually raise the agent's trust level.
 */
export class TrustDeniedError extends GovernanceError {
  /** The agent's current trust level at the time of the check. */
  readonly currentLevel: TrustLevel;
  /** The minimum level required to proceed. */
  readonly requiredLevel: TrustLevel;
  /** The agent whose trust was evaluated. */
  readonly agentId: string;

  constructor(agentId: string, currentLevel: TrustLevel, requiredLevel: TrustLevel) {
    super(
      'TRUST_DENIED',
      `Agent "${agentId}" has trust level ${currentLevel} but action requires level ${requiredLevel}.`,
    );
    this.name = 'TrustDeniedError';
    this.agentId = agentId;
    this.currentLevel = currentLevel;
    this.requiredLevel = requiredLevel;
  }
}

/**
 * Thrown when a spending operation would push an agent's spend above the
 * configured envelope limit.
 *
 * `available` tells callers exactly how much headroom remains so they can
 * decide whether to retry with a smaller amount or escalate to a human.
 */
export class BudgetExceededError extends GovernanceError {
  /** The budget category that would be exceeded. */
  readonly category: string;
  /** The amount requested by the agent. */
  readonly requested: number;
  /** The amount remaining in the envelope at the time of the check. */
  readonly available: number;

  constructor(category: string, requested: number, available: number) {
    super(
      'BUDGET_EXCEEDED',
      `Budget exceeded for category "${category}": requested ${requested}, available ${available}.`,
    );
    this.name = 'BudgetExceededError';
    this.category = category;
    this.requested = requested;
    this.available = available;
  }
}

/**
 * Thrown when an agent attempts to access data or a capability for which
 * consent has not been recorded (or has been revoked).
 *
 * `dataType` and `purpose` together form the consent key, so callers can
 * present a specific consent request to the user or operator.
 */
export class ConsentRequiredError extends GovernanceError {
  /** The agent that lacks consent. */
  readonly agentId: string;
  /** The data type or capability for which consent is required. */
  readonly dataType: string;
  /** The stated purpose of access, if provided. */
  readonly purpose: string | undefined;

  constructor(agentId: string, dataType: string, purpose?: string) {
    const purposeClause = purpose !== undefined ? ` for purpose "${purpose}"` : '';
    super(
      'CONSENT_REQUIRED',
      `Agent "${agentId}" lacks consent to access data type "${dataType}"${purposeClause}.`,
    );
    this.name = 'ConsentRequiredError';
    this.agentId = agentId;
    this.dataType = dataType;
    this.purpose = purpose;
  }
}

/**
 * Thrown when SDK configuration is structurally or semantically invalid.
 *
 * The `details` array carries one entry per validation error, matching the
 * format produced by Zod's `ZodError.issues` so callers can forward them
 * directly to structured loggers.
 */
export class InvalidConfigError extends GovernanceError {
  /** Structured list of individual validation failures. */
  readonly details: readonly string[];

  constructor(details: readonly string[]) {
    super('INVALID_CONFIG', `SDK configuration is invalid: ${details.join('; ')}`);
    this.name = 'InvalidConfigError';
    this.details = details;
  }
}
