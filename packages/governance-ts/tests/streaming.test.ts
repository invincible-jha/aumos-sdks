// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 MuVeraAI Corporation

import { describe, it, expect, vi } from 'vitest';
import { GovernedStream, StreamHaltedError, createGovernedStream } from '../src/streaming.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStringStream(chunks: string[]): ReadableStream<string> {
  let index = 0;
  return new ReadableStream<string>({
    pull(controller: ReadableStreamDefaultController<string>): void {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]!);
        index++;
      } else {
        controller.close();
      }
    },
  });
}

async function collectChunks(stream: ReadableStream<string>): Promise<string[]> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GovernedStream', () => {
  describe('pass-through behaviour', () => {
    it('forwards all chunks when governance callback always allows', async () => {
      const source = makeStringStream(['Hello', ' ', 'World']);
      const governed = new GovernedStream(source, {
        onChunk: () => ({ allowed: true }),
      });
      const chunks = await collectChunks(governed.stream);
      expect(chunks).toEqual(['Hello', ' ', 'World']);
    });

    it('accumulates content across chunks', async () => {
      const source = makeStringStream(['foo', 'bar']);
      const governed = new GovernedStream(source, {
        onChunk: () => ({ allowed: true }),
      });
      await collectChunks(governed.stream);
      expect(governed.accumulatedContent).toBe('foobar');
    });

    it('halted is false when the stream completes without denial', async () => {
      const source = makeStringStream(['ok']);
      const governed = new GovernedStream(source, {
        onChunk: () => ({ allowed: true }),
      });
      await collectChunks(governed.stream);
      expect(governed.halted).toBe(false);
    });
  });

  describe('halting behaviour', () => {
    it('halts the stream when onChunk returns allowed: false', async () => {
      const source = makeStringStream(['chunk1', 'chunk2', 'chunk3']);
      let callCount = 0;
      const governed = new GovernedStream(source, {
        onChunk: () => {
          callCount++;
          return { allowed: callCount < 2, reason: 'Limit reached' };
        },
      });

      try {
        await collectChunks(governed.stream);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(StreamHaltedError);
        expect((error as StreamHaltedError).message).toContain('Limit reached');
      }
      expect(governed.halted).toBe(true);
    });

    it('invokes the onHalt callback with the reason when the stream is halted', async () => {
      const onHalt = vi.fn();
      const source = makeStringStream(['data', 'more-data']);
      const governed = new GovernedStream(source, {
        onChunk: (accumulated) => ({
          allowed: accumulated.length < 5,
          reason: 'Content length exceeded',
        }),
        onHalt,
      });

      try {
        await collectChunks(governed.stream);
      } catch {
        // expected halt
      }
      expect(onHalt).toHaveBeenCalledOnce();
      expect(onHalt.mock.calls[0]![0]).toContain('Content length exceeded');
    });
  });

  describe('async governance callback', () => {
    it('supports async onChunk callbacks', async () => {
      const source = makeStringStream(['async-chunk']);
      const governed = new GovernedStream(source, {
        onChunk: async () => {
          await Promise.resolve();
          return { allowed: true };
        },
      });
      const chunks = await collectChunks(governed.stream);
      expect(chunks).toEqual(['async-chunk']);
    });
  });

  describe('StreamHaltedError', () => {
    it('has name StreamHaltedError', () => {
      const error = new StreamHaltedError('test reason', 'accumulated');
      expect(error.name).toBe('StreamHaltedError');
    });

    it('carries the accumulated content at the time of halting', () => {
      const error = new StreamHaltedError('limit', 'partial content');
      expect(error.accumulatedContent).toBe('partial content');
    });
  });

  describe('getReader convenience method', () => {
    it('returns a reader for the governed stream', async () => {
      const source = makeStringStream(['data']);
      const governed = new GovernedStream(source, { onChunk: () => ({ allowed: true }) });
      const reader = governed.getReader();
      expect(reader).toBeDefined();
      const { value } = await reader.read();
      expect(value).toBe('data');
    });
  });

  describe('createGovernedStream factory', () => {
    it('creates a GovernedStream instance', () => {
      const source = makeStringStream(['hello']);
      const governed = createGovernedStream(source, { onChunk: () => ({ allowed: true }) });
      expect(governed).toBeInstanceOf(GovernedStream);
    });
  });
});
