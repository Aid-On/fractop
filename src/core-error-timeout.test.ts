/**
 * FractoP Core Error Handling Tests - Timeout, Retry, Circuit Breaker
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

describe('FractalProcessor - Timeout Handling', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('processes with timeout setting', async () => {
    const processor = new FractalProcessor<string>(llm, {
      timeout: 10000,
      chunkSize: 10,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({ items: ['item'], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    await processor.process('test', options);
    expect(options.processChunk).toHaveBeenCalled();
  });

  it('handles chunk processing correctly', async () => {
    const processor = new FractalProcessor<string>(llm);

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({ items: ['item1'], summary: '' }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const result = await processor.process('test', options);
    expect(result).toEqual(['item1']);
  });

  it('emits events correctly', async () => {
    const processor = new FractalProcessor<string>(llm);

    const events: FractalEvent<string>[] = [];
    processor.on(event => events.push(event));

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    await processor.process('test', options);

    const eventTypes = events.map(e => e.type);
    expect(eventTypes).toContain('start');
    expect(eventTypes).toContain('complete');
  });
});

describe('FractalProcessor - Retry Mechanism', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('retries failed chunks with exponential backoff', async () => {
    const processor = new FractalProcessor<string>(llm, {
      maxRetries: 3,
      retryDelay: 10,
      chunkSize: 100,
    });

    let attemptCount = 0;
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error(`Attempt ${attemptCount}`);
        }
        return { items: ['success'], summary: '' };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const result = await processor.process('test', options);
    expect(result).toContain('success');
    expect(attemptCount).toBe(3);
  });

  it('emits retry events', async () => {
    const processor = new FractalProcessor<string>(llm, {
      maxRetries: 2,
      retryDelay: 1,
    });

    const events: FractalEvent<string>[] = [];
    processor.on(event => events.push(event));

    let attempts = 0;
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) throw new Error('First attempt');
        return { items: ['item'], summary: '' };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    await processor.process('test', options);

    const retryEvents = events.filter(e => e.type === 'chunk_retry');
    expect(retryEvents.length).toBeGreaterThan(0);
    expect(retryEvents[0]).toHaveProperty('attempt');
    expect(retryEvents[0]).toHaveProperty('error');
  });

  it('fails after max retries exceeded', async () => {
    const processor = new FractalProcessor<string>(llm, {
      maxRetries: 2,
      retryDelay: 1,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockRejectedValue(new Error('Always fails')),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const result = await processor.processWithMetadata('test', options);
    expect(result.chunksFailed).toBeGreaterThan(0);
  });
});

describe('FractalProcessor - Circuit Breaker', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('trips circuit breaker after threshold failures', async () => {
    const processor = new FractalProcessor<string>(llm, {
      circuitBreakerThreshold: 2,
      chunkSize: 10,
      maxRetries: 1,
      retryDelay: 1,
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockRejectedValue(new Error('Chunk fail')),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const result = await processor.processWithMetadata('a'.repeat(50), options);

    expect(result.circuitBreakerTripped).toBe(true);
    expect(options.processChunk).toHaveBeenCalledTimes(2);
  });

  it('emits circuit breaker event', async () => {
    const processor = new FractalProcessor<string>(llm, {
      circuitBreakerThreshold: 1,
      chunkSize: 10,
      maxRetries: 1,
      retryDelay: 1,
    });

    const events: FractalEvent<string>[] = [];
    processor.on(event => events.push(event));

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockRejectedValue(new Error('Fail')),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    await processor.processWithMetadata('a'.repeat(20), options);

    const cbEvent = events.find(e => e.type === 'circuit_breaker_open');
    expect(cbEvent).toBeDefined();
    expect(cbEvent?.consecutiveFailures).toBe(1);
  });

  it('resets consecutive failures on success', async () => {
    const processor = new FractalProcessor<string>(llm, {
      circuitBreakerThreshold: 3,
      chunkSize: 10,
      maxRetries: 1,
      retryDelay: 1,
    });

    let chunkIndex = 0;
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async () => {
        chunkIndex++;
        if (chunkIndex <= 2 || chunkIndex === 4) {
          throw new Error('Fail');
        }
        return { items: [`item${chunkIndex}`], summary: '' };
      }),
      mergeResults: (results) => ({
        items: results.flat(),
        needsSupplement: false
      }),
      getKey: (item) => item,
    };

    const result = await processor.processWithMetadata('a'.repeat(50), options);

    expect(result.circuitBreakerTripped).toBe(false);
    expect(result.items).toContain('item3');
  });
});
