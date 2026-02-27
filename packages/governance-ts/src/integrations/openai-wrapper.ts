// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — OpenAI SDK Governance Wrapper
 *
 * `GovernedOpenAI` wraps an OpenAI SDK client instance using the Proxy
 * pattern.  Every call to `chat.completions.create()` is intercepted and
 * passed through AumOS governance controls before being forwarded to the
 * underlying client.
 *
 * Trust is checked against the configured `trustLevel`; budget is evaluated
 * against optional static spending caps; every decision is recorded in an
 * in-memory audit log.
 *
 * The wrapper does NOT import from the `openai` npm package so that it can
 * be used in environments where the OpenAI SDK is not installed.  Instead it
 * accepts the OpenAI client as an opaque object typed via a structural
 * interface.
 *
 * Usage:
 * ```ts
 * import OpenAI from 'openai';
 * import { GovernedOpenAI } from '@aumos/governance';
 *
 * const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
 * const governed = new GovernedOpenAI(openai, { trustLevel: 3, audit: true });
 *
 * const response = await governed.chat.completions.create({
 *   model: 'gpt-4o',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * ```
 */

import { z } from 'zod';
import { GovernanceError } from '../errors.js';
import { createGovernedAI } from './vercel-ai.js';
import type { GovernanceMiddlewareResult, BeforeRequestParams } from './vercel-ai.js';

// ---------------------------------------------------------------------------
// Structural interfaces — avoids a hard dependency on the openai package
// ---------------------------------------------------------------------------

/** Minimal structural type for an OpenAI chat message. */
export interface OpenAIChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
  readonly content: string | null;
  readonly name?: string;
}

/** Minimal structural type for OpenAI chat completion request params. */
export interface OpenAIChatCompletionParams {
  readonly model: string;
  readonly messages: readonly OpenAIChatMessage[];
  readonly max_tokens?: number;
  readonly temperature?: number;
  readonly stream?: boolean;
  readonly [key: string]: unknown;
}

/**
 * Structural interface for the subset of an OpenAI client that
 * `GovernedOpenAI` wraps.  The actual `OpenAI` class satisfies this
 * interface at runtime.
 */
export interface OpenAIClientLike {
  readonly chat: {
    readonly completions: {
      create(params: OpenAIChatCompletionParams): Promise<unknown>;
    };
  };
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for GovernedOpenAI configuration.
 *
 * Extends the base Vercel AI governance config with an optional
 * `minimumTrustLevel` that the caller's configured trustLevel must meet or
 * exceed.  If the configured level is below `minimumTrustLevel` every
 * request is denied immediately.
 */
export const GovernedOpenAIConfigSchema = z.object({
  /**
   * Trust tier (0–5) under which this OpenAI client operates.
   * Default: 2 (L2_SUGGEST).
   */
  trustLevel: z.number().int().min(0).max(5).default(2),
  /**
   * Minimum trust level required to call the OpenAI API via this wrapper.
   * Requests from clients with a lower trustLevel are denied.
   * Default: 1 (L1_MONITOR — any active agent may query).
   */
  minimumTrustLevel: z.number().int().min(0).max(5).default(1),
  /** Optional static spending caps in USD. */
  budget: z
    .object({
      daily: z.number().positive().optional(),
      hourly: z.number().positive().optional(),
      perRequest: z.number().positive().optional(),
    })
    .optional(),
  /** Record governance decisions in the audit trail.  Default true. */
  audit: z.boolean().default(true),
  /**
   * Action taken when a request is denied.
   * Default: 'throw'.
   */
  onDeny: z.enum(['throw', 'return_empty', 'log_only']).default('throw'),
});

/** Parsed type for GovernedOpenAIConfigSchema. */
export type GovernedOpenAIConfig = z.infer<typeof GovernedOpenAIConfigSchema>;

// ---------------------------------------------------------------------------
// Audit record
// ---------------------------------------------------------------------------

/** An OpenAI-specific governance audit record. */
export interface OpenAIGovernanceAuditRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly allowed: boolean;
  readonly model: string;
  readonly estimatedInputMessages: number;
  readonly maxTokens: number | undefined;
  readonly middlewareResult: GovernanceMiddlewareResult;
}

// ---------------------------------------------------------------------------
// GovernedOpenAI
// ---------------------------------------------------------------------------

/**
 * Proxy wrapper around an OpenAI client that enforces AumOS governance on
 * every `chat.completions.create()` call.
 *
 * The class does not subclass or extend the OpenAI SDK to avoid coupling
 * to its internal structure.  It exposes a `chat.completions.create()`
 * surface that mirrors the OpenAI SDK API while intercepting each call.
 */
export class GovernedOpenAI {
  readonly #client: OpenAIClientLike;
  readonly #config: GovernedOpenAIConfig;
  readonly #auditLog: OpenAIGovernanceAuditRecord[] = [];

  /** Governs budget tracking and audit recording via shared middleware. */
  readonly #middleware: ReturnType<typeof createGovernedAI>;

  /** Public `chat.completions` namespace, matching the OpenAI SDK surface. */
  readonly chat: {
    readonly completions: {
      /**
       * Creates a chat completion after passing the request through
       * governance controls.
       *
       * @throws {GovernanceDeniedError} when governance denies the request and
       *   `onDeny` is 'throw'.
       * @throws {TrustLevelInsufficientError} when the configured `trustLevel`
       *   is below `minimumTrustLevel`.
       */
      create(params: OpenAIChatCompletionParams): Promise<unknown>;
    };
  };

