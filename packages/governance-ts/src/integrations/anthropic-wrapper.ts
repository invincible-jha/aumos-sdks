// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Anthropic SDK Governance Wrapper
 *
 * `GovernedAnthropic` wraps an Anthropic SDK client instance using the Proxy
 * pattern.  Every call to `messages.create()` is intercepted and passed
 * through AumOS governance controls before being forwarded to the underlying
 * client.
 *
 * Trust is checked against the configured `trustLevel`; budget is evaluated
 * against optional static spending caps; every decision is recorded in an
 * in-memory audit log.
 *
 * The wrapper does NOT import from the `@anthropic-ai/sdk` npm package so
 * that it can be used in environments where the Anthropic SDK is not
 * installed.  Instead it accepts the Anthropic client as an opaque object
 * typed via a structural interface.
 *
 * Usage:
 * ```ts
 * import Anthropic from '@anthropic-ai/sdk';
 * import { GovernedAnthropic } from '@aumos/governance';
 *
 * const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 * const governed = new GovernedAnthropic(anthropic, { trustLevel: 3, audit: true });
 *
 * const response = await governed.messages.create({
 *   model: 'claude-opus-4-6',
 *   max_tokens: 1024,
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * ```
 */

import { z } from 'zod';
import { createGovernedAI } from './vercel-ai.js';
import type { GovernanceMiddlewareResult, BeforeRequestParams } from './vercel-ai.js';
import { TrustLevelInsufficientError } from './openai-wrapper.js';

// ---------------------------------------------------------------------------
// Structural interfaces — avoids a hard dependency on @anthropic-ai/sdk
// ---------------------------------------------------------------------------

/** Minimal structural type for an Anthropic message content block. */
export type AnthropicContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly source: Record<string, unknown> }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'tool_result'; readonly tool_use_id: string; readonly content?: string | readonly AnthropicContentBlock[] };

/** A single message in an Anthropic conversation. */
export interface AnthropicMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly AnthropicContentBlock[];
}

/** Parameters for `messages.create()`. */
export interface AnthropicMessagesCreateParams {
  readonly model: string;
  readonly max_tokens: number;
  readonly messages: readonly AnthropicMessage[];
  readonly system?: string;
  readonly temperature?: number;
  readonly stream?: boolean;
  readonly [key: string]: unknown;
}

/**
 * Structural interface for the subset of an Anthropic client that
 * `GovernedAnthropic` wraps.  The actual `Anthropic` class satisfies
 * this interface at runtime.
 */
