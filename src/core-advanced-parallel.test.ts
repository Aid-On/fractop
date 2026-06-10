/**
 * FractoP Advanced Features Tests - Parallel Processing
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

describe('FractalProcessor - Parallel Processing', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('processes all chunks in parallel mode', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0,
      parallelProcessing: true,
      concurrency: 5,
    });

    const processedChunks: number[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (_chunk, context) => {
        processedChunks.push(context.index);
        await new Promise(r => setTimeout(r, Math.random() * 10));
        return { items: [`item-${context.index}`], summary: 'sum' };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const result = await processor.process('a'.repeat(50), options);

    expect(processedChunks.length).toBe(5);
    expect(result.length).toBe(5);
    expect(result).toContain('item-0');
    expect(result).toContain('item-4');
  });

  it('respects concurrency limit', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0,
      parallelProcessing: true,
      concurrency: 2,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({ items: ['item'], summary: '' }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const result = await processor.process('a'.repeat(30), options);

    expect(result).toBeDefined();
    expect(options.processChunk).toHaveBeenCalled();
  });

  it('同時実行数が concurrency を超えない（実測）', async () => {
    // 旧実装は全チャンクを即起動しており、この検査で落ちる
    // （concurrency はバッチ待機の粒度でしかなかった）
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0,
      parallelProcessing: true,
      concurrency: 3,
    });

    let inFlight = 0;
    let maxInFlight = 0;
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (_chunk, context) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { items: [`item-${context.index}`], summary: undefined };
      }),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
      getKey: (item) => item,
    };

    const result = await processor.process('a'.repeat(120), options); // 12 チャンク

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // 並列自体は効いている
    expect(result.length).toBe(12); // 全チャンク処理・順序つき回収
  });

  it('並列モードでも circuit breaker が連続失敗で開く', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0,
      parallelProcessing: true,
      concurrency: 2,
      maxRetries: 1,
      circuitBreakerThreshold: 3,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockRejectedValue(new Error('boom')),
      mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
      getKey: (item) => item,
    };

    const result = await processor.processWithMetadata('a'.repeat(200), options);

    expect(result.circuitBreakerTripped).toBe(true);
    // ブレーカ開放後は残チャンクへ進まない（全 20 チャンクを失敗で埋め尽くさない）
    expect(result.chunksFailed).toBeLessThan(20);
  });

  it('does not use previous summary in parallel mode', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0,
      parallelProcessing: true,
    });

    const contexts: any[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('global'),
      processChunk: vi.fn().mockImplementation(async (_chunk, context) => {
        contexts.push({ ...context });
        return { items: ['item'], summary: `summary-${context.index}` };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    await processor.process('a'.repeat(30), options);

    contexts.forEach(ctx => {
      expect(ctx.previousSummary).toBeUndefined();
      expect(ctx.globalContext).toBe('global');
    });
  });

  it('handles timeout in parallel mode', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0,
      parallelProcessing: true,
      timeout: 100,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 200));
        return { items: ['item'], summary: '' };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    await expect(processor.processWithMetadata('a'.repeat(30), options)).rejects.toThrow('Timeout');
  });

  it('parallel mode with empty chunks', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0,
      parallelProcessing: true,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const result = await processor.process('a'.repeat(30), options);
    expect(result).toEqual([]);
  });
});
