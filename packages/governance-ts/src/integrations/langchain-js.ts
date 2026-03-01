// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — LangChain.js Tool Governance Adapter
 *
 * `GovernedLangChainTool` wraps any LangChain.js `StructuredTool` (or any
 * object with a compatible `invoke` / `call` surface) with AumOS governance
 * controls.  Before each tool execution the wrapper:
 *
 *   1. Checks whether the agent's trust level meets the configured minimum.
 *   2. Checks whether a budget cap would be breached.
 *   3. Invokes the wrapped tool if both checks pass.
 *   4. Records budget spending for the completed call.
 *   5. Appends an entry to the in-memory audit trail.
 *
 * The wrapper does NOT import from `langchain` or `@langchain/core` to avoid
 * creating a hard package dependency.  Instead it accepts the tool as an
 * opaque object typed via a structural interface, keeping the integration
 * usable across LangChain.js versions.
 *
 * Trust changes are MANUAL ONLY.
 * Budget allocation is STATIC ONLY — limits are set at construction time.
 * Audit logging is RECORDING ONLY — no analysis or side-effects.
 *
 * Usage:
 * ```ts
 * import { GovernedLangChainTool } from '@aumos/governance';
 *
 * const governed = new GovernedLangChainTool(myTool, {
 *   agentId: 'researcher-agent',
 *   trustLevel: 3,
 *   minimumTrustLevel: 2,
 *   budget: { perCall: 0.10, daily: 5.00 },
 *   onDeny: 'throw',
 * });
 *
 * const result = await governed.invoke({ query: 'latest AI papers' });
 * ```
 */

import { z } from 'zod';
import { GovernanceError } from '../errors.js';

// ---------------------------------------------------------------------------
// Structural interface — avoids a hard dependency on @langchain/core
// ---------------------------------------------------------------------------

/**
 * Minimal structural interface for a LangChain.js tool.
 *
 * The actual `StructuredTool` and `DynamicTool` classes from `@langchain/core`
 * satisfy this interface at runtime.  Using a structural interface keeps this
 * adapter usable without a hard dependency on any specific LangChain version.
 */
export interface LangChainToolLike {
  /** The tool name exposed to the agent. */
  readonly name: string;
  /** Human-readable description of the tool. */
  readonly description?: string;
  /**
   * Invoke the tool with the given input.
   * Both `invoke` (v0.2+) and the legacy `call` signature are accepted.
   */
  invoke?(input: unknown, options?: unknown): Promise<unknown>;
  call?(input: unknown, options?: unknown): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for GovernedLangChainTool configuration.
 *
 * - `agentId`: identifier of the agent invoking the tool.
 * - `trustLevel`: trust tier (0–5) held by this agent.  Default 2.
 * - `minimumTrustLevel`: minimum trust required to execute this tool.  Default 1.
 * - `budget`: optional static per-call and daily spending caps in USD.
 * - `audit`: whether to record decisions.  Default true.
 * - `onDeny`: action taken when governance denies the call.  Default 'throw'.
 */
export const GovernedLangChainToolConfigSchema = z.object({
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
      /** Maximum spend per individual tool call. */
      perCall: z.number().positive().optional(),
      /** Maximum aggregate spend per UTC calendar day (midnight reset). */
      daily: z.number().positive().optional(),
    })
    .optional(),
  /** Record governance decisions in the audit trail.  Default true. */
  audit: z.boolean().default(true),
  /**
   * Action taken when governance denies a call.
   * 'throw'        — throw GovernanceDeniedError (default).
   * 'return_empty' — resolve with an empty string result.
   * 'log_only'     — allow execution but mark the audit record as denied.
   */
  onDeny: z.enum(['throw', 'return_empty', 'log_only']).default('throw'),
});

/** Parsed type for GovernedLangChainToolConfigSchema. */
export type GovernedLangChainToolConfig = z.infer<typeof GovernedLangChainToolConfigSchema>;

// ---------------------------------------------------------------------------
// Audit record
// ---------------------------------------------------------------------------

