/**
 * FractoP Branch Coverage Tests
 * Tests to improve branch coverage to 90%+
 */

import { describe, it, expect, vi } from 'vitest';
import { FractalProcessor } from './core';
import type { LLMProvider, ProcessOptions } from './types';

describe('FractalProcessor - Branch Coverage', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  describe('Chunking Branch Coverage', () => {
    it('finds match at exact boundary position', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 20,
        overlapSize: 5,
      });

      // Create text where match is exactly at end + 200
      const text = 'a'.repeat(18) + '。 ' + 'b'.repeat(180) + '。 ' + 'c'.repeat(50);
      
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
    });

    it('finds paragraph boundary first', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 30,
        overlapSize: 0,
      });

      // Text with paragraph boundary within search window
      const text = 'a'.repeat(25) + '\n\n' + 'b'.repeat(30);
      
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
      
      // Should split at paragraph boundary
      expect(chunks[0]).toMatch(/\n\n$/);
    });

    it('handles match exactly at start position', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 20,
        overlapSize: 5,
      });

      // Pattern match right at start
      const text = '。Text that continues for a while and then some more';
      
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
    });

    it('handles search window extending beyond text end', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 100,
        overlapSize: 10,
      });

      // Short text where search window would exceed text length
      const text = 'Short text。End';
      
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
      expect(chunks).toEqual([text]);
    });

    it('handles absPos exactly at end boundary', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 10,
        overlapSize: 2,
      });

      // Create scenario where absPos == end + 200
      const text = 'a'.repeat(8) + ',' + 'b'.repeat(192) + ',' + 'c'.repeat(20);
      
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
    });

    it('handles negative start position after overlap', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 5,
        overlapSize: 10, // Larger than chunk
      });

      const text = 'abcdefghij';
      
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
      
      // Should handle negative start correctly
      expect(chunks[chunks.length - 1]).toContain('j');
    });

    it('processes with start exactly at text length', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 10,
        overlapSize: 0,
      });

      const text = 'a'.repeat(10); // Exactly one chunk
      
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

    it('finds all boundary types in priority order', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 50,
        overlapSize: 0,
      });

      // Text with all boundary types
      const text = 'a'.repeat(40) + '\n\n' + 'b'.repeat(10) + '。 ' + 'c'.repeat(10) + ', ' + 'd'.repeat(50);
      
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
      
      // Should prefer paragraph boundary
      expect(chunks[0]).toMatch(/\n\n$/);
    });
  });

  describe('Processing Branch Coverage', () => {
    it('handles callbacks being undefined', async () => {
      const processor = new FractalProcessor(mockLLM);
      
      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn().mockResolvedValue({ 
          items: ['item'],
          summary: ''
        }),
        mergeResults: (results) => ({ 
          items: results.flat(), 
          needsSupplement: false 
        }),
        getKey: (item) => item,
      };

      // No callbacks provided
      const result = await processor.processWithMetadata('test', options);
      expect(result.items).toEqual(['item']);
    });

    it('handles onError returning promise', async () => {
      const processor = new FractalProcessor(mockLLM);
      
      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockRejectedValue(new Error('fail')),
        processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
        mergeResults: () => ({ items: [], needsSupplement: false }),
        getKey: (item) => item,
      };

      const callbacks = {
        onError: vi.fn().mockResolvedValue(['async-recovered']),
      };

      const result = await processor.processWithMetadata('test', options, callbacks);
      expect(result.items).toEqual(['async-recovered']);
    });

    it('handles processChunk with falsy summary', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 10,
      });
      
      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn()
          .mockResolvedValueOnce({ items: ['a'], summary: '' })
          .mockResolvedValueOnce({ items: ['b'], summary: null as any })
          .mockResolvedValueOnce({ items: ['c'] }), // undefined summary
        mergeResults: (results) => ({ 
          items: results.flat(), 
          needsSupplement: false 
        }),
        getKey: (item) => item,
      };

      const result = await processor.process('a'.repeat(30), options);
      expect(result).toEqual(['a', 'b', 'c']);
    });
  });
});