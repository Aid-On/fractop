/**
 * FractoP Core Error Handling Tests - Recovery, Events, Degradation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FractalProcessor } from './core';
import type { LLMProvider, ProcessOptions, FractalCallbacks, FractalEvent } from './types';

// Mock LLM Provider
function createMockLLM(): LLMProvider {
  return {
    chat: vi.fn().mockResolvedValue('mocked response'),
  };
}

describe('FractalProcessor - Error Recovery Callbacks', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('uses onError callback for recovery', async () => {
    const processor = new FractalProcessor<string>(llm, {
      maxRetries: 1,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockRejectedValue(new Error('Context fail')),
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    const callbacks: FractalCallbacks<string> = {
      onError: vi.fn().mockReturnValue(['recovered1', 'recovered2']),
    };

    const result = await processor.processWithMetadata('test', options, callbacks);

    expect(callbacks.onError).toHaveBeenCalled();
    expect(result.items).toEqual(['recovered1', 'recovered2']);
  });

  it('uses onError callback when provided', async () => {
    const processor = new FractalProcessor<string>(llm, {
      maxRetries: 0,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockRejectedValue(new Error('Test error')),
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    const callbacks: FractalCallbacks<string> = {
      onError: vi.fn().mockReturnValue(['recovered1', 'recovered2']),
    };

    const result = await processor.processWithMetadata('test', options, callbacks);

    expect(callbacks.onError).toHaveBeenCalled();
    expect(result.items).toEqual(['recovered1', 'recovered2']);
  });

  it('re-throws if onError callback throws', async () => {
    const processor = new FractalProcessor<string>(llm);

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockRejectedValue(new Error('Fail')),
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    const callbacks: FractalCallbacks<string> = {
      onError: vi.fn().mockRejectedValue(new Error('Recovery failed')),
    };

    await expect(
      processor.processWithMetadata('test', options, callbacks)
    ).rejects.toThrow('Recovery failed');
  });
});

describe('FractalProcessor - Error Event Emissions', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('emits error events for different phases', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      maxRetries: 1,
      retryDelay: 1,
    });

    const events: FractalEvent<string>[] = [];
    processor.on(event => events.push(event));

    const contextErrorOptions: ProcessOptions<string> = {
      generateContext: vi.fn().mockRejectedValue(new Error('Context error')),
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    try {
      await processor.process('test', contextErrorOptions);
    } catch { /* expected */ }

    const contextError = events.find(e => e.type === 'error' && e.phase === 'context');
    expect(contextError).toBeDefined();

    events.length = 0;
    const chunkErrorOptions: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn()
        .mockResolvedValueOnce({ items: ['item1'], summary: '' })
        .mockRejectedValueOnce(new Error('Chunk error')),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    await processor.process('a'.repeat(20), chunkErrorOptions);
    expect(events.length).toBeGreaterThan(0);

    events.length = 0;
    const mergeErrorOptions: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({ items: ['item'], summary: '' }),
      mergeResults: () => { throw new Error('Merge error'); },
      getKey: (item) => item,
    };

    try {
      await processor.process('test', mergeErrorOptions);
    } catch { /* expected */ }

    const mergeError = events.find(e => e.type === 'error' && e.phase === 'merge');
    expect(mergeError).toBeDefined();
  });

  it('emits chunk_failed events with correct metadata', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      maxRetries: 1,
      retryDelay: 1,
    });

    const events: FractalEvent<string>[] = [];
    processor.on(event => events.push(event));

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockRejectedValue(new Error('Chunk failure')),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    await processor.processWithMetadata('a'.repeat(30), options);

    const failedEvents = events.filter(e => e.type === 'chunk_failed');
    expect(failedEvents.length).toBeGreaterThan(0);

    failedEvents.forEach(event => {
      expect(event).toHaveProperty('index');
      expect(event).toHaveProperty('error');
      expect(event).toHaveProperty('skipped');
    });
  });
});

describe('FractalProcessor - Graceful Degradation', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('continues processing after some chunks fail', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      maxRetries: 1,
      retryDelay: 1,
    });

    let chunkIndex = 0;
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async () => {
        chunkIndex++;
        if (chunkIndex % 2 === 0) {
          throw new Error('Even chunk fails');
        }
        return { items: [`item${chunkIndex}`], summary: '' };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const result = await processor.processWithMetadata('a'.repeat(40), options);

    expect(result.chunksProcessed).toBeGreaterThan(0);
    expect(result.chunksFailed).toBeGreaterThan(0);
    expect(result.items).toContain('item1');
    expect(result.items).toContain('item3');
    expect(result.items).not.toContain('item2');
  });

  it('returns empty results when all chunks fail', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      maxRetries: 1,
      retryDelay: 1,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockRejectedValue(new Error('All fail')),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const result = await processor.processWithMetadata('a'.repeat(30), options);

    expect(result.items).toEqual([]);
    expect(result.chunksFailed).toBeGreaterThan(0);
    expect(result.chunksProcessed).toBe(0);
  });
});