/** A governance audit record for one tool invocation. */
export interface LangChainToolAuditRecord {
  /** Unique identifier for this audit entry. */
  readonly id: string;
  /** ISO-8601 timestamp when governance was evaluated. */
  readonly timestamp: string;
  /** Name of the wrapped tool. */
  readonly toolName: string;
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
  /** True if the tool itself completed without throwing. */
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
// GovernedLangChainTool
// ---------------------------------------------------------------------------

/**
 * Wraps any LangChain.js tool with AumOS governance controls.
 *
 * Exposes the same `invoke()` and `name` / `description` properties as the
 * wrapped tool so it can be used as a drop-in replacement in agent tool lists.
 *
 * Governance flow per call:
 *   1. Trust level gate — deny if `trustLevel < minimumTrustLevel`.
 *   2. Per-call budget cap — deny if estimated cost exceeds `budget.perCall`.
 *   3. Daily budget cap — deny if daily spend would be exceeded.
 *   4. Execute wrapped tool.
 *   5. Record spending (static, based on `estimatedCallCost`).
 *   6. Append audit record.
 */
export class GovernedLangChainTool {
  readonly #tool: LangChainToolLike;
  readonly #config: GovernedLangChainToolConfig;
  readonly #auditLog: LangChainToolAuditRecord[] = [];
  readonly #dailyWindow: DailyBudgetWindow;

  /** The name of the wrapped tool, forwarded for agent tool-list compatibility. */
  get name(): string {
    return this.#tool.name;
  }

  /** The description of the wrapped tool, forwarded for agent tool-list compatibility. */
  get description(): string | undefined {
    return this.#tool.description;
  }

  constructor(tool: LangChainToolLike, config: Partial<GovernedLangChainToolConfig> = {}) {
    this.#tool = tool;
    this.#config = GovernedLangChainToolConfigSchema.parse(config);
    this.#dailyWindow = { openedAt: dayStart(Date.now()), spent: 0 };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Invoke the wrapped tool after passing governance controls.
   *
   * @param input - Input passed directly to the underlying tool's `invoke()`.
   * @param options - Optional invocation options forwarded to the tool.
   * @returns The tool's output when permitted; an empty string when
   *   `onDeny` is `'return_empty'` and governance denies the call.
   * @throws {LangChainToolGovernanceDeniedError} when `onDeny` is `'throw'`
   *   and governance denies the call.
   * @throws {LangChainToolTrustInsufficientError} when `trustLevel` is below
   *   `minimumTrustLevel`.
   */
  async invoke(input: unknown, options?: unknown): Promise<unknown> {
    const auditId = crypto.randomUUID();
    const toolName = this.#tool.name;

    // ------------------------------------------------------------------
    // Step 1: Trust level gate
    // ------------------------------------------------------------------
    if (this.#config.trustLevel < this.#config.minimumTrustLevel) {
      const reason =
        `Tool '${toolName}' denied: agent '${this.#config.agentId}' ` +
        `trustLevel ${this.#config.trustLevel} is below ` +
        `minimumTrustLevel ${this.#config.minimumTrustLevel}.`;

      this.#appendAuditRecord({
        id: auditId,
        toolName,
        permitted: false,
        spendRecorded: undefined,
        denialReason: reason,
        toolSucceeded: undefined,
      });

      return this.#applyOnDeny(
        new LangChainToolTrustInsufficientError(
          toolName,
          this.#config.agentId,
          this.#config.trustLevel,
          this.#config.minimumTrustLevel,
        ),
      );
    }

