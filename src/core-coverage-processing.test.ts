/**
 * FractoP Coverage Tests - Processing Edge Cases, Deduplication, and Events
 */

import { describe, it, expect, vi } from 'vitest';
import { FractalProcessor } from './core';
import type { LLMProvider, ProcessOptions } from './types';

describe('FractalProcessor - Utility Methods', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  it('getLLM returns the LLM provider', () => {
    const processor = new FractalProcessor(mockLLM);
    const llm = processor.getLLM();
    expect(llm).toBe(mockLLM);
    expect(llm.chat).toBeDefined();
  });

  it('getConfig returns a copy of configuration', () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 5000,
      overlapSize: 300,
      minResultCount: 20,
    });

    const config = processor.getConfig();

    expect(config.chunkSize).toBe(5000);
    expect(config.overlapSize).toBe(300);
    expect(config.minResultCount).toBe(20);

    config.chunkSize = 10000;
    const config2 = processor.getConfig();
    expect(config2.chunkSize).toBe(5000);
  });
});

describe('FractalProcessor - Processing Edge Cases', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  it('handles all empty chunk results', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 10,
    });

    const options: ProcessOptions<any> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    const result = await processor.process('a'.repeat(30), options);
    expect(result).toEqual([]);
  });

  it('handles processChunk returning undefined summary', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 10,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({
        items: ['item'],
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const result = await processor.process('a'.repeat(20), options);
    expect(result).toContain('item');
  });

  it('handles mergeResults returning empty', async () => {
    const processor = new FractalProcessor(mockLLM);

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({
        items: ['item'],
        summary: ''
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    const result = await processor.process('test', options);
    expect(result).toEqual([]);
  });

  it('handles supplement throwing error', async () => {
    const processor = new FractalProcessor(mockLLM, {
      minResultCount: 10,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({
        items: ['item'],
        summary: ''
      }),
      mergeResults: () => ({
        items: ['item'],
        needsSupplement: true
      }),
      supplement: vi.fn().mockRejectedValue(new Error('Supplement failed')),
      getKey: (item) => item,
    };

    const result = await processor.processWithMetadata('test', options);
    expect(result.items).toEqual(['item']);
    expect(result.supplemented).toBe(false);
  });
});

describe('FractalProcessor - Deduplication Edge Cases', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  it('deduplicates with complex objects', async () => {
    const processor = new FractalProcessor<{ id: string; data: any }>(mockLLM);

    const options: ProcessOptions<{ id: string; data: any }> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({
        items: [
          { id: '1', data: { value: 'a' } },
          { id: '2', data: { value: 'b' } },
          { id: '1', data: { value: 'c' } },
        ],
        summary: ''
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item.id,
    };

    const result = await processor.process('test', options);
    expect(result).toHaveLength(2);
    expect(result.find(i => i.id === '1')?.data.value).toBe('a');
  });

  it('handles getKey returning same key for different items', async () => {
    const processor = new FractalProcessor<any>(mockLLM);

    const options: ProcessOptions<any> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({
        items: [
          { id: 1, value: 'first' },
          { id: 2, value: 'second' },
          { id: 1, value: 'third' }
        ],
        summary: ''
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item.id.toString(),
    };

    const result = await processor.process('test', options);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBe('first');
  });
});

describe('FractalProcessor - Event Listener Edge Cases', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  it('handles multiple listeners with different error behaviors', async () => {
    const processor = new FractalProcessor(mockLLM);

    const events1: any[] = [];
    const events2: any[] = [];

    processor.on(event => events1.push(event));
    processor.on(event => {
      if (event.type === 'chunk_start') throw new Error('Listener error');
      events2.push(event);
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({
        items: ['item'],
        summary: ''
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    await processor.process('test', options);

    expect(events1.length).toBeGreaterThan(0);
    expect(events2.length).toBeGreaterThan(0);
    expect(events2.find(e => e.type === 'chunk_start')).toBeUndefined();
  });

  it('unsubscribe during event emission', async () => {
    const processor = new FractalProcessor(mockLLM);

    let unsubscribe: () => void;
    let eventCount = 0;

    unsubscribe = processor.on(event => {
      eventCount++;
      if (event.type === 'context_generated') {
        unsubscribe();
      }
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({
        items: ['item'],
        summary: ''
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    await processor.process('test', options);

    expect(eventCount).toBeGreaterThan(0);
    expect(eventCount).toBeLessThan(5);
  });
});
