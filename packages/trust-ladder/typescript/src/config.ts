// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { z } from "zod";

// ---------------------------------------------------------------------------
// Decay configuration
// ---------------------------------------------------------------------------

/**
 * Zod schema for decay configuration.
 *
 * Cliff decay:  trust drops to L0_OBSERVER when ttlMs elapses since assignment.
 * Gradual decay: trust decreases by one level for each stepIntervalMs that
 *                elapses since assignment. The floor is always L0_OBSERVER.
 *
 * Decay is one-directional — it only ever lowers the effective level.
 */
export const DecayConfigSchema = z.discriminatedUnion("type", [
  z.object({
    enabled: z.literal(true),
    type: z.literal("cliff"),
    /**
     * Milliseconds after assignment before trust drops to L0.
     * Must be a positive integer.
     */
    ttlMs: z.number().int().positive(),
  }),
  z.object({
    enabled: z.literal(true),
    type: z.literal("gradual"),
    /**
     * Milliseconds between each single-level decrease.
     * Must be a positive integer.
     */
    stepIntervalMs: z.number().int().positive(),
  }),
  z.object({
    enabled: z.literal(false),
    type: z.enum(["cliff", "gradual"]).optional(),
  }),
]);

export type DecayConfig = z.infer<typeof DecayConfigSchema>;

// ---------------------------------------------------------------------------
// Top-level TrustLadder configuration
// ---------------------------------------------------------------------------

export const TrustLadderConfigSchema = z.object({
  /**
   * Decay settings applied to every assignment in this ladder instance.
   * Defaults to disabled if omitted.
   */
  decay: DecayConfigSchema.optional(),

  /**
   * Default scope string applied when no scope is provided to API calls.
   * Defaults to an empty string (global scope).
   */
  defaultScope: z.string().optional(),

  /**
   * Maximum number of history entries retained per (agentId, scope) pair.
   * When exceeded, the oldest entries are dropped.
   * Set to 0 for unlimited. Defaults to 1000.
   */
  maxHistoryPerScope: z.number().int().nonnegative().optional(),
});

export type TrustLadderConfig = z.infer<typeof TrustLadderConfigSchema>;

// ---------------------------------------------------------------------------
// Resolved (defaulted) configuration
// ---------------------------------------------------------------------------

/** Internal fully-resolved configuration with all defaults applied. */
export interface ResolvedTrustLadderConfig {
  readonly decay: DecayConfig;
  readonly defaultScope: string;
  readonly maxHistoryPerScope: number;
}

/** Merge a partial config with defaults to produce a resolved config. */
export function resolveConfig(input: TrustLadderConfig | undefined): ResolvedTrustLadderConfig {
  const validated = input !== undefined ? TrustLadderConfigSchema.parse(input) : {};

  const decayDefault: DecayConfig = { enabled: false };

  return {
    decay: validated.decay ?? decayDefault,
    defaultScope: validated.defaultScope ?? "",
    maxHistoryPerScope: validated.maxHistoryPerScope ?? 1000,
  };
}