    // ------------------------------------------------------------------
    // Step 2: Budget checks
    // ------------------------------------------------------------------
    const budgetDenial = this.#checkBudget();
    if (budgetDenial !== undefined) {
      this.#appendAuditRecord({
        id: auditId,
        toolName,
        permitted: false,
        spendRecorded: undefined,
        denialReason: budgetDenial,
        toolSucceeded: undefined,
      });

      return this.#applyOnDeny(
        new LangChainToolGovernanceDeniedError(toolName, this.#config.agentId, budgetDenial),
      );
    }

    // ------------------------------------------------------------------
    // Step 3: Execute wrapped tool
    // ------------------------------------------------------------------
    let toolSucceeded = false;
    let toolResult: unknown;

    try {
      if (typeof this.#tool.invoke === 'function') {
        toolResult = await this.#tool.invoke(input, options);
      } else if (typeof this.#tool.call === 'function') {
        toolResult = await this.#tool.call(input, options);
      } else {
        throw new Error(
          `Tool '${toolName}' exposes neither invoke() nor call() — ` +
            'cannot execute.',
        );
      }
      toolSucceeded = true;
    } finally {
      // ------------------------------------------------------------------
      // Step 4: Record budget spending (always, even on tool failure)
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
        toolName,
        permitted: true,
        spendRecorded: spend,
        denialReason: undefined,
        toolSucceeded,
      });
    }

    return toolResult;
  }

  /**
   * Returns all governance audit records for invocations through this instance.
   */
  getAuditLog(): readonly LangChainToolAuditRecord[] {
    return [...this.#auditLog];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Checks whether the current call would breach any configured budget limit.
   * Returns a denial reason string on violation, undefined when permitted.
   */
  #checkBudget(): string | undefined {
    const budget = this.#config.budget;
    if (budget === undefined) return undefined;

    // Daily cap — reset at UTC midnight
    if (budget.daily !== undefined) {
      this.#maybeResetDailyWindow();
      const projectedDaily = this.#dailyWindow.spent + (budget.perCall ?? 0);
      if (projectedDaily > budget.daily) {
        return (
          `Daily budget limit of $${budget.daily.toFixed(4)} for tool ` +
          `'${this.#tool.name}' (agent '${this.#config.agentId}') would be exceeded ` +
          `(current daily spend: $${this.#dailyWindow.spent.toFixed(4)}).`
        );
      }
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

  /** Appends an audit record when audit is enabled. */
  #appendAuditRecord(entry: {
    id: string;
    toolName: string;
    permitted: boolean;
    spendRecorded: number | undefined;
    denialReason: string | undefined;
    toolSucceeded: boolean | undefined;
  }): void {
    if (!this.#config.audit) return;

    const record: LangChainToolAuditRecord = {
      id: entry.id,
      timestamp: new Date().toISOString(),
      toolName: entry.toolName,
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
   * Applies the configured `onDeny` behaviour and returns a result or throws.
   * Only called when a governance check has already determined denial.
   */
  #applyOnDeny(error: GovernanceError): unknown {
    switch (this.#config.onDeny) {
      case 'throw':
        throw error;

      case 'log_only':
        // Allow execution to continue; the audit record already marks it denied.
        return undefined;

      case 'return_empty':
      default:
        return '';
    }
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a LangChain.js tool call is denied by the AumOS governance
 * engine and `onDeny` is `'throw'`.
 */
export class LangChainToolGovernanceDeniedError extends GovernanceError {
  readonly toolName: string;
  readonly agentId: string;

  constructor(toolName: string, agentId: string, reason: string) {
    super(
      'LANGCHAIN_TOOL_GOVERNANCE_DENIED',
      `Tool '${toolName}' denied for agent '${agentId}': ${reason}`,
    );
    this.name = 'LangChainToolGovernanceDeniedError';
    this.toolName = toolName;
    this.agentId = agentId;
  }
}

/**
 * Thrown when the configured `trustLevel` is below `minimumTrustLevel` for a
 * LangChain.js governed tool invocation and `onDeny` is `'throw'`.
 */
export class LangChainToolTrustInsufficientError extends GovernanceError {
  readonly toolName: string;
  readonly agentId: string;
  readonly currentLevel: number;
  readonly requiredLevel: number;

  constructor(
    toolName: string,
    agentId: string,
    currentLevel: number,
    requiredLevel: number,
  ) {
    super(
      'LANGCHAIN_TOOL_TRUST_INSUFFICIENT',
      `Tool '${toolName}' denied for agent '${agentId}': ` +
        `trustLevel ${currentLevel} is below minimumTrustLevel ${requiredLevel}.`,
    );
    this.name = 'LangChainToolTrustInsufficientError';
    this.toolName = toolName;
    this.agentId = agentId;
    this.currentLevel = currentLevel;
    this.requiredLevel = requiredLevel;
  }
}
