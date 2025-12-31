/**
 * FractoP Coverage Improvement Tests
 * Tests to ensure complete code coverage
 */

import { describe, it, expect, vi } from 'vitest';
import { FractalProcessor } from './core';
import type { LLMProvider, ProcessOptions } from './types';

describe('FractalProcessor - Coverage Tests', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  describe('Utility Methods', () => {
    it('getLLM returns the LLM provider', () => {
      const processor = new FractalProcessor(mockLLM);
      const llm = processor.getLLM();
      expect(llm).toBe(mockLLM);
      expect(llm.chat).toBeDefined();
    });

    it('getConfig returns a copy of configuration', () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 5000,
        overlapSize: 300,
        minResultCount: 20,
      });

      const config = processor.getConfig();
      
      expect(config.chunkSize).toBe(5000);
      expect(config.overlapSize).toBe(300);
      expect(config.minResultCount).toBe(20);
      
      // Verify it's a copy
      config.chunkSize = 10000;
      const config2 = processor.getConfig();
      expect(config2.chunkSize).toBe(5000);
    });
  });

  describe('Chunk Splitting - Boundary Cases', () => {
    it('splits at exact search window boundary', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 50,
        overlapSize: 5,
      });

      // Create text where the best break is right at the search boundary
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
      
      // Should split at paragraph boundary
      expect(chunks[0]).toContain('a');
      expect(chunks[0]).not.toContain('b');
    });

    it('handles text with no breaks in search window', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 20,
        overlapSize: 0,
      });

      // Text with no natural boundaries
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
      
      // Should still split even without boundaries
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].length).toBeLessThanOrEqual(20);
    });

    it('finds sentence boundary when no paragraph boundary exists', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 30,
        overlapSize: 0,
      });

      // Text with only sentence boundaries
      const text = 'First sentence。 Second sentence。 Third sentence。 Fourth。';
      
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
      
      // Should prefer sentence boundaries
      expect(chunks[0]).toMatch(/。\s?$/);
    });

    it('falls back to delimiter boundary when others not found', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 20,
        overlapSize: 0,
      });

      // Text with only commas and spaces
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
      
      // Should split at commas
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0]).toMatch(/,?$/);
    });

    it('handles negative overlap correctly', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 10,
        overlapSize: 20, // Larger than chunk
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
      
      // Should still progress through text
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[chunks.length - 1]).toContain('a');
    });
  });

  describe('Edge Cases in Processing', () => {
    it('handles all empty chunk results', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 10,
      });

      const options: ProcessOptions<any> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
        mergeResults: () => ({ items: [], needsSupplement: false }),
        getKey: (item) => item,
      };

      const result = await processor.process('a'.repeat(30), options);
      expect(result).toEqual([]);
    });

    it('handles processChunk returning undefined summary', async () => {
      const processor = new FractalProcessor(mockLLM, {
        chunkSize: 10,
      });

      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn().mockResolvedValue({ 
          items: ['item'],
          // summary is undefined
        }),
        mergeResults: (results) => ({ 
          items: results.flat(), 
          needsSupplement: false 
        }),
        getKey: (item) => item,
      };

      const result = await processor.process('a'.repeat(20), options);
      expect(result).toContain('item');
    });

    it('handles mergeResults returning empty', async () => {
      const processor = new FractalProcessor(mockLLM);

      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn().mockResolvedValue({ 
          items: ['item'],
          summary: ''
        }),
        mergeResults: () => ({ items: [], needsSupplement: false }),
        getKey: (item) => item,
      };

      const result = await processor.process('test', options);
      expect(result).toEqual([]);
    });

    it('handles supplement throwing error', async () => {
      const processor = new FractalProcessor(mockLLM, {
        minResultCount: 10,
      });

      const options: ProcessOptions<string> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn().mockResolvedValue({ 
          items: ['item'],
          summary: ''
        }),
        mergeResults: () => ({ 
          items: ['item'], 
          needsSupplement: true 
        }),
        supplement: vi.fn().mockRejectedValue(new Error('Supplement failed')),
        getKey: (item) => item,
      };

      // Should continue despite supplement failure
      const result = await processor.processWithMetadata('test', options);
      expect(result.items).toEqual(['item']);
      expect(result.supplemented).toBe(false);
    });
  });

  describe('Deduplication Edge Cases', () => {
    it('deduplicates with complex objects', async () => {
      const processor = new FractalProcessor<{ id: string; data: any }>(mockLLM);

      const options: ProcessOptions<{ id: string; data: any }> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn().mockResolvedValue({ 
          items: [
            { id: '1', data: { value: 'a' } },
            { id: '2', data: { value: 'b' } },
            { id: '1', data: { value: 'c' } }, // Duplicate ID
          ],
          summary: ''
        }),
        mergeResults: (results) => ({ 
          items: results.flat(), 
          needsSupplement: false 
        }),
        getKey: (item) => item.id,
      };

      const result = await processor.process('test', options);
      expect(result).toHaveLength(2);
      expect(result.find(i => i.id === '1')?.data.value).toBe('a'); // First one kept
    });

    it('handles getKey returning same key for different items', async () => {
      const processor = new FractalProcessor<any>(mockLLM);

      const options: ProcessOptions<any> = {
        generateContext: vi.fn().mockResolvedValue('context'),
        processChunk: vi.fn().mockResolvedValue({ 
          items: [
            { id: 1, value: 'first' }, 
            { id: 2, value: 'second' },
            { id: 1, value: 'third' } // Same key as first
          ],
          summary: ''
        }),
        mergeResults: (results) => ({ 
          items: results.flat(), 
          needsSupplement: false 
        }),
        getKey: (item) => item.id.toString(),
      };

      const result = await processor.process('test', options);
      // Should deduplicate based on key
      expect(result).toHaveLength(2);
      expect(result[0].value).toBe('first'); // First occurrence kept
    });
  });

  describe('Event Listener Edge Cases', () => {
    it('handles multiple listeners with different error behaviors', async () => {
      const processor = new FractalProcessor(mockLLM);
      
      const events1: any[] = [];
      const events2: any[] = [];
      
      processor.on(event => events1.push(event));
      processor.on(event => {
        if (event.type === 'chunk_start') throw new Error('Listener error');
        events2.push(event);
      });

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

      await processor.process('test', options);
      
      // First listener should get all events
      expect(events1.length).toBeGreaterThan(0);
      // Second listener should get some events (not chunk_start)
      expect(events2.length).toBeGreaterThan(0);
      expect(events2.find(e => e.type === 'chunk_start')).toBeUndefined();
    });

    it('unsubscribe during event emission', async () => {
      const processor = new FractalProcessor(mockLLM);
      
      let unsubscribe: () => void;
      let eventCount = 0;
      
      unsubscribe = processor.on(event => {
        eventCount++;
        if (event.type === 'context_generated') {
          unsubscribe();
        }
      });

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

      await processor.process('test', options);
      
      // Should only receive events up to context_generated
      expect(eventCount).toBeGreaterThan(0);
      expect(eventCount).toBeLessThan(5); // Not all events
    });
  });
});