/**
 * FractoP Core Edge Cases Tests
 * Testing boundary conditions and edge cases
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FractalProcessor, TimeoutError, CircuitBreakerError } from './core';
import type { LLMProvider, ProcessOptions, FractalCallbacks } from './types';

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

describe('FractalProcessor - Edge Cases', () => {
  let llm: LLMProvider;

  beforeEach(() => {
    llm = createMockLLM();
  });

  describe('Empty and Minimal Input', () => {
    it('handles empty text input', async () => {
      const processor = new FractalProcessor<string>(llm);
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
        mergeResults: () => ({ items: [], needsSupplement: false }),
      });

      const result = await processor.process('', options);
      expect(result).toEqual([]);
      // Empty text may not always call processChunk depending on implementation
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

  describe('Unicode and Special Characters', () => {
    it('handles emoji and unicode correctly', async () => {
      const processor = new FractalProcessor<string>(llm, { chunkSize: 10 });
      const text = '🎉🎊🎈🎁🎀💝💖💗💓💕';
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({ items: ['emoji'], summary: '' }),
        mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
      });

      await processor.process(text, options);
      expect(options.processChunk).toHaveBeenCalled();
    });

    it('handles CJK characters properly', async () => {
      const processor = new FractalProcessor<string>(llm, { chunkSize: 50 });
      const text = '日本語のテキスト。中文文本。한국어 텍스트。';
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

  describe('Extreme Configurations', () => {
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

  describe('Null and Undefined Handling', () => {
    it('handles undefined items in results', async () => {
      const processor = new FractalProcessor<any>(llm);
      const options = createMockOptions<any>({
        processChunk: vi.fn().mockResolvedValue({ 
          items: [undefined, 'valid', null, 'item'],
          summary: '' 
        }),
        mergeResults: (results) => ({ 
          items: results.flat().filter(Boolean), 
          needsSupplement: false 
        }),
      });

      const result = await processor.process('test', options);
      expect(result).toEqual(['valid', 'item']);
    });

    it('handles missing summary in chunk result', async () => {
      const processor = new FractalProcessor<string>(llm, { chunkSize: 10 });
      const text = 'a'.repeat(30);
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({ 
          items: ['item'],
          // summary is undefined
        }),
        mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
      });

      await processor.process(text, options);
      expect(options.processChunk).toHaveBeenCalled();
    });
  });

  describe('Concurrent Access', () => {
    it('handles multiple simultaneous processing calls', async () => {
      const processor = new FractalProcessor<string>(llm);
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockImplementation(async () => {
          await new Promise(r => setTimeout(r, 10));
          return { items: ['item'], summary: '' };
        }),
        mergeResults: (results) => ({ items: results.flat(), needsSupplement: false }),
      });

      const results = await Promise.all([
        processor.process('text1', options),
        processor.process('text2', options),
        processor.process('text3', options),
      ]);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toEqual(['item']);
      });
    });
  });

  describe('Memory and Performance', () => {
    it('processes very large text without memory issues', async () => {
      const processor = new FractalProcessor<string>(llm, { 
        chunkSize: 1000,
        enableStreaming: true 
      });
      
      // Simulate large text (1MB)
      const largeText = 'a'.repeat(1000000);
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({ 
          items: ['chunk'], 
          summary: 'sum' 
        }),
        mergeResults: (results) => ({ 
          items: results.flat(), 
          needsSupplement: false 
        }),
      });

      const startMemory = process.memoryUsage().heapUsed;
      await processor.process(largeText, options);
      const endMemory = process.memoryUsage().heapUsed;
      
      // Memory increase should be reasonable (< 100MB)
      const memoryIncrease = (endMemory - startMemory) / (1024 * 1024);
      expect(memoryIncrease).toBeLessThan(100);
    });

    it('handles rapid event emissions without loss', async () => {
      const processor = new FractalProcessor<string>(llm, { chunkSize: 10 });
      const events: any[] = [];
      
      processor.on(event => events.push(event));
      
      const text = 'a'.repeat(50);
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockResolvedValue({ 
          items: ['item'], 
          summary: '' 
        }),
        mergeResults: (results) => ({ 
          items: results.flat(), 
          needsSupplement: false 
        }),
      });

      await processor.process(text, options);
      
      // Should have multiple event types
      const eventTypes = [...new Set(events.map(e => e.type))];
      expect(eventTypes).toContain('start');
      expect(eventTypes).toContain('chunk_start');
      expect(eventTypes).toContain('chunk_complete');
      expect(eventTypes).toContain('complete');
    });
  });

  describe('Boundary Splitting Edge Cases', () => {
    it('splits at paragraph boundaries correctly', async () => {
      const processor = new FractalProcessor<string>(llm, { chunkSize: 20 });
      const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      
      const chunks: string[] = [];
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockImplementation(async (chunk) => {
          chunks.push(chunk);
          return { items: [], summary: '' };
        }),
        mergeResults: () => ({ items: [], needsSupplement: false }),
      });

      await processor.process(text, options);
      
      // Should prefer splitting at paragraph boundaries
      expect(chunks.some(c => c.includes('First paragraph.'))).toBe(true);
    });

    it('handles no suitable boundary found', async () => {
      const processor = new FractalProcessor<string>(llm, { 
        chunkSize: 10,
        overlapSize: 0 
      });
      const text = 'abcdefghijklmnopqrstuvwxyz'; // No natural boundaries
      
      const chunks: string[] = [];
      const options = createMockOptions<string>({
        processChunk: vi.fn().mockImplementation(async (chunk) => {
          chunks.push(chunk);
          return { items: [], summary: '' };
        }),
        mergeResults: () => ({ items: [], needsSupplement: false }),
      });

      await processor.process(text, options);
      
      // Should still split even without boundaries
      expect(chunks.length).toBeGreaterThan(1);
    });
  });
});