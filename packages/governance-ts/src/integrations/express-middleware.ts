// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Express Governance Middleware
 *
 * Provides a `governanceMiddleware` factory for Express (and any framework
 * that shares the `(req, res, next)` signature, such as Connect).
 *
 * The middleware attaches a `governance` context object to the incoming
 * request before handing control to the next handler.  Downstream route
 * handlers can read `req.governance` to obtain the trust level, budget
 * configuration, and a unique request identifier for this HTTP request.
 *
 * Trust assignment and budget limits are STATIC: they are set at middleware
 * construction time and do not change based on request content.
 *
 * Usage:
 * ```ts
 * import express from 'express';
 * import { governanceMiddleware } from '@aumos/governance';
 *
 * const app = express();
 * app.use(governanceMiddleware({ trustLevel: 3, budget: { hourly: 10.00 } }));
 *
 * app.get('/api/ai', (req, res) => {
 *   const gov = (req as GovernanceRequest).governance;
 *   console.log(gov.trustLevel, gov.requestId);
 *   res.json({ ok: true });
 * });
 * ```
 */

// ---------------------------------------------------------------------------
// Structural interfaces — avoids a hard dependency on `express` types
// ---------------------------------------------------------------------------

/**
 * Minimal structural interface for an Express-compatible request object.
 * The actual `express.Request` type satisfies this at runtime.
 */
export interface ExpressRequest {
  [key: string]: unknown;
}

/**
 * Minimal structural interface for an Express-compatible response object.
 * The actual `express.Response` type satisfies this at runtime.
 */
export interface ExpressResponse {
  [key: string]: unknown;
}

/** Signature for an Express/Connect next function. */
export type ExpressNextFunction = (error?: unknown) => void;

// ---------------------------------------------------------------------------
// Governance context
// ---------------------------------------------------------------------------

/**
 * Governance context attached to each request by `governanceMiddleware`.
 *
 * Accessible as `(req as GovernanceRequest).governance` in downstream
 * route handlers.
 */
export interface RequestGovernanceContext {
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
   * Use this to correlate governance audit records with HTTP access logs.
   */
  readonly requestId: string;
  /**
   * ISO 8601 timestamp of when the middleware attached this context.
   * Suitable for request-latency measurement.
   */
  readonly governanceAttachedAt: string;
}

/** An Express request extended with the AumOS governance context. */
export interface GovernanceRequest extends ExpressRequest {
  readonly governance: RequestGovernanceContext;
}

// ---------------------------------------------------------------------------
// Middleware config
// ---------------------------------------------------------------------------

/**
 * Configuration for `governanceMiddleware`.
 *
 * Both `trustLevel` and `budget` are applied statically — they are set once
 * at middleware construction and are the same for every request.  There is no
 * per-request dynamic trust assignment at this layer.
 */
export interface ExpressGovernanceMiddlewareConfig {
  /**
   * Trust tier (0–5) to attach to every request.
   * Downstream handlers may use this value to gate specific operations.
   */
  trustLevel: number;
  /**
   * Optional static spending caps in USD.
   * Downstream AI calls can read these values to initialise a GovernedAI
   * middleware instance per-request.
   */
  budget?: {
    daily?: number;
    hourly?: number;
    perRequest?: number;
  };
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Creates an Express (Connect-compatible) governance middleware function.
 *
 * The middleware:
 *   1. Validates that `trustLevel` is an integer in the range [0, 5].
 *   2. Generates a UUID v4 `requestId` for correlation.
 *   3. Attaches a `governance` context object to the request.
 *   4. Calls `next()` to hand control to the next handler.
 *
 * The middleware never calls `res.end()` or short-circuits a request — all
 * gating decisions are left to downstream handlers that read `req.governance`.
 *
 * @param config - Static governance configuration applied to all requests.
 * @returns Express-compatible middleware function.
 *
 * @example
 * ```ts
 * app.use(governanceMiddleware({ trustLevel: 2 }));
 * app.use(governanceMiddleware({ trustLevel: 4, budget: { hourly: 5.00 } }));
 * ```
 */
export function governanceMiddleware(
  config: ExpressGovernanceMiddlewareConfig,
): (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => void {
  // Validate trust level at construction time so misconfiguration is caught early.
  if (!Number.isInteger(config.trustLevel) || config.trustLevel < 0 || config.trustLevel > 5) {
    throw new RangeError(
      `governanceMiddleware: trustLevel must be an integer in [0, 5], ` +
        `received ${String(config.trustLevel)}.`,
    );
  }

  const frozenBudget =
    config.budget !== undefined
      ? Object.freeze({ ...config.budget })
      : undefined;

  return function expressGovernanceMiddleware(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: ExpressNextFunction,
  ): void {
    const context: RequestGovernanceContext = {
      trustLevel: config.trustLevel,
      budget: frozenBudget,
      requestId: crypto.randomUUID(),
      governanceAttachedAt: new Date().toISOString(),
    };

    // Attach to request using index-signature access to avoid requiring the
    // express type package as a hard dependency.
    (req as Record<string, unknown>)['governance'] = context;

    next();
  };
}
