// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Mastra Framework Tool Governance Adapter
 *
 * `GovernedMastraTool` wraps any Mastra tool (or any object satisfying the
 * structural `MastraToolLike` interface) with AumOS governance controls.
 * Before each tool execution the wrapper:
 *
 *   1. Checks whether the agent's trust level meets the configured minimum.
 *   2. Checks whether a budget cap would be breached.
 *   3. Executes the wrapped tool if both checks pass.
 *   4. Records static budget spending after execution.
 *   5. Appends an entry to the in-memory audit trail.
 *
 * The wrapper does NOT import from the `@mastra/core` package to avoid a hard
 * dependency.  Instead it accepts the tool as an opaque object typed via a
 * structural interface.  The actual Mastra tool objects satisfy this interface
 * at runtime, so no wrapper or adapter shim is required.
 *
 * Trust changes are MANUAL ONLY.
 * Budget allocation is STATIC ONLY — limits are set at construction time.
 * Audit logging is RECORDING ONLY — no analysis or side-effects.
 *
 * Usage:
 * ```ts
 * import { GovernedMastraTool } from '@aumos/governance';
 *
 * const governed = new GovernedMastraTool(myMastraTool, {
 *   agentId: 'support-agent',
 *   trustLevel: 3,
 *   minimumTrustLevel: 2,
 *   budget: { perCall: 0.05, daily: 2.00 },
 *   onDeny: 'throw',
 * });
 *
 * // Use as a Mastra tool in any agent or workflow:
 * const agent = new Agent({ tools: { search: governed } });
 * ```
 */

import { z } from 'zod';
import { GovernanceError } from '../errors.js';

// ---------------------------------------------------------------------------
// Structural interface — avoids a hard dependency on @mastra/core
// ---------------------------------------------------------------------------

/**
 * Minimal structural interface for a Mastra tool.
 *
 * Mastra tools are plain objects with an `id`, optional `description`, and
 * an `execute` function.  This interface mirrors the subset of
 * `@mastra/core`'s `Tool` type that `GovernedMastraTool` needs, so the
 * adapter compiles and runs correctly without a direct package dependency.
 */
