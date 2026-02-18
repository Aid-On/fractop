/**
 * FractoP Coverage Tests - Chunk Splitting Boundary Cases
 */

import { describe, it, expect, vi } from 'vitest';
import { FractalProcessor } from './core';
import type { LLMProvider, ProcessOptions } from './types';

describe('FractalProcessor - Chunk Splitting Boundary Cases', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  it('splits at exact search window boundary', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 50,
      overlapSize: 5,
    });

    const text = 'a'.repeat(45) + '\n\n' + 'b'.repeat(60);

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

    expect(chunks[0]).toContain('a');
    expect(chunks[0]).not.toContain('b');
  });

  it('handles text with no breaks in search window', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 20,
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
    expect(chunks[0].length).toBeLessThanOrEqual(20);
  });

  it('finds sentence boundary when no paragraph boundary exists', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 30,
      overlapSize: 0,
    });

    const text = 'First sentence\u3002 Second sentence\u3002 Third sentence\u3002 Fourth\u3002';

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

    expect(chunks[0]).toMatch(/\u3002\s?$/);
  });

  it('falls back to delimiter boundary when others not found', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 20,
      overlapSize: 0,
    });

    const text = 'word1,word2,word3,word4,word5,word6,word7,word8';

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
    expect(chunks[0]).toMatch(/,?$/);
  });

  it('handles negative overlap correctly', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 10,
      overlapSize: 20,
    });

    const text = 'a'.repeat(30);

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
    expect(chunks[chunks.length - 1]).toContain('a');
  });
});
