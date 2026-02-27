// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Fastify Governance Plugin
 *
 * Provides a `governanceFastifyPlugin` compatible with Fastify's plugin system.
 * The plugin uses `fastify.decorate()` to attach governance context to the
 * Fastify instance and uses a `onRequest` hook to attach a per-request context
 * to each incoming request via `request.governance`.
 *
 * Trust assignment and budget limits are STATIC: they are set at plugin
 * registration time and do not change based on request content.
 *
 * Usage:
 * ```ts
 * import Fastify from 'fastify';
 * import { governanceFastifyPlugin } from '@aumos/governance';
 *
 * const app = Fastify();
 * await app.register(governanceFastifyPlugin, {
 *   trustLevel: 3,
 *   budget: { hourly: 10.00 },
 * });
 *
 * app.get('/api/ai', async (request, reply) => {
 *   const gov = request.governance;
 *   return { trustLevel: gov.trustLevel, requestId: gov.requestId };
 * });
 * ```
 *
 * TypeScript augmentation (add to your project's type declarations):
 * ```ts
 * declare module 'fastify' {
 *   interface FastifyRequest {
 *     governance: import('@aumos/governance').FastifyRequestGovernanceContext;
 *   }
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// Structural interfaces — avoids a hard dependency on `fastify` types
// ---------------------------------------------------------------------------

/**
 * Minimal structural interface for a Fastify request object.
 * The actual `FastifyRequest` type satisfies this at runtime.
 */
export interface FastifyRequestLike {
  [key: string]: unknown;
}

/**
 * Minimal structural interface for a Fastify reply object.
 * The actual `FastifyReply` type satisfies this at runtime.
 */
export interface FastifyReplyLike {
  [key: string]: unknown;
}

/**
 * Minimal structural interface for a Fastify instance.
 * The actual `FastifyInstance` type satisfies this at runtime.
 */
export interface FastifyInstanceLike {
  decorate(name: string, value: unknown): void;
  addHook(
    hookName: 'onRequest',
    handler: (request: FastifyRequestLike, reply: FastifyReplyLike, done: () => void) => void,
  ): void;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Governance context
// ---------------------------------------------------------------------------

/**
 * Governance context attached to each Fastify request.
 *
 * Accessible as `request.governance` in route handlers after the plugin is
 * registered.
 */
export interface FastifyRequestGovernanceContext {
  /** The trust tier (0–5) configured for this plugin instance. */
  readonly trustLevel: number;
  /**
   * Static budget caps (USD) configured for this plugin instance.
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
   * Use this to correlate governance audit records with Fastify access logs.
   */
  readonly requestId: string;
  /**
   * ISO 8601 timestamp of when the hook attached this context.
   */
  readonly governanceAttachedAt: string;
}

/**
 * Instance-level governance metadata decorated onto the Fastify instance.
 * Accessible as `fastify.governanceConfig` after plugin registration.
 */
export interface FastifyInstanceGovernanceConfig {
  readonly trustLevel: number;
  readonly budget:
    | {
        readonly daily?: number;
        readonly hourly?: number;
        readonly perRequest?: number;
      }
    | undefined;
}

// ---------------------------------------------------------------------------
// Plugin config
// ---------------------------------------------------------------------------

/**
 * Options passed when registering `governanceFastifyPlugin`.
 */
export interface FastifyGovernancePluginOptions {
  /**
   * Trust tier (0–5) attached to every request via `request.governance`.
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
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin that decorates the instance with `governanceConfig` and
 * attaches a `governance` context object to every request via an `onRequest`
 * hook.
 *
 * The plugin is designed to be registered with `fastify.register()` and is
 * compatible with `fastify-plugin` (fp) for scope-breaking if needed.
 *
 * @param fastify - The Fastify instance to register the plugin on.
 * @param options - Static governance configuration.
 * @param done    - Callback to signal registration completion.
 *
 * @example
 * ```ts
 * await app.register(governanceFastifyPlugin, { trustLevel: 2 });
 * ```
 */
export function governanceFastifyPlugin(
  fastify: FastifyInstanceLike,
  options: FastifyGovernancePluginOptions,
  done: () => void,
): void {
  // Validate trust level at registration time.
  if (!Number.isInteger(options.trustLevel) || options.trustLevel < 0 || options.trustLevel > 5) {
    done(
      new RangeError(
        `governanceFastifyPlugin: trustLevel must be an integer in [0, 5], ` +
          `received ${String(options.trustLevel)}.`,
      ),
    );
    return;
  }

  const frozenBudget =
    options.budget !== undefined ? Object.freeze({ ...options.budget }) : undefined;

  const instanceConfig: FastifyInstanceGovernanceConfig = Object.freeze({
    trustLevel: options.trustLevel,
    budget: frozenBudget,
  });

  // Decorate the Fastify instance with the static governance config.
  fastify.decorate('governanceConfig', instanceConfig);

  // Attach per-request governance context via onRequest lifecycle hook.
  fastify.addHook(
    'onRequest',
    (request: FastifyRequestLike, _reply: FastifyReplyLike, hookDone: () => void): void => {
      const context: FastifyRequestGovernanceContext = {
        trustLevel: options.trustLevel,
        budget: frozenBudget,
        requestId: crypto.randomUUID(),
        governanceAttachedAt: new Date().toISOString(),
      };

      (request as Record<string, unknown>)['governance'] = context;
      hookDone();
    },
  );

  done();
}

/**
 * Metadata object for use with `fastify-plugin` (optional peer dependency).
 *
 * When wrapping with `fp(governanceFastifyPlugin, pluginMeta)` the
 * decorations will be visible across Fastify encapsulation scopes.
 *
 * @example
 * ```ts
 * import fp from 'fastify-plugin';
 * import { governanceFastifyPlugin, governancePluginMeta } from '@aumos/governance';
 *
 * export default fp(governanceFastifyPlugin, governancePluginMeta);
 * ```
 */
export const governancePluginMeta = {
  fastify: '>=4.0.0',
  name: '@aumos/governance-fastify-plugin',
} as const;