export interface MastraToolLike {
  /** Unique identifier for the tool within the Mastra agent. */
  readonly id: string;
  /** Human-readable description of what the tool does. */
  readonly description?: string;
  /**
   * Execute the tool with the given context.
   * Corresponds to the `execute` method on Mastra's `Tool` type.
   */
  execute(context: unknown): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for GovernedMastraTool configuration.
 *
 * - `agentId`: identifier for the agent that owns this tool instance.
 * - `trustLevel`: trust tier (0–5) held by the agent.  Default 2.
 * - `minimumTrustLevel`: minimum trust required to execute the tool.  Default 1.
 * - `budget`: optional static per-call and daily spending caps in USD.
 * - `audit`: whether to record decisions in the audit log.  Default true.
 * - `onDeny`: action on governance denial.  Default 'throw'.
 */
export const GovernedMastraToolConfigSchema = z.object({
  /** Identifier for the agent invoking the tool. */
  agentId: z.string().min(1).default('default'),
  /**
   * Trust tier (0–5) held by the invoking agent.
   * Default: 2 (L2_SUGGEST).
   */
  trustLevel: z.number().int().min(0).max(5).default(2),
  /**
   * Minimum trust level required to execute the wrapped tool.
   * Calls from agents below this level are denied immediately.
   * Default: 1 (L1_MONITOR).
   */
  minimumTrustLevel: z.number().int().min(0).max(5).default(1),
  /** Optional static spending caps in USD. */
  budget: z
    .object({
      /** Maximum spend per individual tool execution. */
      perCall: z.number().positive().optional(),
      /** Maximum aggregate spend per UTC calendar day (midnight reset). */
      daily: z.number().positive().optional(),
    })
    .optional(),
  /** Record governance decisions in the audit trail.  Default true. */
  audit: z.boolean().default(true),
  /**
   * Action taken when governance denies a call.
   * 'throw'        — throw MastraToolGovernanceDeniedError (default).
   * 'return_empty' — resolve with null.
   * 'log_only'     — allow execution but mark the audit record as denied.
   */
  onDeny: z.enum(['throw', 'return_empty', 'log_only']).default('throw'),
});

/** Parsed type for GovernedMastraToolConfigSchema. */
export type GovernedMastraToolConfig = z.infer<typeof GovernedMastraToolConfigSchema>;

// ---------------------------------------------------------------------------
// Audit record
// ---------------------------------------------------------------------------

/** A governance audit record for one Mastra tool execution. */
export interface MastraToolAuditRecord {
  /** Unique identifier for this audit entry. */
  readonly id: string;
  /** ISO-8601 timestamp when governance was evaluated. */
  readonly timestamp: string;
  /** ID of the wrapped Mastra tool. */
  readonly toolId: string;
  /** Agent that invoked the tool. */
  readonly agentId: string;
  /** Whether the call was permitted by governance. */
  readonly permitted: boolean;
  /** The trust level at the time of the call. */
  readonly trustLevel: number;
  /** Optional spend recorded for this call in USD. */
  readonly spendRecorded: number | undefined;
  /** Human-readable denial reason when `permitted` is false. */
  readonly denialReason: string | undefined;
  /** True if the tool itself resolved without throwing. */
  readonly toolSucceeded: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Internal budget window
// ---------------------------------------------------------------------------

/** Milliseconds in one UTC calendar day. */
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

interface DailyBudgetWindow {
  openedAt: number;
  spent: number;
}

function dayStart(nowMs: number): number {
  const date = new Date(nowMs);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

// ---------------------------------------------------------------------------
// GovernedMastraTool
// ---------------------------------------------------------------------------

/**
 * Wraps any Mastra tool with AumOS governance controls.
 *
 * Exposes the same `id`, `description`, and `execute()` surface as the
 * wrapped tool so it can be passed directly to a Mastra agent's tool map
 * without modification.
 *
 * Governance flow per execution:
 *   1. Trust level gate — deny if `trustLevel < minimumTrustLevel`.
 *   2. Daily budget cap — deny if daily spend would be exceeded.
 *   3. Execute wrapped tool via `execute()`.
 *   4. Record static per-call spending against the daily window.
 *   5. Append audit record (always, even when the tool itself throws).
 */
export class GovernedMastraTool {
  readonly #tool: MastraToolLike;
  readonly #config: GovernedMastraToolConfig;
  readonly #auditLog: MastraToolAuditRecord[] = [];
  readonly #dailyWindow: DailyBudgetWindow;

  /** The ID of the wrapped tool, forwarded for Mastra agent compatibility. */
  get id(): string {
    return this.#tool.id;
  }

  /** The description of the wrapped tool, forwarded for Mastra agent compatibility. */
  get description(): string | undefined {
    return this.#tool.description;
  }

  constructor(tool: MastraToolLike, config: Partial<GovernedMastraToolConfig> = {}) {
    this.#tool = tool;
    this.#config = GovernedMastraToolConfigSchema.parse(config);
    this.#dailyWindow = { openedAt: dayStart(Date.now()), spent: 0 };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Execute the wrapped tool after passing governance controls.
   *
   * @param context - Execution context passed directly to the underlying
   *   tool's `execute()` method.
   * @returns The tool's output when permitted; `null` when `onDeny` is
   *   `'return_empty'` and governance denies the call.
   * @throws {MastraToolGovernanceDeniedError} when `onDeny` is `'throw'` and
   *   a budget check fails.
   * @throws {MastraToolTrustInsufficientError} when `onDeny` is `'throw'` and
   *   the agent's trust level is below `minimumTrustLevel`.
   */
  async execute(context: unknown): Promise<unknown> {
    const auditId = crypto.randomUUID();
    const toolId = this.#tool.id;

    // ------------------------------------------------------------------
    // Step 1: Trust level gate
    // ------------------------------------------------------------------
    if (this.#config.trustLevel < this.#config.minimumTrustLevel) {
      const reason =
        `Tool '${toolId}' denied for agent '${this.#config.agentId}': ` +
        `trustLevel ${this.#config.trustLevel} is below ` +
        `minimumTrustLevel ${this.#config.minimumTrustLevel}.`;

      this.#appendAuditRecord({
        id: auditId,
        toolId,
        permitted: false,
        spendRecorded: undefined,
        denialReason: reason,
        toolSucceeded: undefined,
      });

      return this.#applyOnDeny(
        new MastraToolTrustInsufficientError(
          toolId,
          this.#config.agentId,
          this.#config.trustLevel,
          this.#config.minimumTrustLevel,
        ),
      );
    }

    // ------------------------------------------------------------------
    // Step 2: Budget check
    // ------------------------------------------------------------------
    const budgetDenial = this.#checkBudget();
    if (budgetDenial !== undefined) {
      this.#appendAuditRecord({
        id: auditId,
        toolId,
        permitted: false,
        spendRecorded: undefined,
        denialReason: budgetDenial,
        toolSucceeded: undefined,
      });

      return this.#applyOnDeny(
        new MastraToolGovernanceDeniedError(toolId, this.#config.agentId, budgetDenial),
      );
    }

    // ------------------------------------------------------------------
    // Step 3: Execute wrapped tool
    // ------------------------------------------------------------------
    let toolSucceeded = false;
    let toolResult: unknown;

