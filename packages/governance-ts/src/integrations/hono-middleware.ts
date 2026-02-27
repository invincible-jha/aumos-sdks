// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Hono Governance Middleware
 *
 * Provides a `governanceHonoMiddleware` factory for the Hono web framework.
 * The middleware uses `c.set()` to attach a governance context object to
 * each request's context store before passing control to the next handler.
 *
 * Trust assignment and budget limits are STATIC: they are set at middleware
 * construction time and do not change based on request content.
 *
 * Usage:
 * ```ts
 * import { Hono } from 'hono';
 * import { governanceHonoMiddleware } from '@aumos/governance';
 *
 * const app = new Hono();
 * app.use('*', governanceHonoMiddleware({ trustLevel: 3, budget: { hourly: 10.00 } }));
 *
 * app.get('/api/ai', (c) => {
 *   const gov = c.get('governance');
 *   return c.json({ trustLevel: gov.trustLevel, requestId: gov.requestId });
 * });
 * ```
 *
 * TypeScript augmentation (add to your Hono app type declarations):
 * ```ts
 * type AppVariables = {
 *   governance: import('@aumos/governance').HonoGovernanceContext;
 * };
 * const app = new Hono<{ Variables: AppVariables }>();
 * ```
 */

// ---------------------------------------------------------------------------
// Structural interfaces — avoids a hard dependency on the `hono` package
// ---------------------------------------------------------------------------

/**
 * Minimal structural interface for a Hono context object.
 * The actual `Context` type satisfies this at runtime.
 */
export interface HonoContextLike {
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  [key: string]: unknown;
}

/** Signature for a Hono `Next` function. */
export type HonoNext = () => Promise<void>;

/** Hono middleware handler type. */
export type HonoMiddlewareHandler = (c: HonoContextLike, next: HonoNext) => Promise<Response | void>;

// ---------------------------------------------------------------------------
// Governance context
// ---------------------------------------------------------------------------

/**
 * Governance context stored in the Hono context via `c.set('governance', ...)`.
 *
 * Accessible downstream as `c.get('governance')`.
 */
export interface HonoGovernanceContext {
  /** The trust tier (0–5) configured for this middleware instance. */
  readonly trustLevel: number;
  /**
   * Static budget caps (USD) configured for this middleware instance.
   * Undefined when no budget is configured.
   */
  readonly budget:
    | {
        readonly daily?: number;
        readonly hourly?: number;
        readonly perRequest?: number;
      }
    | undefined;
  /**
   * Unique identifier (UUID v4) generated per-request.
   * Use this to correlate governance audit records with Hono access logs.
   */
  readonly requestId: string;
  /**
   * ISO 8601 timestamp of when the middleware attached this context.
   */
  readonly governanceAttachedAt: string;
}

// ---------------------------------------------------------------------------
// Middleware config
// ---------------------------------------------------------------------------

/**
 * Configuration for `governanceHonoMiddleware`.
 */
export interface HonoGovernanceMiddlewareConfig {
  /**
   * Trust tier (0–5) to store in the Hono context for every request.
   */
  trustLevel: number;
  /**
   * Optional static spending caps in USD.
   */
  budget?: {
    daily?: number;
    hourly?: number;
    perRequest?: number;
  };
  /**
   * The key used with `c.set()` / `c.get()` to store the governance context.
   * Defaults to 'governance'.
   */
  contextKey?: string;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates a Hono-compatible governance middleware function.
 *
 * The middleware:
 *   1. Validates that `trustLevel` is an integer in the range [0, 5].
 *   2. Generates a UUID v4 `requestId` for each request.
 *   3. Calls `c.set(contextKey, context)` to attach the governance context.
 *   4. Calls `await next()` to pass control to the next handler.
 *
 * The middleware never short-circuits or returns a `Response` — all gating
 * decisions are left to downstream handlers that read the governance context.
 *
 * @param config - Static governance configuration applied to all requests.
 * @returns Hono-compatible async middleware function.
 *
 * @example
 * ```ts
 * app.use('*', governanceHonoMiddleware({ trustLevel: 2 }));
 * app.use('/api/*', governanceHonoMiddleware({
 *   trustLevel: 4,
 *   budget: { hourly: 5.00, perRequest: 0.10 },
 * }));
 * ```
 */
export function governanceHonoMiddleware(
  config: HonoGovernanceMiddlewareConfig,
): HonoMiddlewareHandler {
  // Validate at construction time so misconfiguration is caught early.
  if (!Number.isInteger(config.trustLevel) || config.trustLevel < 0 || config.trustLevel > 5) {
    throw new RangeError(
      `governanceHonoMiddleware: trustLevel must be an integer in [0, 5], ` +
        `received ${String(config.trustLevel)}.`,
    );
  }

  const contextKey = config.contextKey ?? 'governance';

  const frozenBudget =
    config.budget !== undefined ? Object.freeze({ ...config.budget }) : undefined;

  return async function honoGovernanceMiddleware(
    c: HonoContextLike,
    next: HonoNext,
  ): Promise<void> {
    const context: HonoGovernanceContext = {
      trustLevel: config.trustLevel,
      budget: frozenBudget,
      requestId: crypto.randomUUID(),
      governanceAttachedAt: new Date().toISOString(),
    };

    c.set(contextKey, context);

    await next();
  };
}
