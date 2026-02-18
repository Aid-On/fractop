/**
 * FractoP Final Coverage Tests - Chunking Edge Cases
 */

import { describe, it, expect, vi } from 'vitest';
import { FractalProcessor } from './core';
import type { LLMProvider, ProcessOptions } from './types';

describe('FractalProcessor - Chunking Edge Cases for Branch Coverage', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  it('handles text ending exactly at chunk boundary', () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 10,
      overlapSize: 0,
    });

    const chunks = (processor as any).splitIntoChunks('a'.repeat(10));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('a'.repeat(10));
  });

  it('handles pattern match at search window end', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 30,
      overlapSize: 5,
    });

    const text = 'a'.repeat(28) + '\u3002\n' + 'b'.repeat(50);

    const chunks: string[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk) => {
        chunks.push(chunk);
        return { items: [], summary: '' };
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    await processor.process(text, options);

    expect(chunks[0]).toContain('\u3002\n');
  });

  it('handles absPos at various boundary conditions', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 20,
      overlapSize: 3,
    });

    const text = 'a'.repeat(15) + '\n\n' + 'b'.repeat(10) + ',' + 'c'.repeat(30);

    const chunks: string[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk) => {
        chunks.push(chunk);
        return { items: [], summary: '' };
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    await processor.process(text, options);

    expect(chunks[0]).toMatch(/\n\n$/);
  });

  it('handles all regex patterns without matches', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 15,
      overlapSize: 0,
    });

    const text = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

    const chunks: string[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk) => {
        chunks.push(chunk);
        return { items: [], summary: '' };
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    await processor.process(text, options);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].length).toBeLessThanOrEqual(15);
  });

  it('handles match found but not better than current best', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 25,
      overlapSize: 0,
    });

    const text = 'a'.repeat(20) + ',' + 'b'.repeat(20) + '\n\n' + 'c'.repeat(30);

    const chunks: string[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk) => {
        chunks.push(chunk);
        return { items: [], summary: '' };
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    await processor.process(text, options);

    expect(chunks[0]).toContain(',');
  });

  it('handles search start at zero', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 600,
      overlapSize: 0,
    });

    const text = 'short text\u3002with break';

    const chunks: string[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk) => {
        chunks.push(chunk);
        return { items: [], summary: '' };
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    await processor.process(text, options);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('processes with various overlap scenarios', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 10,
      overlapSize: 15,
    });

    const text = 'a'.repeat(25);

    const chunks: string[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk) => {
        chunks.push(chunk);
        return { items: [], summary: '' };
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    await processor.process(text, options);

    expect(chunks.length).toBeGreaterThan(0);
    const totalLength = chunks.join('').length;
    expect(totalLength).toBeGreaterThanOrEqual(text.length);
  });

  it('handles exact match at end position', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 10,
      overlapSize: 2,
    });

    const text = 'a'.repeat(10) + ',' + 'b'.repeat(20);

    const chunks: string[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk) => {
        chunks.push(chunk);
        return { items: [], summary: '' };
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    await processor.process(text, options);

    expect(chunks[0]).toContain(',');
  });

  it('handles text with boundaries correctly', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 20,
      overlapSize: 0,
    });

    const text = 'First part. Second part. Third part.';

    const chunks: string[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk) => {
        chunks.push(chunk);
        return { items: [], summary: '' };
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    await processor.process(text, options);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toContain('First part');
  });
});

describe('FractalProcessor - Additional Branch Coverage', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  it('handles start advancing by exactly 1 when overlap creates infinite loop risk', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 5,
      overlapSize: 10,
    });

    const text = 'abcdefghijklmnop';

    const chunks: string[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk) => {
        chunks.push(chunk);
        return { items: [], summary: '' };
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    await processor.process(text, options);

    expect(chunks.length).toBeGreaterThan(1);
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk).toContain('p');
  });
});