  constructor(client: OpenAIClientLike, config: Partial<GovernedOpenAIConfig> = {}) {
    this.#client = client;
    this.#config = GovernedOpenAIConfigSchema.parse(config);
    this.#middleware = createGovernedAI({
      trustLevel: this.#config.trustLevel,
      budget: this.#config.budget,
      audit: this.#config.audit,
      onDeny: this.#config.onDeny,
    });

    // Bind the chat namespace to `this` so the closure captures the instance.
    this.chat = {
      completions: {
        create: (params: OpenAIChatCompletionParams) => this.#interceptCreate(params),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Public helpers
  // -------------------------------------------------------------------------

  /**
   * Returns all governance audit records for calls made through this instance.
   */
  getAuditLog(): readonly OpenAIGovernanceAuditRecord[] {
    return [...this.#auditLog];
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Intercepts a `chat.completions.create()` call, runs governance checks,
   * then forwards to the underlying client when permitted.
   */
  async #interceptCreate(params: OpenAIChatCompletionParams): Promise<unknown> {
    // ------------------------------------------------------------------
    // Step 1: Trust level gate
    // ------------------------------------------------------------------
    if (this.#config.trustLevel < this.#config.minimumTrustLevel) {
      const reason =
        `OpenAI call denied: configured trustLevel ${this.#config.trustLevel} ` +
        `is below the required minimumTrustLevel ${this.#config.minimumTrustLevel}.`;

      if (this.#config.onDeny === 'throw') {
        throw new TrustLevelInsufficientError(
          this.#config.trustLevel,
          this.#config.minimumTrustLevel,
        );
      }

      if (this.#config.onDeny === 'log_only') {
        // Trust check failed but log_only — fall through to the real call.
        this.#appendAuditRecord({
          model: params.model,
          messages: params.messages,
          maxTokens: params.max_tokens,
          middlewareResult: {
            allowed: false,
            trustLevel: this.#config.trustLevel,
            budgetRemaining: undefined,
            auditRecordId: crypto.randomUUID(),
            denialReason: reason,
          },
        });
        return this.#client.chat.completions.create(params);
      }

      // 'return_empty' — return an empty-content response stub
      const emptyResult: GovernanceMiddlewareResult = {
        allowed: false,
        trustLevel: this.#config.trustLevel,
        budgetRemaining: undefined,
        auditRecordId: crypto.randomUUID(),
        denialReason: reason,
      };
      this.#appendAuditRecord({
        model: params.model,
        messages: params.messages,
        maxTokens: params.max_tokens,
        middlewareResult: emptyResult,
      });
      return buildEmptyOpenAIResponse(params.model, reason);
    }

    // ------------------------------------------------------------------
    // Step 2: Budget and middleware governance check
    // ------------------------------------------------------------------
    const middlewareParams: BeforeRequestParams = {
      model: params.model,
      maxTokens: params.max_tokens,
      prompt: params.messages as unknown[],
    };

    const middlewareResult = await this.#middleware.beforeRequest(middlewareParams);

    this.#appendAuditRecord({
      model: params.model,
      messages: params.messages,
      maxTokens: params.max_tokens,
      middlewareResult,
    });

    if (!middlewareResult.allowed) {
      // onDeny was 'return_empty' (throw was already handled inside middleware)
      return buildEmptyOpenAIResponse(
        params.model,
        middlewareResult.denialReason ?? 'Governance denied the request.',
      );
    }

    // ------------------------------------------------------------------
    // Step 3: Forward to underlying client
    // ------------------------------------------------------------------
    return this.#client.chat.completions.create(params);
  }

  /** Appends an audit record to the internal log. */
  #appendAuditRecord(entry: {
    model: string;
    messages: readonly OpenAIChatMessage[];
    maxTokens: number | undefined;
    middlewareResult: GovernanceMiddlewareResult;
  }): void {
    if (!this.#config.audit) return;

    const record: OpenAIGovernanceAuditRecord = {
      id: entry.middlewareResult.auditRecordId,
      timestamp: new Date().toISOString(),
      allowed: entry.middlewareResult.allowed,
      model: entry.model,
      estimatedInputMessages: entry.messages.length,
      maxTokens: entry.maxTokens,
      middlewareResult: entry.middlewareResult,
    };

    this.#auditLog.push(record);
  }
}

// ---------------------------------------------------------------------------
// TrustLevelInsufficientError
// ---------------------------------------------------------------------------

/**
 * Thrown when the configured `trustLevel` on a GovernedOpenAI or
 * GovernedAnthropic instance is below the `minimumTrustLevel` required to
 * make API calls.
 */
export class TrustLevelInsufficientError extends GovernanceError {
  readonly currentLevel: number;
  readonly requiredLevel: number;

  constructor(currentLevel: number, requiredLevel: number) {
    super(
      'TRUST_LEVEL_INSUFFICIENT',
      `Trust level ${currentLevel} is insufficient; minimum required is ${requiredLevel}.`,
    );
    this.name = 'TrustLevelInsufficientError';
    this.currentLevel = currentLevel;
    this.requiredLevel = requiredLevel;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a structurally valid but content-empty OpenAI chat completion
 * response object.  Used when `onDeny` is 'return_empty'.
 */
function buildEmptyOpenAIResponse(
  model: string,
  denialReason: string,
): Record<string, unknown> {
  return {
    id: `chatcmpl-governance-denied-${crypto.randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1_000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '',
        },
        finish_reason: 'governance_denied',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    governance: { denied: true, reason: denialReason },
  };
}
