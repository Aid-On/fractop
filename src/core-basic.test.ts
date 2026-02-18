/**
 * FractoP Core Tests - Basic Processing, Timeout, Retry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FractalProcessor, TimeoutError } from './core';
import type {
  LLMProvider,
  ProcessOptions,
  FractalEvent,
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

describe('FractalProcessor - Basic Processing', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('processes short text without chunking', async () => {
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

    const result = await processor.process('short text', options);

    expect(result).toEqual(['item1', 'item2']);
    expect(options.generateContext).toHaveBeenCalledWith('short text');
    expect(options.processChunk).toHaveBeenCalledTimes(1);
  });

  it('splits long text into chunks', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 100,
      overlapSize: 10,
    });
    const longText = 'a'.repeat(250);

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

    await processor.process(longText, options);

    expect(options.processChunk).toHaveBeenCalledTimes(3);
  });

  it('deduplicates results', async () => {
    const processor = new FractalProcessor<{ id: string }>(llm);
    const options = createMockOptions<{ id: string }>({
      processChunk: vi.fn().mockResolvedValue({
        items: [{ id: '1' }, { id: '2' }, { id: '1' }],
        summary: 'summary',
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false,
      }),
      getKey: (item) => item.id,
    });

    const result = await processor.process('text', options);

    expect(result).toHaveLength(2);
  });
});

describe('FractalProcessor - Timeout Support', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('creates processor with timeout config', () => {
    const processor = new FractalProcessor<string>(llm, {
      timeout: 5000,
      chunkTimeout: 1000,
    });

    const config = processor.getConfig();
    expect(config.timeout).toBe(5000);
    expect(config.chunkTimeout).toBe(1000);
  });

  it('throws TimeoutError with correct properties', () => {
    const error = new TimeoutError('Test timeout', 'chunk');
    expect(error.name).toBe('TimeoutError');
    expect(error.phase).toBe('chunk');
    expect(error.message).toBe('Test timeout');
  });
});

describe('FractalProcessor - Retry Logic', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('retries failed chunks', async () => {
    const processor = new FractalProcessor<string>(llm, {
      maxRetries: 3,
      retryDelay: 1,
    });

    let callCount = 0;
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Temporary failure');
        }
        return { items: ['item'], summary: 'summary' };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false,
      }),
    });

    const result = await processor.process('text', options);

    expect(result).toEqual(['item']);
    expect(callCount).toBe(3);
  });

  it('fails after max retries exceeded', async () => {
    const processor = new FractalProcessor<string>(llm, {
      maxRetries: 2,
      retryDelay: 1,
    });

    const options = createMockOptions<string>({
      processChunk: vi.fn().mockRejectedValue(new Error('Persistent failure')),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false,
      }),
    });

    const events: FractalEvent<string>[] = [];
    processor.on((event) => events.push(event));

    const result = await processor.processWithMetadata('text', options);

    expect(result.chunksFailed).toBe(1);
    expect(events.some((e) => e.type === 'chunk_failed')).toBe(true);
  });
});
