// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Streaming Governance
 *
 * `GovernedStream` wraps an `AsyncIterable<string>` (token stream) and
 * accumulates tokens into a buffer, running a governance check at configurable
 * intervals (every N tokens or N characters).  If governance denies, the stream
 * is cleanly halted and the consumer receives a `StreamHaltedError`.
 *
 * Governance evaluation is intentionally simple:
 *   - The caller supplies a `governanceCheck` callback that receives the
 *     accumulated content and token count, returning `{ allowed, reason?,
 *     filteredOutput? }`.
 *   - Returning `filteredOutput` in the result replaces the accumulated content
 *     with the redacted version (for PII scrubbing, etc.).
 *   - Hard limits (`maxTokens`, `maxChars`) are enforced before the callback,
 *     so callers do not need to duplicate those checks inside the callback.
 *   - This design keeps streaming.ts fully decoupled from specific budget or
 *     trust implementations; callers wire up their own GovernedAI instance.
 *
 * Usage:
 * ```ts
 * import { createGovernedStream } from '@aumos/governance';
 *
 * async function* tokenSource(): AsyncIterable<string> {
 *   for (const word of ['Hello', ' world', '!']) {
 *     yield word;
 *   }
 * }
 *
 * const governed = createGovernedStream(tokenSource(), {
 *   checkIntervalTokens: 10,
 *   governanceCheck: async (accumulated, tokenCount) => ({
 *     allowed: tokenCount < 100,
 *     reason: 'Token limit reached',
 *   }),
 * });
 *
 * for await (const token of governed) {
 *   process.stdout.write(token);
 * }
 * ```
 *
 * Legacy `ReadableStream`-based usage is also supported via the
 * `createGovernedStream` overload that accepts a `ReadableStream<Uint8Array |
 * string>` plus an `onChunk` callback config.  Both APIs share the same
 * `StreamHaltedError` and `GovernedStreamConfig` types but are implemented as
 * separate factory functions (`createGovernedStream` for
 * `AsyncIterable<string>`, `createGovernedReadableStream` for
 * `ReadableStream`-backed sources).
 */

import { GovernanceError } from './errors.js';

// ---------------------------------------------------------------------------
// Types — AsyncIterable / token-stream API
// ---------------------------------------------------------------------------

/**
 * Result returned by the `governanceCheck` callback.
 *
 * When `allowed` is false the stream is halted immediately and the consumer
 * receives a `StreamHaltedError`.  When `filteredOutput` is supplied and
 * `allowed` is true, the internal accumulator is replaced with the filtered
 * value.
 */
export interface StreamGovernanceCheckResult {
  /** Whether the stream may continue after this check. */
  readonly allowed: boolean;
  /**
   * Human-readable reason for denial.  Required when `allowed` is false;
   * ignored when `allowed` is true.
   */
  readonly reason?: string;
  /**
   * If provided, replaces the accumulated output (for redaction / PII
   * scrubbing).  Only meaningful when `allowed` is true.
   */
  readonly filteredOutput?: string;
}

/**
 * Async governance callback invoked at each check interval.
 *
 * @param accumulated  - The full content accumulated so far (all tokens
 *   concatenated, post-redaction if a previous check returned filteredOutput).
 * @param tokenCount   - The total number of tokens yielded so far.
 * @returns A StreamGovernanceCheckResult indicating whether to continue.
 */
export type StreamGovernanceCallback = (
  accumulated: string,
  tokenCount: number,
) => Promise<StreamGovernanceCheckResult>;

/**
 * Configuration for `GovernedStream` / `createGovernedStream`.
 */
export interface GovernedStreamConfig {
  /**
   * Run a governance check every N tokens.
   * A check is also always run when the stream ends naturally.
   * Default: 50.
   */
  checkIntervalTokens?: number;
  /**
   * Run a governance check every N characters of accumulated content.
   * A check is triggered when either this threshold or `checkIntervalTokens`
   * is crossed, whichever comes first.
   * Default: 500.
   */
  checkIntervalChars?: number;
  /**
   * Governance check callback.  Return `{ allowed: false }` to halt the
   * stream.
   */
  governanceCheck: StreamGovernanceCallback;
  /**
   * Hard limit on the total number of tokens.  The stream is halted
   * immediately when this is exceeded, before any governance check callback
   * is invoked.
   */
  maxTokens?: number;
  /**
   * Hard limit on the total number of characters.  The stream is halted
   * immediately when this is exceeded.
   */
  maxChars?: number;
  /**
   * Optional callback invoked when the stream is halted due to governance
   * denial or a hard limit being hit.  Use this to emit events or record
   * audit entries.
   */
  onHalt?: (reason: string, accumulated: string) => void;
}

