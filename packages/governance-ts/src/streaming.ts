// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

/**
 * @aumos/governance — Streaming Governance
 *
 * `GovernedStream` wraps a `ReadableStream` of text chunks and passes each
 * chunk through a governance evaluation callback.  If the accumulated content
 * violates a configured limit the stream is cleanly halted mid-flight and the
 * consumer receives a `StreamHaltedError` via the stream's error mechanism.
 *
 * Governance evaluation is intentionally simple:
 *   - The caller supplies an `onChunk` callback that receives the accumulated
 *     content so far and returns `{ allowed: boolean; reason?: string }`.
 *   - This design keeps streaming.ts fully decoupled from specific budget or
 *     trust implementations; callers wire up their own GovernedAI instance.
 *
 * Usage:
 * ```ts
 * import { createGovernedStream } from '@aumos/governance';
 *
 * const governed = createGovernedStream(rawStream, {
 *   onChunk: (accumulated) => {
 *     const tokenCount = accumulated.length / 4;
 *     return { allowed: tokenCount < 2000, reason: 'Token limit reached' };
 *   },
 * });
 *
 * const reader = governed.stream.getReader();
 * while (true) {
 *   const { done, value } = await reader.read();
 *   if (done) break;
 *   process.stdout.write(value);
 * }
 * ```
 */

import { GovernanceError } from './errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result returned by the `onChunk` governance callback.
 *
 * When `allowed` is false the stream is halted immediately after this chunk
 * is evaluated; no further chunks are forwarded to the consumer.
 */
export interface StreamGovernanceCheckResult {
  /** Whether the stream may continue after this chunk. */
  readonly allowed: boolean;
  /**
   * Human-readable reason for denial.  Required when `allowed` is false;
   * ignored when `allowed` is true.
   */
  readonly reason?: string;
}

/**
 * Synchronous or asynchronous governance callback invoked after each chunk.
 *
 * @param accumulatedContent - The full content received so far (all chunks
 *   concatenated).
 * @param chunkContent - The text content of the current chunk only.
 * @returns A StreamGovernanceCheckResult indicating whether to continue.
 */
export type StreamGovernanceCallback = (
  accumulatedContent: string,
  chunkContent: string,
) => StreamGovernanceCheckResult | Promise<StreamGovernanceCheckResult>;

/**
 * Configuration for `GovernedStream` / `createGovernedStream`.
 */
export interface GovernedStreamConfig {
  /**
   * Called after each decoded text chunk with the accumulated content.
   * Return `{ allowed: false }` to halt the stream.
   */
  onChunk: StreamGovernanceCallback;
  /**
   * Optional callback invoked when the stream is halted due to a governance
   * denial.  Use this to emit events or record audit entries.
   */
  onHalt?: (reason: string, accumulatedContent: string) => void;
  /**
   * Text encoding for the stream decoder.  Defaults to 'utf-8'.
   */
  encoding?: string;
}

// ---------------------------------------------------------------------------
// StreamHaltedError
// ---------------------------------------------------------------------------

/**
 * Thrown inside the transform stream when `onChunk` returns `allowed: false`.
 *
 * Consumer code reading from the governed stream will see this error surface
 * from the `read()` promise.
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
// GovernedStream
// ---------------------------------------------------------------------------

/**
 * A governance-aware wrapper around a `ReadableStream<string>`.
 *
 * Rather than extending `ReadableStream` (which prevents accessing `this`
 * before the `super()` call completes), `GovernedStream` exposes the governed
 * stream via the `.stream` property and tracks accumulated content and halt
 * state as mutable fields updated by the internal pump loop.
 *
 * Use `createGovernedStream()` as the primary factory.
 */
export class GovernedStream {
  /**
   * The governed `ReadableStream<string>`.
   *
   * Consume this stream instead of the original source.
   * Chunks are emitted as decoded strings.
   */
  readonly stream: ReadableStream<string>;

  /** Accumulated content from all forwarded chunks so far. */
  #accumulatedContent: string = '';

  /** True once the stream has been halted by a governance denial. */
  #halted: boolean = false;

  constructor(source: ReadableStream<Uint8Array | string>, config: GovernedStreamConfig) {
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

              // Decode Uint8Array or pass string through.
              const chunk: string =
                value instanceof Uint8Array
                  ? decoder.decode(value, { stream: true })
                  : value;

              self.#accumulatedContent += chunk;

              // Run the governance callback.
              const checkResult = await config.onChunk(self.#accumulatedContent, chunk);

              if (!checkResult.allowed) {
                self.#halted = true;
                const reason = checkResult.reason ?? 'Governance check denied the stream.';

                if (config.onHalt !== undefined) {
                  config.onHalt(reason, self.#accumulatedContent);
                }

                const haltError = new StreamHaltedError(reason, self.#accumulatedContent);
                controller.error(haltError);
                // Cancel the source reader; ignore errors from the source.
                reader.cancel(haltError).catch((): void => {
                  // Intentionally swallowed — source cancellation is best-effort.
                });
                return;
              }

              controller.enqueue(chunk);
            }
          } catch (error: unknown) {
            // Forward any source errors to the consumer.
            if (!self.#halted) {
              controller.error(error);
            }
          }
        }

        // Start the pump loop asynchronously.
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

  // -------------------------------------------------------------------------
  // Public state accessors
  // -------------------------------------------------------------------------

  /**
   * Returns the content accumulated from all chunks forwarded to the consumer.
   *
   * This reflects chunks emitted up to the most recently processed read.
   * After the stream completes or is halted, this is the full content seen.
   */
  get accumulatedContent(): string {
    return this.#accumulatedContent;
  }

  /**
   * Returns true if the stream was halted by a governance denial before
   * the source stream naturally completed.
   */
  get halted(): boolean {
    return this.#halted;
  }

  /**
   * Convenience method: returns a `ReadableStreamDefaultReader<string>` for
   * the governed stream.  Equivalent to `governedStream.stream.getReader()`.
   */
  getReader(): ReadableStreamDefaultReader<string> {
    return this.stream.getReader();
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Creates a `GovernedStream` wrapping the provided source stream.
 *
 * @param stream - The source `ReadableStream` to govern.
 * @param config - Governance configuration including the `onChunk` callback.
 * @returns A `GovernedStream` whose `.stream` property the consumer reads from.
 *
 * @example
 * ```ts
 * const governed = createGovernedStream(rawStream, {
 *   onChunk: (accumulated, chunk) => ({
 *     allowed: accumulated.length < 8_000,
 *     reason: 'Content length limit reached',
 *   }),
 *   onHalt: (reason, content) => {
 *     console.warn('Stream halted:', reason, 'chars:', content.length);
 *   },
 * });
 *
 * const reader = governed.getReader();
 * ```
 */
export function createGovernedStream(
  stream: ReadableStream<Uint8Array | string>,
  config: GovernedStreamConfig,
): GovernedStream {
  return new GovernedStream(stream, config);
}
