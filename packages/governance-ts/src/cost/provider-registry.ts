// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Model Pricing Registry
 *
 * `ModelPricingRegistry` maintains a lookup table of per-model pricing,
 * pre-seeded with built-in defaults for major models as of early 2026.
 *
 * Pricing data is static and must be updated manually when providers change
 * their rates.  No automated price fetching is performed — this is a simple
 * in-memory registry.
 *
 * Built-in models (prices in USD per 1k tokens, as of early 2026):
 *
 * OpenAI:
 *   gpt-4o              — $0.0025 in / $0.010 out
 *   gpt-4o-mini         — $0.00015 in / $0.0006 out
 *   gpt-4-turbo         — $0.010 in / $0.030 out
 *   gpt-3.5-turbo       — $0.0005 in / $0.0015 out
 *   o1                  — $0.015 in / $0.060 out
 *   o1-mini             — $0.003 in / $0.012 out
 *   o3-mini             — $0.0011 in / $0.0044 out
 *
 * Anthropic:
 *   claude-3-5-sonnet-20241022  — $0.003 in / $0.015 out
 *   claude-3-5-haiku-20241022   — $0.0008 in / $0.004 out
 *   claude-3-opus-20240229      — $0.015 in / $0.075 out
 *   claude-3-haiku-20240307     — $0.00025 in / $0.00125 out
 *   claude-sonnet-4-6           — $0.003 in / $0.015 out
 *   claude-opus-4-6             — $0.015 in / $0.075 out
 *
 * Google:
 *   gemini-1.5-pro              — $0.00125 in / $0.005 out
 *   gemini-1.5-flash            — $0.000075 in / $0.0003 out
 *   gemini-2.0-flash            — $0.0001 in / $0.0004 out
 *   gemini-2.0-flash-thinking   — $0.000035 in / $0.00035 out
 *
 * Mistral:
 *   mistral-large-2411          — $0.002 in / $0.006 out
 *   mistral-small-2409          — $0.0002 in / $0.0006 out
 *   codestral-2405              — $0.001 in / $0.003 out
 *
 * Cohere:
 *   command-r-plus              — $0.003 in / $0.015 out
 *   command-r                   — $0.00015 in / $0.0006 out
 */

import type { ModelPricing, ModelProvider } from './types.js';

// ---------------------------------------------------------------------------
// Registry key helpers
// ---------------------------------------------------------------------------

function registryKey(provider: string, modelId: string): string {
  return `${provider}::${modelId}`;
}

// ---------------------------------------------------------------------------
// Built-in pricing defaults
// ---------------------------------------------------------------------------

/**
 * Built-in model pricing as of early 2026.
 *
 * Prices are in USD per 1,000 tokens.  These are best-effort approximations
 * and should be overridden with `ModelPricingRegistry.register()` if
 * precision is required.
 */
const BUILTIN_PRICING: readonly ModelPricing[] = [
  // --- OpenAI ---
  {
    provider: 'openai',
    modelId: 'gpt-4o',
    inputCostPer1kTokens: 0.0025,
    outputCostPer1kTokens: 0.01,
    currency: 'USD',
  },
  {
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    inputCostPer1kTokens: 0.00015,
    outputCostPer1kTokens: 0.0006,
    currency: 'USD',
  },
  {
    provider: 'openai',
    modelId: 'gpt-4-turbo',
    inputCostPer1kTokens: 0.01,
    outputCostPer1kTokens: 0.03,
    currency: 'USD',
  },
  {
    provider: 'openai',
    modelId: 'gpt-3.5-turbo',
    inputCostPer1kTokens: 0.0005,
    outputCostPer1kTokens: 0.0015,
    currency: 'USD',
  },
  {
    provider: 'openai',
    modelId: 'o1',
    inputCostPer1kTokens: 0.015,
    outputCostPer1kTokens: 0.06,
    currency: 'USD',
  },
  {
    provider: 'openai',
    modelId: 'o1-mini',
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.012,
    currency: 'USD',
  },
  {
    provider: 'openai',
    modelId: 'o3-mini',
    inputCostPer1kTokens: 0.0011,
    outputCostPer1kTokens: 0.0044,
    currency: 'USD',
  },

  // --- Anthropic ---
  {
    provider: 'anthropic',
    modelId: 'claude-3-5-sonnet-20241022',
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    currency: 'USD',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-3-5-haiku-20241022',
    inputCostPer1kTokens: 0.0008,
    outputCostPer1kTokens: 0.004,
    currency: 'USD',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-3-opus-20240229',
    inputCostPer1kTokens: 0.015,
    outputCostPer1kTokens: 0.075,
    currency: 'USD',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-3-haiku-20240307',
    inputCostPer1kTokens: 0.00025,
    outputCostPer1kTokens: 0.00125,
    currency: 'USD',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    currency: 'USD',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-opus-4-6',
    inputCostPer1kTokens: 0.015,
    outputCostPer1kTokens: 0.075,
    currency: 'USD',
  },

  // --- Google ---
  {
    provider: 'google',
    modelId: 'gemini-1.5-pro',
    inputCostPer1kTokens: 0.00125,
    outputCostPer1kTokens: 0.005,
    currency: 'USD',
  },
  {
    provider: 'google',
    modelId: 'gemini-1.5-flash',
    inputCostPer1kTokens: 0.000075,
    outputCostPer1kTokens: 0.0003,
    currency: 'USD',
  },
  {
    provider: 'google',
    modelId: 'gemini-2.0-flash',
    inputCostPer1kTokens: 0.0001,
    outputCostPer1kTokens: 0.0004,
    currency: 'USD',
  },
  {
    provider: 'google',
    modelId: 'gemini-2.0-flash-thinking',
    inputCostPer1kTokens: 0.000035,
    outputCostPer1kTokens: 0.00035,
    currency: 'USD',
  },

  // --- Mistral ---
  {
    provider: 'mistral',
    modelId: 'mistral-large-2411',
    inputCostPer1kTokens: 0.002,
    outputCostPer1kTokens: 0.006,
    currency: 'USD',
  },
  {
    provider: 'mistral',
    modelId: 'mistral-small-2409',
    inputCostPer1kTokens: 0.0002,
    outputCostPer1kTokens: 0.0006,
    currency: 'USD',
  },
  {
    provider: 'mistral',
    modelId: 'codestral-2405',
    inputCostPer1kTokens: 0.001,
    outputCostPer1kTokens: 0.003,
    currency: 'USD',
  },

  // --- Cohere ---
  {
    provider: 'cohere',
    modelId: 'command-r-plus',
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    currency: 'USD',
  },
  {
    provider: 'cohere',
    modelId: 'command-r',
    inputCostPer1kTokens: 0.00015,
    outputCostPer1kTokens: 0.0006,
    currency: 'USD',
  },
];