// ---------------------------------------------------------------------------
// Types — legacy ReadableStream API (kept for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Result returned by the `onChunk` governance callback (legacy API).
 *
 * @deprecated Use `StreamGovernanceCheckResult` with the AsyncIterable API.
 */
export interface LegacyStreamGovernanceCheckResult {
  /** Whether the stream may continue after this chunk. */
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * Synchronous or asynchronous governance callback for the legacy
 * `ReadableStream` API.
 *
 * @deprecated Use `StreamGovernanceCallback` with the AsyncIterable API.
 */
export type LegacyStreamGovernanceCallback = (
  accumulatedContent: string,
  chunkContent: string,
) => LegacyStreamGovernanceCheckResult | Promise<LegacyStreamGovernanceCheckResult>;

/**
 * Configuration for `createGovernedReadableStream` (legacy ReadableStream API).
 *
 * @deprecated Use `GovernedStreamConfig` with the AsyncIterable API.
 */
export interface LegacyGovernedStreamConfig {
  /** Called after each decoded chunk. Return `{ allowed: false }` to halt. */
  onChunk: LegacyStreamGovernanceCallback;
  /** Optional halt callback for audit / event emission. */
  onHalt?: (reason: string, accumulatedContent: string) => void;
  /** Text encoding for the stream decoder. Defaults to 'utf-8'. */
  encoding?: string;
}

// ---------------------------------------------------------------------------
// StreamHaltedError
// ---------------------------------------------------------------------------

/**
 * Thrown (or surfaced via async iterator) when the stream is halted by
 * governance — either because the `governanceCheck` callback returned
 * `{ allowed: false }`, or because a hard `maxTokens` / `maxChars` limit
 * was exceeded.
 */
export class StreamHaltedError extends GovernanceError {
  /** The accumulated content at the point the stream was halted. */
  readonly accumulatedContent: string;

  constructor(reason: string, accumulatedContent: string) {
    super('STREAM_HALTED', `Governed stream halted: ${reason}`);
    this.name = 'StreamHaltedError';
    this.accumulatedContent = accumulatedContent;
  }
}

// ---------------------------------------------------------------------------
// GovernedStream — AsyncIterable<string> API
// ---------------------------------------------------------------------------

const DEFAULT_CHECK_INTERVAL_TOKENS = 50;
const DEFAULT_CHECK_INTERVAL_CHARS = 500;

/**
 * A governance-aware wrapper around an `AsyncIterable<string>` token stream.
 *
 * Tokens are accumulated in an internal buffer and governance checks are
 * performed at configurable intervals.  Hard limits (`maxTokens`, `maxChars`)
 * are enforced on every token before any callback is invoked.
 *
 * `GovernedStream` itself is `AsyncIterable<string>`, so callers can use
 * `for await...of` directly.
 *
 * Use `createGovernedStream()` as the primary factory.
 */
export class GovernedStream implements AsyncIterable<string> {
  readonly #source: AsyncIterable<string>;
  readonly #config: GovernedStreamConfig;

  #accumulatedContent: string = '';
  #tokenCount: number = 0;
  #halted: boolean = false;

  /** Tracks characters at the last check, for interval calculation. */
  #charsAtLastCheck: number = 0;
  /** Tracks tokens at the last check, for interval calculation. */
  #tokensAtLastCheck: number = 0;

  constructor(source: AsyncIterable<string>, config: GovernedStreamConfig) {
    this.#source = source;
    this.#config = config;
  }

  // -------------------------------------------------------------------------
  // Public state accessors
  // -------------------------------------------------------------------------

  /**
   * Returns the content accumulated from all tokens forwarded to the consumer.
   *
   * After the stream completes or is halted, this is the full content seen
   * (post-redaction if any check returned `filteredOutput`).
   */
  get accumulatedContent(): string {
    return this.#accumulatedContent;
  }

  /**
   * Returns the total number of tokens seen so far.
   */
  get tokenCount(): number {
    return this.#tokenCount;
  }

