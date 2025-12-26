/**
 * FractoP Final Coverage Tests
 * Tests to achieve 90%+ branch coverage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FractalProcessor } from './core';
import type { LLMProvider, ProcessOptions } from './types';

describe('FractalProcessor - Final Coverage', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  describe('ProcessStream Error Handling', () => {
    it('handles errors in processStream generator', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 10,
      });

      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn().mockRejectedValue(new Error('Stream chunk error')),
        mergeResults: () => ({ items: [], needsSupplement: false }),
        getKey: (item) => item,
      };

      const items: string[] = [];
      let errorCaught = false;
      
      try {
        for await (const item of processor.processStream('a'.repeat(30), options)) {
          items.push(item);
        }
      } catch (error) {
        // Errors in chunks are handled gracefully
        errorCaught = true;
      }
      
      // Should not throw, just skip failed chunks
      expect(errorCaught).toBe(false);
      expect(items).toEqual([]);
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

      // Wait for async processing
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

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(collected).toEqual(['item1', 'item2']);
      expect(completed).toBe(true);
      
      subscription.unsubscribe();
    });
  });

  describe('getLLM and getConfig methods', () => {
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

  describe('Chunking Edge Cases for Branch Coverage', () => {
    it('handles text ending exactly at chunk boundary', () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 10,
        overlapSize: 0,
      });

      // Private method access via any cast for testing
      const chunks = (processor as any).splitIntoChunks('a'.repeat(10));
      
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('a'.repeat(10));
    });

    it('handles pattern match at search window end', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 30,
        overlapSize: 5,
      });

      // Text where best break is found in search window
      const text = 'a'.repeat(28) + '。\n' + 'b'.repeat(50);
      
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
      
      // Should find the sentence boundary
      expect(chunks[0]).toContain('。\n');
    });

    it('handles absPos at various boundary conditions', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 20,
        overlapSize: 3,
      });

      // Create text with breaks at specific positions
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
      
      // Should break at paragraph boundary first
      expect(chunks[0]).toMatch(/\n\n$/);
    });

    it('handles all regex patterns without matches', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 15,
        overlapSize: 0,
      });

      // Text with no natural boundaries (only letters)
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
      
      // Should still split at chunk size
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].length).toBeLessThanOrEqual(15);
    });

    it('handles match found but not better than current best', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 25,
        overlapSize: 0,
      });

      // Text with late paragraph boundary
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
      
      // Should find comma first (within range)
      expect(chunks[0]).toContain(',');
    });

    it('handles search start at zero', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 600, // Large enough that searchStart would be negative
        overlapSize: 0,
      });

      const text = 'short text。with break';
      
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
      
      // Should handle the entire text as one chunk
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('processes with various overlap scenarios', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 10,
        overlapSize: 15, // Larger than chunk
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
      
      // Should handle negative start positions correctly
      expect(chunks.length).toBeGreaterThan(0);
      const totalLength = chunks.join('').length;
      expect(totalLength).toBeGreaterThanOrEqual(text.length);
    });

    it('handles exact match at end position', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 10,
        overlapSize: 2,
      });

      // Pattern at exact boundary
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
      
      // Should find the comma at position 10
      expect(chunks[0]).toContain(',');
    });

    it('handles multiple matches with only first valid', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 20,
        overlapSize: 0,
      });

      // Multiple sentence boundaries but only first is in range
      const text = 'First sentence。 ' + 'a'.repeat(50) + '。 Last';
      
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
      
      // First chunk should end at first sentence boundary
      expect(chunks[0]).toBe('First sentence。 ');
    });
  });

  describe('Additional Branch Coverage', () => {
    it('handles start advancing by exactly 1 when overlap creates infinite loop risk', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 5,
        overlapSize: 10, // Overlap larger than chunk
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
      
      // Should still make progress through the text
      expect(chunks.length).toBeGreaterThan(1);
      // All text should be covered
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk).toContain('p');
    });
  });
});