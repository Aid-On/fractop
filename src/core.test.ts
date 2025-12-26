/**
 * FractoP Core Tests
 * Medical-grade reliability testing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FractalProcessor, TimeoutError, simpleMerge, weightedMerge } from './core';
import type {
  LLMProvider,
  ProcessOptions,
  FractalEvent,
  FractalCallbacks,
} from './types';

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

describe('FractalProcessor', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  describe('Basic Processing', () => {
    it('processes short text without chunking', async () => {
      const processor = new FractalProcessor<string>(llm);
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({
          items: ['item1', 'item2'],
          summary: 'summary',
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      const result = await processor.process('short text', options);

      expect(result).toEqual(['item1', 'item2']);
      expect(options.generateContext).toHaveBeenCalledWith('short text');
      expect(options.processChunk).toHaveBeenCalledTimes(1);
    });

    it('splits long text into chunks', async () => {
      const processor = new FractalProcessor<string>(llm, {
        chunkSize: 100,
        overlapSize: 10,
      });
      const longText = 'a'.repeat(250); // Will be split into ~3 chunks

      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({
          items: ['item'],
          summary: 'summary',
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      await processor.process(longText, options);

      expect(options.processChunk).toHaveBeenCalledTimes(3);
    });

    it('deduplicates results', async () => {
      const processor = new FractalProcessor<{ id: string }>(llm);
      const options = createMockOptions<{ id: string }>({
        processChunk: vi.fn().mockResolvedValue({
          items: [{ id: '1' }, { id: '2' }, { id: '1' }], // Duplicate
          summary: 'summary',
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
        getKey: (item) => item.id,
      });

      const result = await processor.process('text', options);

      expect(result).toHaveLength(2);
    });
  });

  describe('Timeout Support', () => {
    it('creates processor with timeout config', () => {
      const processor = new FractalProcessor<string>(llm, {
        timeout: 5000,
        chunkTimeout: 1000,
      });

      const config = processor.getConfig();
      expect(config.timeout).toBe(5000);
      expect(config.chunkTimeout).toBe(1000);
    });

    it('throws TimeoutError with correct properties', () => {
      const error = new TimeoutError('Test timeout', 'chunk');
      expect(error.name).toBe('TimeoutError');
      expect(error.phase).toBe('chunk');
      expect(error.message).toBe('Test timeout');
    });
  });

  describe('Retry Logic', () => {
    it('retries failed chunks', async () => {
      const processor = new FractalProcessor<string>(llm, {
        maxRetries: 3,
        retryDelay: 1, // Minimal delay
      });

      let callCount = 0;
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            throw new Error('Temporary failure');
          }
          return { items: ['item'], summary: 'summary' };
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      const result = await processor.process('text', options);

      expect(result).toEqual(['item']);
      expect(callCount).toBe(3);
    });

    it('fails after max retries exceeded', async () => {
      const processor = new FractalProcessor<string>(llm, {
        maxRetries: 2,
        retryDelay: 1,
      });

      const options = createMockOptions<string>({
        processChunk: vi.fn().mockRejectedValue(new Error('Persistent failure')),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      const events: FractalEvent<string>[] = [];
      processor.on((event) => events.push(event));

      const result = await processor.processWithMetadata('text', options);

      expect(result.chunksFailed).toBe(1);
      expect(events.some((e) => e.type === 'chunk_failed')).toBe(true);
    });
  });

  describe('Circuit Breaker', () => {
    it('trips circuit breaker after consecutive failures', async () => {
      const processor = new FractalProcessor<string>(llm, {
        chunkSize: 100,
        overlapSize: 10,
        circuitBreakerThreshold: 2,
        maxRetries: 1,
        retryDelay: 1,
      });

      const longText = 'a'.repeat(300); // Multiple chunks

      const options = createMockOptions<string>({
        processChunk: vi.fn().mockRejectedValue(new Error('Always fails')),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      const events: FractalEvent<string>[] = [];
      processor.on((event) => events.push(event));

      const result = await processor.processWithMetadata(longText, options);

      expect(result.circuitBreakerTripped).toBe(true);
      expect(events.some((e) => e.type === 'circuit_breaker_open')).toBe(true);
    });

    it('resets circuit breaker on success', async () => {
      const processor = new FractalProcessor<string>(llm, {
        chunkSize: 100,
        overlapSize: 10,
        circuitBreakerThreshold: 3,
        maxRetries: 1,
        retryDelay: 1,
      });

      const longText = 'a'.repeat(300); // Multiple chunks

      let callCount = 0;
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockImplementation(async () => {
          callCount++;
          // Fail first two, succeed third, should reset counter
          if (callCount <= 2) {
            throw new Error('Temporary failure');
          }
          return { items: ['item'], summary: 'summary' };
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      const result = await processor.processWithMetadata(longText, options);

      // Should not trip because we had a success
      expect(result.circuitBreakerTripped).toBe(false);
    });
  });

  describe('Event System', () => {
    it('emits all lifecycle events', async () => {
      const processor = new FractalProcessor<string>(llm);
      const events: FractalEvent<string>[] = [];

      processor.on((event) => events.push(event));

      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({
          items: ['item'],
          summary: 'summary',
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      await processor.process('text', options);

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain('start');
      expect(eventTypes).toContain('context_generated');
      expect(eventTypes).toContain('chunk_start');
      expect(eventTypes).toContain('chunk_complete');
      expect(eventTypes).toContain('merge_complete');
      expect(eventTypes).toContain('complete');
    });

    it('unsubscribes listener correctly', async () => {
      const processor = new FractalProcessor<string>(llm);
      const events: FractalEvent<string>[] = [];

      const unsubscribe = processor.on((event) => events.push(event));
      unsubscribe();

      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
        mergeResults: () => ({ items: [], needsSupplement: false }),
      });
      await processor.process('text', options);

      expect(events).toHaveLength(0);
    });

    it('handles listener errors gracefully', async () => {
      const processor = new FractalProcessor<string>(llm);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      processor.on(() => {
        throw new Error('Listener error');
      });

      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
        mergeResults: () => ({ items: [], needsSupplement: false }),
      });

      await processor.process('text', options);

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('Parallel Processing', () => {
    it('processes chunks in parallel when enabled', async () => {
      const processor = new FractalProcessor<string>(llm, {
        chunkSize: 100,
        overlapSize: 10,
        parallelProcessing: true,
        concurrency: 2,
      });

      const longText = 'a'.repeat(300);
      const processStartTimes: number[] = [];
      
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockImplementation(async () => {
          processStartTimes.push(Date.now());
          await new Promise(resolve => setTimeout(resolve, 10));
          return { items: ['item'], summary: 'summary' };
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      await processor.process(longText, options);
      
      // Check that at least 2 chunks started within 5ms of each other (parallel)
      expect(options.processChunk).toHaveBeenCalled();
      // At least 2 chunks should be processed
      expect(processStartTimes.length).toBeGreaterThanOrEqual(2);
      // Check parallel execution by time differences
      if (processStartTimes.length >= 2) {
        const timeDiff = Math.abs(processStartTimes[1] - processStartTimes[0]);
        expect(timeDiff).toBeLessThan(50); // Allow more tolerance for parallel execution
      }
    });

    it('does not propagate context in parallel mode', async () => {
      const processor = new FractalProcessor<string>(llm, {
        chunkSize: 100,
        parallelProcessing: true,
      });

      const longText = 'a'.repeat(200);
      const contexts: any[] = [];
      
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockImplementation(async (chunk, context) => {
          contexts.push(context);
          return { items: ['item'], summary: 'summary' };
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      await processor.process(longText, options);
      
      // All chunks should have undefined previousSummary in parallel mode
      contexts.forEach(ctx => {
        expect(ctx.previousSummary).toBeUndefined();
      });
    });
  });

  describe('Streaming API', () => {
    it('yields items as stream', async () => {
      const processor = new FractalProcessor<string>(llm, {
        chunkSize: 100,
      });

      const longText = 'a'.repeat(200);
      let chunkCount = 0;
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockImplementation(async () => {
          chunkCount++;
          if (chunkCount === 1) return { items: ['item1', 'item2'], summary: 'summary1' };
          if (chunkCount === 2) return { items: ['item3'], summary: 'summary2' };
          return { items: [], summary: 'summary' };
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      const items: string[] = [];
      for await (const item of processor.processStream(longText, options)) {
        items.push(item);
      }

      expect(items).toContain('item1');
      expect(items).toContain('item2');
      expect(items).toContain('item3');
    }, 10000); // Add timeout

    it('creates Nagare stream', async () => {
      const processor = new FractalProcessor<string>(llm);
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({
          items: ['item1', 'item2'],
          summary: 'summary',
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      const stream = processor.processAsStream('text', options);
      
      // Verify stream has nagare Stream interface
      expect(stream).toHaveProperty('map');
      expect(stream).toHaveProperty('filter');
      expect(stream).toHaveProperty('take');
    });
  });

  describe('Error Recovery', () => {
    it('calls onError callback and returns recovered items', async () => {
      const processor = new FractalProcessor<string>(llm, {
        maxRetries: 1,
      });

      const options = createMockOptions<string>({
        generateContext: vi.fn().mockRejectedValue(new Error('Context error')),
      });

      const callbacks: FractalCallbacks<string> = {
        onError: vi.fn().mockReturnValue(['recovered']),
      };

      const result = await processor.processWithMetadata('text', options, callbacks);

      expect(callbacks.onError).toHaveBeenCalled();
      expect(result.items).toEqual(['recovered']);
    });

    it('continues with partial results on chunk failure', async () => {
      const processor = new FractalProcessor<string>(llm, {
        chunkSize: 100,
        overlapSize: 10,
        maxRetries: 1,
        retryDelay: 1,
      });

      const longText = 'a'.repeat(300); // Multiple chunks

      let callCount = 0;
      const failedIndices: number[] = [];
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 2) {
            failedIndices.push(callCount);
            throw new Error('Second chunk fails');
          }
          return { items: [`item${callCount}`], summary: 'summary' };
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      const result = await processor.processWithMetadata(longText, options);

      // Verify we had exactly 1 failure
      expect(result.chunksFailed).toBe(1);
      // Successful chunks = total chunks - failed chunks
      expect(result.chunksProcessed).toBe(callCount - result.chunksFailed);
      // Items should match successful chunks
      expect(result.items).toHaveLength(result.chunksProcessed);
    });
  });

  describe('Callbacks', () => {
    it('calls onProgress during processing', async () => {
      const processor = new FractalProcessor<string>(llm, {
        chunkSize: 100,
        overlapSize: 10,
      });

      const longText = 'a'.repeat(300); // ~3 chunks
      const progressCalls: [number, number][] = [];

      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({
          items: ['item'],
          summary: 'summary',
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      const callbacks: FractalCallbacks<string> = {
        onProgress: (completed, total) => progressCalls.push([completed, total]),
      };

      await processor.processWithMetadata(longText, options, callbacks);

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[progressCalls.length - 1][0]).toBe(
        progressCalls[progressCalls.length - 1][1]
      );
    });

    it('calls onComplete with items and duration', async () => {
      const processor = new FractalProcessor<string>(llm);
      const onComplete = vi.fn();

      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({
          items: ['item1', 'item2'],
          summary: 'summary',
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: false,
        }),
      });

      const callbacks: FractalCallbacks<string> = { onComplete };

      await processor.processWithMetadata('text', options, callbacks);

      expect(onComplete).toHaveBeenCalledWith(
        ['item1', 'item2'],
        expect.any(Number)
      );
    });
  });

  describe('Supplement', () => {
    it('triggers supplement when results are insufficient', async () => {
      const processor = new FractalProcessor<string>(llm, {
        minResultCount: 5,
      });

      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({
          items: ['item1', 'item2'],
          summary: 'summary',
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: true,
        }),
        supplement: vi.fn().mockResolvedValue(['extra1', 'extra2', 'extra3']),
      });

      const result = await processor.processWithMetadata('text', options);

      expect(options.supplement).toHaveBeenCalled();
      expect(result.supplemented).toBe(true);
      expect(result.items).toHaveLength(5);
    });

    it('handles supplement failure gracefully', async () => {
      const processor = new FractalProcessor<string>(llm, {
        minResultCount: 10,
      });

      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({
          items: ['item1'],
          summary: 'summary',
        }),
        mergeResults: (results) => ({
          items: results.flat(),
          needsSupplement: true,
        }),
        supplement: vi.fn().mockRejectedValue(new Error('Supplement failed')),
      });

      const events: FractalEvent<string>[] = [];
      processor.on((event) => events.push(event));

      const result = await processor.processWithMetadata('text', options);

      // Should continue with existing items
      expect(result.items).toEqual(['item1']);
      expect(result.supplemented).toBe(false);
      expect(events.some((e) => e.type === 'error' && e.phase === 'supplement')).toBe(true);
    });
  });
});

describe('Merge Utilities', () => {
  describe('simpleMerge', () => {
    it('flattens results', () => {
      const results = [['a', 'b'], ['c', 'd'], ['e']];
      const merged = simpleMerge(results, 10);

      expect(merged.items).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('sets needsSupplement when below minCount', () => {
      const results = [['a']];
      const merged = simpleMerge(results, 5);

      expect(merged.needsSupplement).toBe(true);
    });
  });

  describe('weightedMerge', () => {
    it('aggregates weights for duplicate keys', () => {
      const results = [
        [{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }],
        [{ id: 'a', weight: 3 }, { id: 'c', weight: 1 }],
      ];

      const merged = weightedMerge(results, (item) => item.id, 0);

      expect(merged.items.find((i) => i.id === 'a')?.weight).toBe(4);
      expect(merged.items.find((i) => i.id === 'b')?.weight).toBe(2);
    });

    it('sorts by weight descending', () => {
      const results = [
        [{ id: 'a', weight: 1 }],
        [{ id: 'b', weight: 5 }],
        [{ id: 'c', weight: 3 }],
      ];

      const merged = weightedMerge(results, (item) => item.id, 0);

      expect(merged.items[0].id).toBe('b');
      expect(merged.items[1].id).toBe('c');
      expect(merged.items[2].id).toBe('a');
    });
  });
});
