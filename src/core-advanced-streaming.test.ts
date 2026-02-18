/**
 * FractoP Advanced Features Tests - Streaming API
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

describe('FractalProcessor - Streaming API', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('streams items as they are processed', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0,
    });

    let itemCount = 0;
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (_chunk, context) => {
        return {
          items: [`item-${context.index}-a`, `item-${context.index}-b`],
          summary: `sum-${context.index}`
        };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const collectedItems: string[] = [];
    for await (const item of processor.processStream('a'.repeat(30), options)) {
      collectedItems.push(item);
      itemCount++;
    }

    expect(itemCount).toBe(6);
    expect(collectedItems).toContain('item-0-a');
    expect(collectedItems).toContain('item-2-b');
  });

  it('propagates context in streaming mode', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0,
    });

    const summaries: (string | undefined)[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('global'),
      processChunk: vi.fn().mockImplementation(async (_chunk, context) => {
        summaries.push(context.previousSummary);
        return {
          items: [`item-${context.index}`],
          summary: `summary-${context.index}`
        };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const items: string[] = [];
    for await (const item of processor.processStream('a'.repeat(30), options)) {
      items.push(item);
    }

    expect(summaries[0]).toBeUndefined();
    expect(summaries[1]).toBe('summary-0');
    expect(summaries[2]).toBe('summary-1');
  });

  it('handles errors gracefully in streaming', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0,
      maxRetries: 1,
      retryDelay: 1,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (_chunk, context) => {
        if (context.index === 1) {
          throw new Error('Middle chunk fails');
        }
        return {
          items: [`item-${context.index}`],
          summary: ''
        };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const items: string[] = [];
    for await (const item of processor.processStream('a'.repeat(30), options)) {
      items.push(item);
    }

    expect(items).toContain('item-0');
    expect(items).not.toContain('item-1');
    expect(items).toContain('item-2');
  });

  it('creates Nagare stream with proper interface', async () => {
    const processor = new FractalProcessor<{ id: number; value: string }>(llm);

    const options: ProcessOptions<{ id: number; value: string }> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (_chunk, context) => {
        return {
          items: [
            { id: context.index * 2, value: `val-${context.index * 2}` },
            { id: context.index * 2 + 1, value: `val-${context.index * 2 + 1}` }
          ],
          summary: ''
        };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item.id.toString(),
    };

    const stream = processor.processAsStream('test', options);

    expect(typeof stream.subscribe).toBe('function');
    expect(typeof stream.pipeThrough).toBe('function');
    expect(typeof stream.pipeTo).toBe('function');
    expect(typeof stream.tee).toBe('function');
    expect(typeof stream.map).toBe('function');
    expect(typeof stream.filter).toBe('function');
    expect(typeof stream.take).toBe('function');
    expect(typeof stream.reduce).toBe('function');

    const collected: { id: number; value: string }[] = [];
    const subscription = stream.subscribe({
      next: (item) => collected.push(item),
      complete: () => {},
      error: (err) => console.error(err),
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(collected.length).toBeGreaterThan(0);
    expect(collected[0]).toHaveProperty('id');
    expect(collected[0]).toHaveProperty('value');

    subscription.unsubscribe();
  });

  it('handles empty stream correctly', async () => {
    const processor = new FractalProcessor<string>(llm);

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const items: string[] = [];
    for await (const item of processor.processStream('test', options)) {
      items.push(item);
    }

    expect(items).toEqual([]);
  });

  it('stream can be interrupted', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (_chunk, context) => {
        await new Promise(r => setTimeout(r, 10));
        return {
          items: [`item-${context.index}`],
          summary: ''
        };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const items: string[] = [];
    const generator = processor.processStream('a'.repeat(50), options);

    for await (const item of generator) {
      items.push(item);
      if (items.length >= 2) break;
    }

    expect(items.length).toBe(2);
  });

  it('stream handles async consumption correctly', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (_chunk, context) => {
        return {
          items: [`item-${context.index}`],
          summary: ''
        };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const items: string[] = [];
    for await (const item of processor.processStream('a'.repeat(30), options)) {
      await new Promise(r => setTimeout(r, 5));
      items.push(item);
    }

    expect(items).toHaveLength(3);
    expect(items).toEqual(['item-0', 'item-1', 'item-2']);
  });

  it('nagare stream can be transformed', async () => {
    const processor = new FractalProcessor<{ value: number }>(llm, {
      chunkSize: 10,
      overlapSize: 0,
    });

    const options: ProcessOptions<{ value: number }> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (_chunk, context) => {
        return {
          items: [
            { value: context.index * 10 },
            { value: context.index * 10 + 5 }
          ],
          summary: ''
        };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item.value.toString(),
    };

    const stream = processor.processAsStream('test-chunk', options);

    const transformed = stream
      .filter(item => item.value % 10 === 0)
      .map(item => item.value * 2);

    const collected: number[] = [];
    let completed = false;
    const subscription = transformed.subscribe({
      next: (value) => collected.push(value),
      complete: () => { completed = true; }
    });

    await new Promise(r => {
      const checkCompletion = () => {
        if (completed || collected.length >= 1) {
          r(undefined);
        } else {
          setTimeout(checkCompletion, 10);
        }
      };
      checkCompletion();
    });

    expect(collected).toEqual([0]);

    subscription.unsubscribe();
  });
});
