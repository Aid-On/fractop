/**
 * Complete Branch Coverage Tests
 * Focus on achieving 90%+ branch coverage
 */

import { describe, it, expect, vi } from 'vitest';
import { FractalProcessor } from './core';
import type { LLMProvider } from './types';

describe('Complete Branch Coverage', () => {
  const mockLLM: LLMProvider = {
    chat: vi.fn().mockResolvedValue('response'),
  };

  it('covers all chunking branches', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 20,
      overlapSize: 5,
    });

    // Test 1: Text shorter than chunk size
    let chunks = (processor as any).splitIntoChunks('short');
    expect(chunks).toEqual(['short']);

    // Test 2: Text exactly at chunk size
    chunks = (processor as any).splitIntoChunks('a'.repeat(20));
    expect(chunks).toEqual(['a'.repeat(20)]);

    // Test 3: Text with paragraph break in search window
    chunks = (processor as any).splitIntoChunks('a'.repeat(15) + '\n\n' + 'b'.repeat(20));
    expect(chunks[0]).toMatch(/\n\n$/);

    // Test 4: Text with sentence break but no paragraph
    chunks = (processor as any).splitIntoChunks('a'.repeat(18) + '。 ' + 'b'.repeat(20));
    expect(chunks[0]).toMatch(/。 $/);

    // Test 5: Text with only delimiter
    chunks = (processor as any).splitIntoChunks('a'.repeat(19) + ', ' + 'b'.repeat(20));
    expect(chunks[0]).toEndWith(', ');

    // Test 6: No breaks found - splits at chunk size
    chunks = (processor as any).splitIntoChunks('abcdefghijklmnopqrstuvwxyzABCDEFGHIJ');
    expect(chunks[0].length).toBe(20);

    // Test 7: Match found but position <= start (edge case)
    const longText = 'x'.repeat(50);
    chunks = (processor as any).splitIntoChunks(longText);
    expect(chunks.length).toBeGreaterThan(1);

    // Test 8: Overlap causes negative start, resets to 0
    const processor2 = new FractalProcessor(mockLLM, {
      chunkSize: 10,
      overlapSize: 15,
    });
    chunks = (processor2 as any).splitIntoChunks('a'.repeat(30));
    expect(chunks.length).toBeGreaterThan(1);

    // Test 9: Start advances by exactly 1 to prevent infinite loop
    const processor3 = new FractalProcessor(mockLLM, {
      chunkSize: 5,
      overlapSize: 10,
    });
    chunks = (processor3 as any).splitIntoChunks('abcdefghij');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[chunks.length - 1]).toContain('j');
  });

  it('covers processStream error branches', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 10,
    });

    // Test error in processChunk
    const options = {
      generateContext: vi.fn().mockResolvedValue('context'),
      processChunk: vi.fn()
        .mockResolvedValueOnce({ items: ['a'], summary: 's1' })
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ items: ['c'], summary: 's3' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item: any) => item,
    };

    const items: string[] = [];
    for await (const item of processor.processStream('a'.repeat(30), options)) {
      items.push(item);
    }

    // Should get items from chunks 0 and 2, but not 1
    expect(items).toEqual(['a', 'c']);
  });

  it('covers processAsStream branches', async () => {
    const processor = new FractalProcessor(mockLLM);

    // Test successful streaming
    const options = {
      generateContext: vi.fn().mockResolvedValue('ctx'),
      processChunk: vi.fn().mockResolvedValue({ items: ['x', 'y'], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item: any) => item,
    };

    const stream = processor.processAsStream('test', options);
    const collected: string[] = [];
    let completed = false;
    let errorThrown = false;

    await new Promise<void>((resolve) => {
      const sub = stream.subscribe({
        next: (item) => collected.push(item),
        error: () => { errorThrown = true; resolve(); },
        complete: () => { completed = true; resolve(); },
      });

      setTimeout(() => {
        sub.unsubscribe();
        resolve();
      }, 100);
    });

    expect(collected).toEqual(['x', 'y']);
    expect(completed).toBe(true);
    expect(errorThrown).toBe(false);
  });

  it('covers processAsStream error path', async () => {
    const processor = new FractalProcessor(mockLLM);

    // Test error in stream
    const options = {
      generateContext: vi.fn().mockRejectedValue(new Error('stream error')),
      processChunk: vi.fn().mockResolvedValue({ items: [], summary: '' }),
      mergeResults: () => ({ items: [], needsSupplement: false }),
      getKey: (item: any) => item,
    };

    const stream = processor.processAsStream('test', options);
    let errorReceived: Error | null = null;

    await new Promise<void>((resolve) => {
      const sub = stream.subscribe({
        next: () => {},
        error: (err) => { 
          errorReceived = err; 
          resolve();
        },
        complete: () => resolve(),
      });

      setTimeout(() => {
        sub.unsubscribe();
        resolve();
      }, 100);
    });

    expect(errorReceived).toBeInstanceOf(Error);
    expect(errorReceived?.message).toBe('stream error');
  });

  it('covers getLLM branch', () => {
    const customLLM: LLMProvider = {
      chat: vi.fn(),
    };
    const processor = new FractalProcessor(customLLM);
    expect(processor.getLLM()).toBe(customLLM);
  });

  it('covers getConfig branch', () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 1000,
      timeout: 5000,
    });
    const config = processor.getConfig();
    expect(config.chunkSize).toBe(1000);
    expect(config.timeout).toBe(5000);
    // Verify it's a copy
    config.chunkSize = 2000;
    expect(processor.getConfig().chunkSize).toBe(1000);
  });

  it('covers chunking match position branches', async () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 25,
      overlapSize: 5,
    });

    // Test: absPos > end + 200 (match too far)
    const text1 = 'a'.repeat(20) + 'b'.repeat(185) + '。 ' + 'c'.repeat(20);
    const chunks1 = (processor as any).splitIntoChunks(text1);
    expect(chunks1[0].length).toBe(25); // Should split at chunk size

    // Test: absPos <= start (match before start)
    const text2 = '。 ' + 'a'.repeat(50);
    const chunks2 = (processor as any).splitIntoChunks(text2);
    expect(chunks2.length).toBeGreaterThan(1);

    // Test: absPos exactly at end + 200
    const text3 = 'a'.repeat(24) + 'b'.repeat(176) + ',' + 'c'.repeat(20);
    const chunks3 = (processor as any).splitIntoChunks(text3);
    expect(chunks3[0]).toContain(',');

    // Test: lastMatch = 0 (no valid match found)
    const text4 = 'abcdefghijklmnopqrstuvwxyz1234567890';
    const chunks4 = (processor as any).splitIntoChunks(text4);
    expect(chunks4[0].length).toBe(25);
  });

  it('covers search window calculation branches', () => {
    // Test: searchStart calculation when end - 500 < start
    const processor1 = new FractalProcessor(mockLLM, {
      chunkSize: 600,
      overlapSize: 0,
    });
    const chunks1 = (processor1 as any).splitIntoChunks('short text');
    expect(chunks1).toEqual(['short text']);

    // Test: searchStart = 0 (start of text)
    const processor2 = new FractalProcessor(mockLLM, {
      chunkSize: 400,
      overlapSize: 0,
    });
    const text = 'a'.repeat(100) + '\n\n' + 'b'.repeat(400);
    const chunks2 = (processor2 as any).splitIntoChunks(text);
    expect(chunks2[0]).toContain('\n\n');
  });

  it('covers overlap calculation branches', () => {
    // Test: nextStart < 0, reset to 0
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 10,
      overlapSize: 20,
    });
    const chunks = (processor as any).splitIntoChunks('a'.repeat(30));
    expect(chunks.length).toBe(3);

    // Test: nextStart < start, advances by 1
    const processor2 = new FractalProcessor(mockLLM, {
      chunkSize: 5,
      overlapSize: 10,
    });
    const chunks2 = (processor2 as any).splitIntoChunks('abcdefghijklmno');
    expect(chunks2.length).toBeGreaterThan(2);
    expect(chunks2[chunks2.length - 1]).toContain('o');
  });

  it('covers pattern matching branches comprehensively', () => {
    const processor = new FractalProcessor(mockLLM, {
      chunkSize: 30,
      overlapSize: 5,
    });

    // Test: Multiple matches, takes last valid one
    const text1 = 'aa, bb, cc, dd, ee, ff, gg, hh, ii, jj, kk';
    const chunks1 = (processor as any).splitIntoChunks(text1);
    expect(chunks1[0]).toMatch(/,\s*$/);

    // Test: Pattern with no matches
    const text2 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const chunks2 = (processor as any).splitIntoChunks(text2);
    expect(chunks2[0].length).toBe(30);

    // Test: Break found in first pattern (paragraph)
    const text3 = 'a'.repeat(25) + '\n\n' + 'b'.repeat(30);
    const chunks3 = (processor as any).splitIntoChunks(text3);
    expect(chunks3[0]).toEndWith('\n\n');

    // Test: Break found in second pattern (sentence)
    const text4 = 'a'.repeat(28) + '。 ' + 'b'.repeat(30);
    const chunks4 = (processor as any).splitIntoChunks(text4);
    expect(chunks4[0]).toEndWith('。 ');

    // Test: Break found in third pattern (delimiter)
    const text5 = 'a'.repeat(29) + ' ' + 'b'.repeat(30);
    const chunks5 = (processor as any).splitIntoChunks(text5);
    expect(chunks5[0]).toEndWith(' ');
  });
});