// ---------------------------------------------------------------------------
// ModelPricingRegistry
// ---------------------------------------------------------------------------

/**
 * Registry for model pricing data.
 *
 * Pre-seeded with built-in defaults for major providers.  Custom models
 * (including fine-tuned or private deployments) can be registered via
 * `register()`.
 *
 * @example
 * ```ts
 * const registry = new ModelPricingRegistry();
 *
 * // Register a custom fine-tuned model.
 * registry.register({
 *   provider: 'custom',
 *   modelId: 'my-fine-tuned-gpt-4o',
 *   inputCostPer1kTokens: 0.005,
 *   outputCostPer1kTokens: 0.015,
 *   currency: 'USD',
 * });
 *
 * const pricing = registry.lookup('custom', 'my-fine-tuned-gpt-4o');
 * ```
 */
export class ModelPricingRegistry {
  readonly #entries: Map<string, ModelPricing>;

  constructor() {
    this.#entries = new Map();
    // Seed with built-in defaults.
    for (const pricing of BUILTIN_PRICING) {
      this.#entries.set(registryKey(pricing.provider, pricing.modelId), pricing);
    }
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Registers or updates pricing for a model.
   *
   * When a record for the same `provider` + `modelId` combination already
   * exists (including built-in defaults), it is replaced.
   *
   * @param pricing - The pricing record to register.
   */
  register(pricing: ModelPricing): void {
    this.#entries.set(registryKey(pricing.provider, pricing.modelId), pricing);
  }

  /**
   * Registers pricing for multiple models at once.
   *
   * @param pricingList - An array of pricing records to register.
   */
  registerAll(pricingList: readonly ModelPricing[]): void {
    for (const pricing of pricingList) {
      this.register(pricing);
    }
  }

  // -------------------------------------------------------------------------
  // Lookup
  // -------------------------------------------------------------------------

  /**
   * Looks up pricing for a specific provider + model combination.
   *
   * Returns `undefined` when no pricing record is registered for the
   * given combination.  Callers should handle the `undefined` case — for
   * example, by recording usage with `estimatedCost: 0` and flagging it for
   * manual review.
   *
   * @param provider - The model provider.
   * @param modelId  - The provider-specific model identifier.
   */
  lookup(provider: ModelProvider | string, modelId: string): ModelPricing | undefined {
    return this.#entries.get(registryKey(provider, modelId));
  }

  /**
   * Returns true if pricing is registered for the given provider + model.
   *
   * @param provider - The model provider.
   * @param modelId  - The provider-specific model identifier.
   */
  has(provider: ModelProvider | string, modelId: string): boolean {
    return this.#entries.has(registryKey(provider, modelId));
  }

  /**
   * Returns all registered pricing records as a read-only array.
   *
   * The order of entries is not guaranteed.
   */
  listAll(): readonly ModelPricing[] {
    return Array.from(this.#entries.values());
  }

  /**
   * Returns all registered pricing records for a specific provider.
   *
   * @param provider - The provider to filter by.
   */
  listByProvider(provider: ModelProvider | string): readonly ModelPricing[] {
    return Array.from(this.#entries.values()).filter(
      (pricing) => pricing.provider === provider,
    );
  }

  // -------------------------------------------------------------------------
  // Cost computation
  // -------------------------------------------------------------------------

  /**
   * Computes the estimated cost for an LLM call given token counts.
   *
   * Returns `undefined` if no pricing record is registered for the given
   * provider + model combination.
   *
   * @param provider     - The model provider.
   * @param modelId      - The provider-specific model identifier.
   * @param inputTokens  - Number of input (prompt) tokens.
   * @param outputTokens - Number of output (completion) tokens.
   */
  computeCost(
    provider: ModelProvider | string,
    modelId: string,
    inputTokens: number,
    outputTokens: number,
  ): number | undefined {
    const pricing = this.lookup(provider, modelId);
    if (pricing === undefined) {
      return undefined;
    }
    const inputCost = (inputTokens / 1000) * pricing.inputCostPer1kTokens;
    const outputCost = (outputTokens / 1000) * pricing.outputCostPer1kTokens;
    return inputCost + outputCost;
  }
}