export interface AnthropicClientLike {
  readonly messages: {
    create(params: AnthropicMessagesCreateParams): Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for GovernedAnthropic configuration.
 *
 * Mirrors the GovernedOpenAI config schema; both extend the base Vercel AI
 * governance config with an optional `minimumTrustLevel`.
 */
export const GovernedAnthropicConfigSchema = z.object({
  /**
   * Trust tier (0–5) under which this Anthropic client operates.
   * Default: 2 (L2_SUGGEST).
   */
  trustLevel: z.number().int().min(0).max(5).default(2),
  /**
   * Minimum trust level required to call the Anthropic API via this wrapper.
   * Default: 1 (L1_MONITOR).
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

/** Parsed type for GovernedAnthropicConfigSchema. */
export type GovernedAnthropicConfig = z.infer<typeof GovernedAnthropicConfigSchema>;

// ---------------------------------------------------------------------------
// Audit record
// ---------------------------------------------------------------------------

/** An Anthropic-specific governance audit record. */
export interface AnthropicGovernanceAuditRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly allowed: boolean;
  readonly model: string;
  readonly maxTokens: number;
  readonly estimatedInputMessages: number;
  readonly middlewareResult: GovernanceMiddlewareResult;
}

// ---------------------------------------------------------------------------
// GovernedAnthropic
// ---------------------------------------------------------------------------

/**
 * Proxy wrapper around an Anthropic client that enforces AumOS governance on
 * every `messages.create()` call.
 *
 * The class does not subclass or extend the Anthropic SDK to avoid coupling
 * to its internal structure.  It exposes a `messages.create()` surface that
 * mirrors the Anthropic SDK API while intercepting each call.
 */
export class GovernedAnthropic {
  readonly #client: AnthropicClientLike;
  readonly #config: GovernedAnthropicConfig;
  readonly #auditLog: AnthropicGovernanceAuditRecord[] = [];

  /** Governs budget tracking and audit recording via shared middleware. */
  readonly #middleware: ReturnType<typeof createGovernedAI>;

  /** Public `messages` namespace, matching the Anthropic SDK surface. */
  readonly messages: {
    /**
     * Creates a message after passing the request through governance controls.
     *
     * @throws {GovernanceDeniedError} when governance denies the request and
     *   `onDeny` is 'throw'.
     * @throws {TrustLevelInsufficientError} when the configured `trustLevel`
     *   is below `minimumTrustLevel`.
     */
    create(params: AnthropicMessagesCreateParams): Promise<unknown>;
  };

  constructor(client: AnthropicClientLike, config: Partial<GovernedAnthropicConfig> = {}) {
    this.#client = client;
    this.#config = GovernedAnthropicConfigSchema.parse(config);
    this.#middleware = createGovernedAI({
      trustLevel: this.#config.trustLevel,
      budget: this.#config.budget,
      audit: this.#config.audit,
      onDeny: this.#config.onDeny,
    });

    // Bind the messages namespace to `this` so the closure captures the instance.
    this.messages = {
      create: (params: AnthropicMessagesCreateParams) => this.#interceptCreate(params),
    };
  }

  // -------------------------------------------------------------------------
  // Public helpers
  // -------------------------------------------------------------------------

  /**
   * Returns all governance audit records for calls made through this instance.
   */
  getAuditLog(): readonly AnthropicGovernanceAuditRecord[] {
    return [...this.#auditLog];
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Intercepts a `messages.create()` call, runs governance checks, then
   * forwards to the underlying client when permitted.
   */
  async #interceptCreate(params: AnthropicMessagesCreateParams): Promise<unknown> {
    // ------------------------------------------------------------------
    // Step 1: Trust level gate
    // ------------------------------------------------------------------
    if (this.#config.trustLevel < this.#config.minimumTrustLevel) {
      const reason =
        `Anthropic call denied: configured trustLevel ${this.#config.trustLevel} ` +
        `is below the required minimumTrustLevel ${this.#config.minimumTrustLevel}.`;

      if (this.#config.onDeny === 'throw') {
        throw new TrustLevelInsufficientError(
          this.#config.trustLevel,
          this.#config.minimumTrustLevel,
        );
      }

      const denyResult: GovernanceMiddlewareResult = {
        allowed: false,
        trustLevel: this.#config.trustLevel,
        budgetRemaining: undefined,
        auditRecordId: crypto.randomUUID(),
        denialReason: reason,
      };

      this.#appendAuditRecord({
        model: params.model,
        maxTokens: params.max_tokens,
        messages: params.messages,
        middlewareResult: denyResult,
      });

      if (this.#config.onDeny === 'log_only') {
        // Trust check failed but log_only — fall through to the real call.
        return this.#client.messages.create(params);
      }

      return buildEmptyAnthropicResponse(params.model, reason);
    }

    // ------------------------------------------------------------------
    // Step 2: Budget and middleware governance check
    // ------------------------------------------------------------------
    const prompt = buildAnthropicPromptText(params);

    const middlewareParams: BeforeRequestParams = {
      model: params.model,
      maxTokens: params.max_tokens,
      prompt,
    };

    const middlewareResult = await this.#middleware.beforeRequest(middlewareParams);

    this.#appendAuditRecord({
      model: params.model,
      maxTokens: params.max_tokens,
      messages: params.messages,
      middlewareResult,
    });

    if (!middlewareResult.allowed) {
      // onDeny was 'return_empty' (throw was already handled inside middleware)
      return buildEmptyAnthropicResponse(
        params.model,
        middlewareResult.denialReason ?? 'Governance denied the request.',
      );
    }

    // ------------------------------------------------------------------
    // Step 3: Forward to underlying client
    // ------------------------------------------------------------------
    return this.#client.messages.create(params);
  }

  /** Appends an audit record to the internal log. */
  #appendAuditRecord(entry: {
    model: string;
    maxTokens: number;
    messages: readonly AnthropicMessage[];
    middlewareResult: GovernanceMiddlewareResult;
  }): void {
    if (!this.#config.audit) return;

    const record: AnthropicGovernanceAuditRecord = {
      id: entry.middlewareResult.auditRecordId,
      timestamp: new Date().toISOString(),
      allowed: entry.middlewareResult.allowed,
      model: entry.model,
      maxTokens: entry.maxTokens,
      estimatedInputMessages: entry.messages.length,
      middlewareResult: entry.middlewareResult,
    };

    this.#auditLog.push(record);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a flat text representation of an Anthropic messages array for
 * token estimation purposes.
 */
function buildAnthropicPromptText(params: AnthropicMessagesCreateParams): string {
  const parts: string[] = [];

  if (typeof params.system === 'string') {
    parts.push(params.system);
  }

  for (const message of params.messages) {
    if (typeof message.content === 'string') {
      parts.push(message.content);
    } else {
      for (const block of message.content) {
        if (block.type === 'text') {
          parts.push(block.text);
        }
      }
    }
  }

  return parts.join('\n');
}

/**
 * Builds a structurally valid but content-empty Anthropic messages response
 * object.  Used when `onDeny` is 'return_empty'.
 */
function buildEmptyAnthropicResponse(
  model: string,
  denialReason: string,
): Record<string, unknown> {
  return {
    id: `msg_governance_denied_${crypto.randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [],
    stop_reason: 'governance_denied',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    governance: { denied: true, reason: denialReason },
  };
}

// Re-export GovernanceDeniedError so callers can catch it without importing vercel-ai.ts directly.
export { GovernanceDeniedError } from './vercel-ai.js';
export { TrustLevelInsufficientError } from './openai-wrapper.js';