    try {
      toolResult = await this.#tool.execute(context);
      toolSucceeded = true;
    } finally {
      // ------------------------------------------------------------------
      // Step 4: Record static spending (always, even on tool failure)
      // ------------------------------------------------------------------
      const spend = this.#config.budget?.perCall;
      if (spend !== undefined) {
        this.#recordSpend(spend);
      }

      // ------------------------------------------------------------------
      // Step 5: Append audit record
      // ------------------------------------------------------------------
      this.#appendAuditRecord({
        id: auditId,
        toolId,
        permitted: true,
        spendRecorded: spend,
        denialReason: undefined,
        toolSucceeded,
      });
    }

    return toolResult;
  }

  /**
   * Returns all governance audit records for executions through this instance.
   */
  getAuditLog(): readonly MastraToolAuditRecord[] {
    return [...this.#auditLog];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Checks whether the current call would breach the daily budget limit.
   * Returns a denial reason string on violation, undefined when permitted.
   */
  #checkBudget(): string | undefined {
    const budget = this.#config.budget;
    if (budget?.daily === undefined) return undefined;

    this.#maybeResetDailyWindow();

    const estimatedCall = budget.perCall ?? 0;
    const projectedDaily = this.#dailyWindow.spent + estimatedCall;

    if (projectedDaily > budget.daily) {
      return (
        `Daily budget limit of $${budget.daily.toFixed(4)} for tool ` +
        `'${this.#tool.id}' (agent '${this.#config.agentId}') would be exceeded ` +
        `(current daily spend: $${this.#dailyWindow.spent.toFixed(4)}).`
      );
    }

    return undefined;
  }

  /** Records static per-call spending against the daily budget window. */
  #recordSpend(amount: number): void {
    if (this.#config.budget?.daily !== undefined) {
      this.#maybeResetDailyWindow();
      this.#dailyWindow.spent += amount;
    }
  }

  /** Resets the daily window if UTC midnight has passed. */
  #maybeResetDailyWindow(): void {
    const now = Date.now();
    if (now >= this.#dailyWindow.openedAt + ONE_DAY_MS) {
      this.#dailyWindow.openedAt = dayStart(now);
      this.#dailyWindow.spent = 0;
    }
  }

  /** Appends a governance audit record when audit is enabled. */
  #appendAuditRecord(entry: {
    id: string;
    toolId: string;
    permitted: boolean;
    spendRecorded: number | undefined;
    denialReason: string | undefined;
    toolSucceeded: boolean | undefined;
  }): void {
    if (!this.#config.audit) return;

    const record: MastraToolAuditRecord = {
      id: entry.id,
      timestamp: new Date().toISOString(),
      toolId: entry.toolId,
      agentId: this.#config.agentId,
      permitted: entry.permitted,
      trustLevel: this.#config.trustLevel,
      spendRecorded: entry.spendRecorded,
      denialReason: entry.denialReason,
      toolSucceeded: entry.toolSucceeded,
    };

    this.#auditLog.push(record);
  }

  /**
   * Applies the configured `onDeny` behaviour.
   * Only called when governance has already determined denial.
   */
  #applyOnDeny(error: GovernanceError): null | undefined {
    switch (this.#config.onDeny) {
      case 'throw':
        throw error;

      case 'log_only':
        return undefined;

      case 'return_empty':
      default:
        return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a Mastra tool execution is denied by AumOS governance and
 * `onDeny` is `'throw'`.
 */
export class MastraToolGovernanceDeniedError extends GovernanceError {
  readonly toolId: string;
  readonly agentId: string;

  constructor(toolId: string, agentId: string, reason: string) {
    super(
      'MASTRA_TOOL_GOVERNANCE_DENIED',
      `Tool '${toolId}' denied for agent '${agentId}': ${reason}`,
    );
    this.name = 'MastraToolGovernanceDeniedError';
    this.toolId = toolId;
    this.agentId = agentId;
  }
}

/**
 * Thrown when the configured `trustLevel` is below `minimumTrustLevel` for a
 * Mastra governed tool execution and `onDeny` is `'throw'`.
 */
export class MastraToolTrustInsufficientError extends GovernanceError {
  readonly toolId: string;
  readonly agentId: string;
  readonly currentLevel: number;
  readonly requiredLevel: number;

  constructor(
    toolId: string,
    agentId: string,
    currentLevel: number,
    requiredLevel: number,
  ) {
    super(
      'MASTRA_TOOL_TRUST_INSUFFICIENT',
      `Tool '${toolId}' denied for agent '${agentId}': ` +
        `trustLevel ${currentLevel} is below minimumTrustLevel ${requiredLevel}.`,
    );
    this.name = 'MastraToolTrustInsufficientError';
    this.toolId = toolId;
    this.agentId = agentId;
    this.currentLevel = currentLevel;
    this.requiredLevel = requiredLevel;
  }
}
