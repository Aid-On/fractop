/**
 * FractoP Core Tests - Circuit Breaker, Events, Parallel, Streaming, Callbacks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FractalProcessor } from './core';
import type {
  LLMProvider,
  ProcessOptions,
  FractalEvent,
  FractalCallbacks,
} from './types';

// Mock LLM Provider
function createMockLLM(): LLMProvider {
  return {
    chat: vi.fn().mockResolvedValue('mocked response'),
  };
}

// Mock Process Options
function createMockOptions<T>(
  overrides: Partial<ProcessOptions<T>> = {}
): ProcessOptions<T> {
  return {
    generateContext: vi.fn().mockResolvedValue('global context'),
    processChunk: vi.fn().mockResolvedValue({ items: [], summary: 'summary' }),
    mergeResults: vi.fn().mockReturnValue({ items: [], needsSupplement: false }),
    getKey: (item: T) => JSON.stringify(item),
    ...overrides,
  };
}

describe('FractalProcessor - Circuit Breaker', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('trips circuit breaker after consecutive failures', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 100,
      overlapSize: 10,
      circuitBreakerThreshold: 2,
      maxRetries: 1,
      retryDelay: 1,
    });

    const longText = 'a'.repeat(300);

    const options = createMockOptions<string>({
      processChunk: vi.fn().mockRejectedValue(new Error('Always fails')),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false,
      }),
    });

    const events: FractalEvent<string>[] = [];
    processor.on((event) => events.push(event));

    const result = await processor.processWithMetadata(longText, options);

    expect(result.circuitBreakerTripped).toBe(true);
    expect(events.some((e) => e.type === 'circuit_breaker_open')).toBe(true);
  });

  it('resets circuit breaker on success', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 100,
      overlapSize: 10,
      circuitBreakerThreshold: 3,
      maxRetries: 1,
      retryDelay: 1,
    });

    const longText = 'a'.repeat(300);

    let callCount = 0;
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('Temporary failure');
        }
        return { items: ['item'], summary: 'summary' };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false,
      }),
    });

    const result = await processor.processWithMetadata(longText, options);

    expect(result.circuitBreakerTripped).toBe(false);
  });
});

describe('FractalProcessor - Event System', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('emits all lifecycle events', async () => {
    const processor = new FractalProcessor<string>(llm);
    const events: FractalEvent<string>[] = [];

    processor.on((event) => events.push(event));

    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({
        items: ['item'],
        summary: 'summary',
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false,
      }),
    });

    await processor.process('text', options);

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('start');
    expect(eventTypes).toContain('context_generated');
    expect(eventTypes).toContain('chunk_start');
    expect(eventTypes).toContain('chunk_complete');
    expect(eventTypes).toContain('merge_complete');
    expect(eventTypes).toContain('complete');
  });

  it('unsubscribes listener correctly', async () => {
    const processor = new FractalProcessor<string>(llm);
    const events: FractalEvent<string>[] = [];

    const unsubscribe = processor.on((event) => events.push(event));
    unsubscribe();

    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
    });
    await processor.process('text', options);

    expect(events).toHaveLength(0);
  });

  it('handles listener errors gracefully', async () => {
    const processor = new FractalProcessor<string>(llm);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    processor.on(() => {
      throw new Error('Listener error');
    });

    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
    });

    await processor.process('text', options);

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('FractalProcessor - Parallel and Streaming', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('processes chunks in parallel when enabled', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 100,
      overlapSize: 10,
      parallelProcessing: true,
      concurrency: 2,
    });

    const longText = 'a'.repeat(300);
    const processStartTimes: number[] = [];

    const options = createMockOptions<string>({
      processChunk: vi.fn().mockImplementation(async () => {
        processStartTimes.push(Date.now());
        await new Promise(resolve => setTimeout(resolve, 10));
        return { items: ['item'], summary: 'summary' };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false,
      }),
    });

    await processor.process(longText, options);

    expect(options.processChunk).toHaveBeenCalled();
    expect(processStartTimes.length).toBeGreaterThanOrEqual(2);
    if (processStartTimes.length >= 2) {
      const timeDiff = Math.abs(processStartTimes[1] - processStartTimes[0]);
      expect(timeDiff).toBeLessThan(50);
    }
  });

  it('does not propagate context in parallel mode', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 100,
      parallelProcessing: true,
    });

    const longText = 'a'.repeat(200);
    const contexts: any[] = [];

    const options = createMockOptions<string>({
      processChunk: vi.fn().mockImplementation(async (_chunk, context) => {
        contexts.push(context);
        return { items: ['item'], summary: 'summary' };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false,
      }),
    });

    await processor.process(longText, options);

    contexts.forEach(ctx => {
      expect(ctx.previousSummary).toBeUndefined();
    });
  });

  it('yields items as stream', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 100,
    });

    const longText = 'a'.repeat(200);
    let chunkCount = 0;
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockImplementation(async () => {
        chunkCount++;
        if (chunkCount === 1) return { items: ['item1', 'item2'], summary: 'summary1' };
        if (chunkCount === 2) return { items: ['item3'], summary: 'summary2' };
        return { items: [], summary: 'summary' };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false,
      }),
    });

    const items: string[] = [];
    for await (const item of processor.processStream(longText, options)) {
      items.push(item);
    }

    expect(items).toContain('item1');
    expect(items).toContain('item2');
    expect(items).toContain('item3');
  }, 10000);

  it('creates Nagare stream', async () => {
    const processor = new FractalProcessor<string>(llm);
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({
        items: ['item1', 'item2'],
        summary: 'summary',
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false,
      }),
    });

    const stream = processor.processAsStream('text', options);

    expect(stream).toHaveProperty('map');
    expect(stream).toHaveProperty('filter');
    expect(stream).toHaveProperty('take');
  });
});