  /**
   * Returns true if the stream was halted by governance before the source
   * stream naturally completed.
   */
  get halted(): boolean {
    return this.#halted;
  }

  // -------------------------------------------------------------------------
  // AsyncIterable implementation
  // -------------------------------------------------------------------------

  [Symbol.asyncIterator](): AsyncIterator<string> {
    const sourceIterator = this.#source[Symbol.asyncIterator]();
    // Capture `this` for use inside the iterator object's methods.
    const self = this;

    return {
      async next(): Promise<IteratorResult<string>> {
        if (self.#halted) {
          return { done: true, value: undefined };
        }

        while (true) {
          const result = await sourceIterator.next();

          if (result.done === true) {
            // Source exhausted — run a final governance check on whatever
            // remains in the accumulator.
            const finalCheck = await self.#runGovernanceCheck();
            if (!finalCheck.allowed) {
              await self.#haltStream(
                finalCheck.reason ?? 'Governance denied at stream end.',
              );
              throw new StreamHaltedError(
                finalCheck.reason ?? 'Governance denied at stream end.',
                self.#accumulatedContent,
              );
            }
            return { done: true, value: undefined };
          }

          const token: string = result.value;
          self.#accumulatedContent += token;
          self.#tokenCount += 1;

          // --- Hard limit checks ---
          const maxTokens = self.#config.maxTokens;
          if (maxTokens !== undefined && self.#tokenCount > maxTokens) {
            const reason = `Maximum token count (${maxTokens}) exceeded.`;
            await self.#haltStream(reason);
            throw new StreamHaltedError(reason, self.#accumulatedContent);
          }

          const maxChars = self.#config.maxChars;
          if (maxChars !== undefined && self.#accumulatedContent.length > maxChars) {
            const reason = `Maximum character count (${maxChars}) exceeded.`;
            await self.#haltStream(reason);
            throw new StreamHaltedError(reason, self.#accumulatedContent);
          }

          // --- Interval check ---
          const intervalTokens =
            self.#config.checkIntervalTokens ?? DEFAULT_CHECK_INTERVAL_TOKENS;
          const intervalChars =
            self.#config.checkIntervalChars ?? DEFAULT_CHECK_INTERVAL_CHARS;

          const tokensDelta = self.#tokenCount - self.#tokensAtLastCheck;
          const charsDelta =
            self.#accumulatedContent.length - self.#charsAtLastCheck;

          const shouldCheck =
            tokensDelta >= intervalTokens || charsDelta >= intervalChars;

          if (shouldCheck) {
            const checkResult = await self.#runGovernanceCheck();
            self.#tokensAtLastCheck = self.#tokenCount;
            self.#charsAtLastCheck = self.#accumulatedContent.length;

            if (!checkResult.allowed) {
              await self.#haltStream(
                checkResult.reason ?? 'Governance check denied the stream.',
              );
              throw new StreamHaltedError(
                checkResult.reason ?? 'Governance check denied the stream.',
                self.#accumulatedContent,
              );
            }

            // Apply redaction if the callback provided a filtered version.
            if (checkResult.filteredOutput !== undefined) {
              self.#accumulatedContent = checkResult.filteredOutput;
            }
          }

          return { done: false, value: token };
        }
      },

      async return(): Promise<IteratorResult<string>> {
        // Allow upstream to cancel the source iterator if it supports it.
        if (typeof sourceIterator.return === 'function') {
          await sourceIterator.return(undefined);
        }
        self.#halted = true;
        return { done: true, value: undefined };
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  async #runGovernanceCheck(): Promise<StreamGovernanceCheckResult> {
    return this.#config.governanceCheck(
      this.#accumulatedContent,
      this.#tokenCount,
    );
  }

  async #haltStream(reason: string): Promise<void> {
    this.#halted = true;
    if (this.#config.onHalt !== undefined) {
      this.#config.onHalt(reason, this.#accumulatedContent);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory function — AsyncIterable API (primary)
// ---------------------------------------------------------------------------

/**
 * Creates a `GovernedStream` wrapping the provided `AsyncIterable<string>`
 * token source.
 *
 * Governance checks run at the configured token/character intervals, and hard
 * limits are enforced on every token without needing a callback.
 *
 * @param source - The `AsyncIterable<string>` to govern.
 * @param config - Governance configuration, including the `governanceCheck`
 *   callback and optional interval / limit settings.
 * @returns A `GovernedStream` that is itself `AsyncIterable<string>`.
 *
 * @example
 * ```ts
 * const governed = createGovernedStream(tokenSource(), {
 *   checkIntervalTokens: 25,
 *   maxTokens: 500,
 *   governanceCheck: async (accumulated, tokenCount) => ({
 *     allowed: !accumulated.includes('<script>'),
 *     reason: 'Script injection detected',
 *   }),
 *   onHalt: (reason) => console.warn('Stream halted:', reason),
 * });
 *
 * for await (const token of governed) {
 *   process.stdout.write(token);
 * }
 * ```
 */
export function createGovernedStream(
  source: AsyncIterable<string>,
  config: GovernedStreamConfig,
): GovernedStream {
  return new GovernedStream(source, config);
}

// ---------------------------------------------------------------------------
// LegacyGovernedReadableStream — ReadableStream API (backward compatibility)
// ---------------------------------------------------------------------------

/**
 * A governance-aware wrapper around a `ReadableStream<string>`.
 *
 * @deprecated Use `GovernedStream` with the `AsyncIterable<string>` API
 * via `createGovernedStream()`.  This class is retained for backward
 * compatibility with code that was using the previous `ReadableStream`-based
 * API.
 */
export class LegacyGovernedReadableStream {
  /**
   * The governed `ReadableStream<string>`.
   *
   * Consume this stream instead of the original source.
   */
  readonly stream: ReadableStream<string>;

  /** Accumulated content from all forwarded chunks so far. */
  #accumulatedContent: string = '';

  /** True once the stream has been halted by a governance denial. */
  #halted: boolean = false;

  constructor(
    source: ReadableStream<Uint8Array | string>,
    config: LegacyGovernedStreamConfig,
  ) {
    const decoder = new TextDecoder(config.encoding ?? 'utf-8');

    // Capture `this` for use inside the underlyingSource closures.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.stream = new ReadableStream<string>({
      start(controller: ReadableStreamDefaultController<string>): void {
        const reader = source.getReader();

        async function pump(): Promise<void> {
          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                controller.close();
                return;
              }

              const chunk: string =
                value instanceof Uint8Array
                  ? decoder.decode(value, { stream: true })
                  : value;

              self.#accumulatedContent += chunk;

              const checkResult = await config.onChunk(self.#accumulatedContent, chunk);

              if (!checkResult.allowed) {
                self.#halted = true;
                const reason = checkResult.reason ?? 'Governance check denied the stream.';

                if (config.onHalt !== undefined) {
                  config.onHalt(reason, self.#accumulatedContent);
                }

                const haltError = new StreamHaltedError(reason, self.#accumulatedContent);
                controller.error(haltError);
                reader.cancel(haltError).catch((): void => {
                  // Intentionally swallowed — source cancellation is best-effort.
                });
                return;
              }

              controller.enqueue(chunk);
            }
          } catch (error: unknown) {
            if (!self.#halted) {
              controller.error(error);
            }
          }
        }

        pump().catch((error: unknown): void => {
          if (!self.#halted) {
            controller.error(error);
          }
        });
      },

      cancel(_reason: unknown): void {
        // Cancellation is propagated naturally when the source reader is held
        // inside the pump() closure above.  Nothing to do here.
      },
    });
  }

  /**
   * Returns the content accumulated from all chunks forwarded to the consumer.
   */
  get accumulatedContent(): string {
    return this.#accumulatedContent;
  }

  /**
   * Returns true if the stream was halted by a governance denial.
   */
  get halted(): boolean {
    return this.#halted;
  }

  /**
   * Returns a `ReadableStreamDefaultReader<string>` for the governed stream.
   */
  getReader(): ReadableStreamDefaultReader<string> {
    return this.stream.getReader();
  }
}

// ---------------------------------------------------------------------------
// Factory function — legacy ReadableStream API
// ---------------------------------------------------------------------------

/**
 * Creates a `LegacyGovernedReadableStream` wrapping the provided source stream.
 *
 * @deprecated Use `createGovernedStream()` with an `AsyncIterable<string>`
 * source and `GovernedStreamConfig` instead.
 */
export function createGovernedReadableStream(
  stream: ReadableStream<Uint8Array | string>,
  config: LegacyGovernedStreamConfig,
): LegacyGovernedReadableStream {
  return new LegacyGovernedReadableStream(stream, config);
}
