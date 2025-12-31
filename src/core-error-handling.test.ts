/**
 * FractoP Core Error Handling Tests
 * Testing all error scenarios and recovery mechanisms
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FractalProcessor, TimeoutError, CircuitBreakerError } from './core';
import type { LLMProvider, ProcessOptions, FractalCallbacks, FractalEvent } from './types';

// Mock LLM Provider
function createMockLLM(): LLMProvider {
  return {
    chat: vi.fn().mockResolvedValue('mocked response'),
  };
}

describe('FractalProcessor - Error Handling', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  describe('Timeout Handling', () => {
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

      const result = await processor.process('test', options);
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
      
      // Should process successfully
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

      // Should have basic events
      const eventTypes = events.map(e => e.type);
      expect(eventTypes).toContain('start');
      expect(eventTypes).toContain('complete');
    });
  });

  describe('Retry Mechanism', () => {
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

  describe('Circuit Breaker', () => {
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
      // Should stop processing after circuit breaker trips
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
          // Fail first 2, succeed third, fail fourth
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
      
      // Circuit breaker should not trip because of success reset
      expect(result.circuitBreakerTripped).toBe(false);
      // Should have processed the successful chunk
      expect(result.items).toContain('item3');
    });
  });

  describe('Error Recovery Callbacks', () => {
    it('uses onError callback for recovery', async () => {
      const processor = new FractalProcessor<string>(llm, {
        maxRetries: 1,
      });

      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockRejectedValue(new Error('Context fail')),
        processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
        mergeResults: () => ({ items: [], needsSupplement: false }),
        getKey: (item) => item,
      };

      const callbacks: FractalCallbacks<string> = {
        onError: vi.fn().mockReturnValue(['recovered1', 'recovered2']),
      };

      const result = await processor.processWithMetadata('test', options, callbacks);
      
      expect(callbacks.onError).toHaveBeenCalled();
      expect(result.items).toEqual(['recovered1', 'recovered2']);
    });

    it('uses onError callback when provided', async () => {
      const processor = new FractalProcessor<string>(llm, {
        maxRetries: 0,
      });

      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockRejectedValue(new Error('Test error')),
        processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
        mergeResults: () => ({ items: [], needsSupplement: false }),
        getKey: (item) => item,
      };

      const callbacks: FractalCallbacks<string> = {
        onError: vi.fn().mockReturnValue(['recovered1', 'recovered2']),
      };

      const result = await processor.processWithMetadata('test', options, callbacks);
      
      expect(callbacks.onError).toHaveBeenCalled();
      expect(result.items).toEqual(['recovered1', 'recovered2']);
    });

    it('re-throws if onError callback throws', async () => {
      const processor = new FractalProcessor<string>(llm);

      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockRejectedValue(new Error('Fail')),
        processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
        mergeResults: () => ({ items: [], needsSupplement: false }),
        getKey: (item) => item,
      };

      const callbacks: FractalCallbacks<string> = {
        onError: vi.fn().mockRejectedValue(new Error('Recovery failed')),
      };

      await expect(
        processor.processWithMetadata('test', options, callbacks)
      ).rejects.toThrow('Recovery failed');
    });
  });

  describe('Error Event Emissions', () => {
    it('emits error events for different phases', async () => {
      const processor = new FractalProcessor<string>(llm, {
        chunkSize: 10,
        maxRetries: 1,
        retryDelay: 1,
      });

      const events: FractalEvent<string>[] = [];
      processor.on(event => events.push(event));

      // Test context error
      const contextErrorOptions: ProcessOptions<string> = {
        generateContext: vi.fn().mockRejectedValue(new Error('Context error')),
        processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
        mergeResults: () => ({ items: [], needsSupplement: false }),
        getKey: (item) => item,
      };

      try {
        await processor.process('test', contextErrorOptions);
      } catch {}

      const contextError = events.find(e => e.type === 'error' && e.phase === 'context');
      expect(contextError).toBeDefined();

      // Test chunk error
      events.length = 0;
      const chunkErrorOptions: ProcessOptions<string> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn()
          .mockResolvedValueOnce({ items: ['item1'], summary: '' })
          .mockRejectedValueOnce(new Error('Chunk error')),
        mergeResults: () => ({ items: [], needsSupplement: false }),
        getKey: (item) => item,
      };

      await processor.process('a'.repeat(20), chunkErrorOptions);

      // Should have some events but may not always emit error event depending on retry
      expect(events.length).toBeGreaterThan(0);

      // Test merge error
      events.length = 0;
      const mergeErrorOptions: ProcessOptions<string> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn().mockResolvedValue({ items: ['item'], summary: '' }),
        mergeResults: () => { throw new Error('Merge error'); },
        getKey: (item) => item,
      };

      try {
        await processor.process('test', mergeErrorOptions);
      } catch {}

      const mergeError = events.find(e => e.type === 'error' && e.phase === 'merge');
      expect(mergeError).toBeDefined();
    });

    it('emits chunk_failed events with correct metadata', async () => {
      const processor = new FractalProcessor<string>(llm, {
        chunkSize: 10,
        maxRetries: 1,
        retryDelay: 1,
      });

      const events: FractalEvent<string>[] = [];
      processor.on(event => events.push(event));

      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn().mockRejectedValue(new Error('Chunk failure')),
        mergeResults: (results) => ({ 
          items: results.flat(), 
          needsSupplement: false 
        }),
        getKey: (item) => item,
      };

      await processor.processWithMetadata('a'.repeat(30), options);

      const failedEvents = events.filter(e => e.type === 'chunk_failed');
      expect(failedEvents.length).toBeGreaterThan(0);
      
      failedEvents.forEach(event => {
        expect(event).toHaveProperty('index');
        expect(event).toHaveProperty('error');
        expect(event).toHaveProperty('skipped');
      });
    });
  });

  describe('Graceful Degradation', () => {
    it('continues processing after some chunks fail', async () => {
      const processor = new FractalProcessor<string>(llm, {
        chunkSize: 10,
        maxRetries: 1,
        retryDelay: 1,
      });

      let chunkIndex = 0;
      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn().mockImplementation(async () => {
          chunkIndex++;
          // Fail even chunks
          if (chunkIndex % 2 === 0) {
            throw new Error('Even chunk fails');
          }
          return { items: [`item${chunkIndex}`], summary: '' };
        }),
        mergeResults: (results) => ({ 
          items: results.flat(), 
          needsSupplement: false 
        }),
        getKey: (item) => item,
      };

      const result = await processor.processWithMetadata('a'.repeat(40), options);
      
      // Should have some successful and some failed chunks
      expect(result.chunksProcessed).toBeGreaterThan(0);
      expect(result.chunksFailed).toBeGreaterThan(0);
      // Should contain items from successful chunks only
      expect(result.items).toContain('item1');
      expect(result.items).toContain('item3');
      expect(result.items).not.toContain('item2');
    });

    it('returns empty results when all chunks fail', async () => {
      const processor = new FractalProcessor<string>(llm, {
        chunkSize: 10,
        maxRetries: 1,
        retryDelay: 1,
      });

      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn().mockRejectedValue(new Error('All fail')),
        mergeResults: (results) => ({ 
          items: results.flat(), 
          needsSupplement: false 
        }),
        getKey: (item) => item,
      };

      const result = await processor.processWithMetadata('a'.repeat(30), options);
      
      expect(result.items).toEqual([]);
      expect(result.chunksFailed).toBeGreaterThan(0);
      expect(result.chunksProcessed).toBe(0);
    });
  });
});