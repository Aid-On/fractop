/**
 * FractoP Core Edge Cases Tests - Null/Undefined, Concurrent, Memory, Boundary
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FractalProcessor } from './core';
import type { LLMProvider, ProcessOptions } from './types';

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

describe('FractalProcessor - Null and Undefined Handling', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('handles undefined items in results', async () => {
    const processor = new FractalProcessor<any>(llm);
    const options = createMockOptions<any>({
      processChunk: vi.fn().mockResolvedValue({
        items: [undefined, 'valid', null, 'item'],
        summary: ''
      }),
      mergeResults: (results) => ({
        items: results.flat().filter(Boolean),
        needsSupplement: false
      }),
    });

    const result = await processor.process('test', options);
    expect(result).toEqual(['valid', 'item']);
  });

  it('handles missing summary in chunk result', async () => {
    const processor = new FractalProcessor<string>(llm, { chunkSize: 10 });
    const text = 'a'.repeat(30);
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({
        items: ['item'],
      }),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
    });

    await processor.process(text, options);
    expect(options.processChunk).toHaveBeenCalled();
  });
});

describe('FractalProcessor - Concurrent Access', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('handles multiple simultaneous processing calls', async () => {
    const processor = new FractalProcessor<string>(llm);
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 10));
        return { items: ['item'], summary: '' };
      }),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
    });

    const results = await Promise.all([
      processor.process('text1', options),
      processor.process('text2', options),
      processor.process('text3', options),
    ]);

    expect(results).toHaveLength(3);
    results.forEach(result => {
      expect(result).toEqual(['item']);
    });
  });
});

describe('FractalProcessor - Memory and Performance', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('processes very large text without memory issues', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 1000,
      enableStreaming: true
    });

    const largeText = 'a'.repeat(1000000);
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({
        items: ['chunk'],
        summary: 'sum'
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
    });

    const startMemory = process.memoryUsage().heapUsed;
    await processor.process(largeText, options);
    const endMemory = process.memoryUsage().heapUsed;

    const memoryIncrease = (endMemory - startMemory) / (1024 * 1024);
    expect(memoryIncrease).toBeLessThan(100);
  });

  it('handles rapid event emissions without loss', async () => {
    const processor = new FractalProcessor<string>(llm, { chunkSize: 10 });
    const events: any[] = [];

    processor.on(event => events.push(event));

    const text = 'a'.repeat(50);
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({
        items: ['item'],
        summary: ''
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
    });

    await processor.process(text, options);

    const eventTypes = [...new Set(events.map(e => e.type))];
    expect(eventTypes).toContain('start');
    expect(eventTypes).toContain('chunk_start');
    expect(eventTypes).toContain('chunk_complete');
    expect(eventTypes).toContain('complete');
  });
});

describe('FractalProcessor - Boundary Splitting Edge Cases', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('splits at paragraph boundaries correctly', async () => {
    const processor = new FractalProcessor<string>(llm, { chunkSize: 20 });
    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';

    const chunks: string[] = [];
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockImplementation(async (chunk) => {
        chunks.push(chunk);
        return { items: [], summary: '' };
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
    });

    await processor.process(text, options);

    expect(chunks.some(c => c.includes('First paragraph.'))).toBe(true);
  });

  it('handles no suitable boundary found', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0
    });
    const text = 'abcdefghijklmnopqrstuvwxyz';

    const chunks: string[] = [];
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockImplementation(async (chunk) => {
        chunks.push(chunk);
        return { items: [], summary: '' };
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
    });

    await processor.process(text, options);

    expect(chunks.length).toBeGreaterThan(1);
  });
});
