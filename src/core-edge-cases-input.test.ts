/**
 * FractoP Core Edge Cases Tests - Input and Configuration
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

describe('FractalProcessor - Empty and Minimal Input', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('handles empty text input', async () => {
    const processor = new FractalProcessor<string>(llm);
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
    });

    const result = await processor.process('', options);
    expect(result).toEqual([]);
  });

  it('handles single character input', async () => {
    const processor = new FractalProcessor<string>(llm);
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({ items: ['a'], summary: '' }),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
    });

    const result = await processor.process('a', options);
    expect(result).toEqual(['a']);
  });

  it('handles input exactly at chunk boundary', async () => {
    const processor = new FractalProcessor<string>(llm, { chunkSize: 100 });
    const text = 'a'.repeat(100);
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({ items: ['item'], summary: '' }),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
    });

    await processor.process(text, options);
    expect(options.processChunk).toHaveBeenCalledTimes(1);
  });

  it('handles input at chunk + 1 character', async () => {
    const processor = new FractalProcessor<string>(llm, { chunkSize: 100, overlapSize: 10 });
    const text = 'a'.repeat(101);
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({ items: ['item'], summary: '' }),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
    });

    await processor.process(text, options);
    expect(options.processChunk).toHaveBeenCalledTimes(2);
  });
});

describe('FractalProcessor - Unicode and Special Characters', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('handles emoji and unicode correctly', async () => {
    const processor = new FractalProcessor<string>(llm, { chunkSize: 10 });
    const text = '\uD83C\uDF89\uD83C\uDF8A\uD83C\uDF88\uD83C\uDF81\uD83C\uDF80\uD83D\uDC9D\uD83D\uDC96\uD83D\uDC97\uD83D\uDC93\uD83D\uDC95';
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({ items: ['emoji'], summary: '' }),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
    });

    await processor.process(text, options);
    expect(options.processChunk).toHaveBeenCalled();
  });

  it('handles CJK characters properly', async () => {
    const processor = new FractalProcessor<string>(llm, { chunkSize: 50 });
    const text = '\u65E5\u672C\u8A9E\u306E\u30C6\u30AD\u30B9\u30C8\u3002\u4E2D\u6587\u6587\u672C\u3002\uD55C\uAD6D\uC5B4 \uD14D\uC2A4\uD2B8\u3002';
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({ items: ['cjk'], summary: '' }),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
    });

    await processor.process(text, options);
    expect(options.processChunk).toHaveBeenCalled();
  });

  it('handles mixed newlines correctly', async () => {
    const processor = new FractalProcessor<string>(llm, { chunkSize: 50 });
    const text = 'Line 1\nLine 2\r\nLine 3\r\n\r\nParagraph 2';
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({ items: ['line'], summary: '' }),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
    });

    await processor.process(text, options);
    expect(options.processChunk).toHaveBeenCalled();
  });
});

describe('FractalProcessor - Extreme Configurations', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('handles very small chunk size', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 1,
      overlapSize: 0
    });
    const text = 'abc';
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
    });

    await processor.process(text, options);
    expect(options.processChunk).toHaveBeenCalledTimes(3);
  });

  it('handles overlap larger than chunk size', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 20
    });
    const text = 'a'.repeat(30);
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
    });

    await processor.process(text, options);
    expect(options.processChunk).toHaveBeenCalled();
  });

  it('handles zero retry configuration', async () => {
    const processor = new FractalProcessor<string>(llm, {
      maxRetries: 0,
      chunkTimeout: 100
    });

    const options = createMockOptions<string>({
      processChunk: vi.fn().mockRejectedValue(new Error('fail')),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
    });

    const result = await processor.processWithMetadata('test', options);
    expect(result.chunksFailed).toBeGreaterThan(0);
  });

  it('handles immediate circuit breaker', async () => {
    const processor = new FractalProcessor<string>(llm, {
      circuitBreakerThreshold: 1,
      chunkSize: 10,
      maxRetries: 1,
      retryDelay: 1
    });

    const text = 'a'.repeat(30);
    const options = createMockOptions<string>({
      processChunk: vi.fn().mockRejectedValue(new Error('fail')),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
    });

    const result = await processor.processWithMetadata(text, options);
    expect(result.circuitBreakerTripped).toBe(true);
  });
});
