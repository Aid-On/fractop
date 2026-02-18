/**
 * FractoP Final Coverage Tests - Stream and Config
 */

import { describe, it, expect, vi } from 'vitest';
import { FractalProcessor } from './core';
import type { LLMProvider, ProcessOptions } from './types';

describe('FractalProcessor - ProcessStream Error Handling', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  it('handles processStream correctly', async () => {
    const processor = new FractalProcessor(mockLLM);

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({ items: ['item1', 'item2'], summary: 's' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    const items: string[] = [];
    for await (const item of processor.processStream('test', options)) {
      items.push(item);
    }

    expect(items).toEqual(['item1', 'item2']);
  });

  it('handles processAsStream error in generator', async () => {
    const processor = new FractalProcessor(mockLLM);

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockRejectedValue(new Error('Context generation failed')),
      processChunk: vi.fn().mockResolvedValue({ items: ['item'], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    const stream = processor.processAsStream('test', options);

    let errorReceived: Error | null = null;
    const subscription = stream.subscribe({
      next: () => {},
      error: (err) => { errorReceived = err; },
      complete: () => {},
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(errorReceived).toBeInstanceOf(Error);
    expect(errorReceived?.message).toBe('Context generation failed');

    subscription.unsubscribe();
  });

  it('successfully completes processAsStream', async () => {
    const processor = new FractalProcessor(mockLLM);

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockResolvedValue({
        items: ['item1', 'item2'],
        summary: ''
      }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item) => item,
    };

    const stream = processor.processAsStream('test', options);

    const collected: string[] = [];
    let completed = false;

    const subscription = stream.subscribe({
      next: (item) => collected.push(item),
      error: () => {},
      complete: () => { completed = true; },
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(collected).toEqual(['item1', 'item2']);
    expect(completed).toBe(true);

    subscription.unsubscribe();
  });
});

describe('FractalProcessor - getLLM and getConfig methods', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  it('getLLM returns the correct LLM provider instance', () => {
    const customLLM: LLMProvider = {
      chat: vi.fn().mockResolvedValue('custom response'),
    };

    const processor = new FractalProcessor(customLLM);
    const retrievedLLM = processor.getLLM();

    expect(retrievedLLM).toBe(customLLM);
    expect(retrievedLLM.chat).toBe(customLLM.chat);
  });

  it('getConfig returns complete configuration', () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 8000,
      overlapSize: 400,
      minResultCount: 25,
      supplementCount: 40,
      parallelProcessing: true,
      concurrency: 5,
      enableStreaming: true,
      timeout: 120000,
      chunkTimeout: 30000,
      maxRetries: 5,
      retryDelay: 500,
      circuitBreakerThreshold: 4,
    });

    const config = processor.getConfig();

    expect(config.chunkSize).toBe(8000);
    expect(config.overlapSize).toBe(400);
    expect(config.minResultCount).toBe(25);
    expect(config.supplementCount).toBe(40);
    expect(config.parallelProcessing).toBe(true);
    expect(config.concurrency).toBe(5);
    expect(config.enableStreaming).toBe(true);
    expect(config.timeout).toBe(120000);
    expect(config.chunkTimeout).toBe(30000);
    expect(config.maxRetries).toBe(5);
    expect(config.retryDelay).toBe(500);
    expect(config.circuitBreakerThreshold).toBe(4);
  });
});
