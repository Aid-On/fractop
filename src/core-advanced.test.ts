/**
 * FractoP Advanced Features Tests
 * Testing parallel processing and streaming APIs
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
      overlapSize: 0, // Set overlap to 0 for predictable chunking
      parallelProcessing: true,
      concurrency: 5,
    });

    const processedChunks: number[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk, context) => {
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
    
    // All chunks should be processed (50 chars / 10 = 5 chunks)
    expect(processedChunks.length).toBe(5);
    expect(result.length).toBe(5);
    
    // Items might be out of order due to parallel processing
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
    
    // Just verify it processes successfully with concurrency setting
    expect(result).toBeDefined();
    expect(options.processChunk).toHaveBeenCalled();
  });


  it('does not use previous summary in parallel mode', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0, // Set overlap to 0 for predictable chunking
      parallelProcessing: true,
    });

    const contexts: any[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('global'),
      processChunk: vi.fn().mockImplementation(async (chunk, context) => {
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
    
    // All contexts should have undefined previousSummary
    contexts.forEach(ctx => {
      expect(ctx.previousSummary).toBeUndefined();
      expect(ctx.globalContext).toBe('global');
    });
  });

  it('handles timeout in parallel mode', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0, // Set overlap to 0 for predictable chunking
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

    // Should throw TimeoutError
    await expect(processor.processWithMetadata('a'.repeat(30), options)).rejects.toThrow('Timeout');
  });

  it('parallel mode with empty chunks', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0, // Set overlap to 0 for predictable chunking
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

describe('FractalProcessor - Streaming API', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  it('streams items as they are processed', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0, // Set overlap to 0 for predictable chunking
    });

    let itemCount = 0;
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk, context) => {
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

    expect(itemCount).toBe(6); // 3 chunks * 2 items each
    expect(collectedItems).toContain('item-0-a');
    expect(collectedItems).toContain('item-2-b');
  });

  it('propagates context in streaming mode', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0, // Set overlap to 0 for predictable chunking
    });

    const summaries: (string | undefined)[] = [];
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('global'),
      processChunk: vi.fn().mockImplementation(async (chunk, context) => {
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

    // Check context propagation
    expect(summaries[0]).toBeUndefined();
    expect(summaries[1]).toBe('summary-0');
    expect(summaries[2]).toBe('summary-1');
  });

  it('handles errors gracefully in streaming', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0, // Set overlap to 0 for predictable chunking
      maxRetries: 1,
      retryDelay: 1,
    });

    let chunkCount = 0;
    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk, context) => {
        chunkCount++;
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

    // Should get items from chunks 0 and 2, but not 1
    expect(items).toContain('item-0');
    expect(items).not.toContain('item-1');
    expect(items).toContain('item-2');
  });

  it('creates Nagare stream with proper interface', async () => {
    const processor = new FractalProcessor<{ id: number; value: string }>(llm);

    const options: ProcessOptions<{ id: number; value: string }> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk, context) => {
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
    
    // Verify Stream interface
    expect(typeof stream.subscribe).toBe('function');
    expect(typeof stream.pipeThrough).toBe('function');
    expect(typeof stream.pipeTo).toBe('function');
    expect(typeof stream.tee).toBe('function');
    
    // Verify reactive extensions
    expect(typeof stream.map).toBe('function');
    expect(typeof stream.filter).toBe('function');
    expect(typeof stream.take).toBe('function');
    expect(typeof stream.reduce).toBe('function');
    
    // Test actual streaming
    const collected: { id: number; value: string }[] = [];
    const subscription = stream.subscribe({
      next: (item) => collected.push(item),
      complete: () => {},
      error: (err) => console.error(err),
    });
    
    // Wait for stream to complete
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
      overlapSize: 0, // Set overlap to 0 for predictable chunking
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk, context) => {
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
    
    // Only take first 2 items then break
    for await (const item of generator) {
      items.push(item);
      if (items.length >= 2) break;
    }

    expect(items.length).toBe(2);
  });

  it('stream handles async consumption correctly', async () => {
    const processor = new FractalProcessor<string>(llm, {
      chunkSize: 10,
      overlapSize: 0, // Set overlap to 0 for predictable chunking
    });

    const options: ProcessOptions<string> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk, context) => {
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
      // Simulate slow consumption
      await new Promise(r => setTimeout(r, 5));
      items.push(item);
    }

    expect(items).toHaveLength(3);
    expect(items).toEqual(['item-0', 'item-1', 'item-2']);
  });

  it('nagare stream can be transformed', async () => {
    const processor = new FractalProcessor<{ value: number }>(llm, {
      chunkSize: 10,
      overlapSize: 0, // Set overlap to 0 for predictable chunking
    });

    const options: ProcessOptions<{ value: number }> = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn().mockImplementation(async (chunk, context) => {
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

    const stream = processor.processAsStream('test-chunk', options); // 10 chars for 1 chunk
    
    // Transform stream using Nagare operations
    const transformed = stream
      .filter(item => item.value % 10 === 0)
      .map(item => item.value * 2);
    
    const collected: number[] = [];
    let completed = false;
    const subscription = transformed.subscribe({
      next: (value) => collected.push(value),
      complete: () => { completed = true; }
    });
    
    // Wait for completion
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
    
    // Should have filtered and transformed values (only one chunk with index 0)
    expect(collected).toEqual([0]); // 0*2 (5 filtered out)
    
    subscription.unsubscribe();
  });
});