/**
 * FractoP + Nagare Stream Integration
 * 
 * Stream-based text processing with reactive patterns
 */

import { stream as nagareStream, type Stream } from '@aid-on/nagare';
import { FractalProcessor } from './core';
import type { FractalConfig, LLMProvider } from './types';
import { fractop } from './fluent';

/**
 * Create a Nagare stream from FractoP processing
 * 
 * @example
 * ```typescript
 * const stream = fractopStream(text)
 *   .withLLM(async (chunk) => await llm.process(chunk))
 *   .chunking({ size: 2000 })
 *   .stream();
 * 
 * await stream
 *   .map(result => result.toUpperCase())
 *   .filter(result => result.length > 100)
 *   .forEach(console.log);
 * ```
 */
export class FractoPStream<T = string> {
  private text: string;
  private builder = fractop<T>();

  constructor(text: string) {
    this.text = text;
  }

  /**
   * Configure the LLM processor
   */
  withLLM(provider: LLMProvider | ((text: string) => Promise<T>)): this {
    this.builder.withLLM(provider);
    return this;
  }

  /**
   * Configure chunking
   */
  chunking(options: { size?: number; overlap?: number }): this {
    this.builder.chunking(options);
    return this;
  }

  /**
   * Enable parallel processing
   */
  parallel(concurrency?: number): this {
    this.builder.parallel(concurrency);
    return this;
  }

  /**
   * Create a Nagare stream
   */
  stream(): Stream<T> {
    const processor = this.builder.build();
    
    // Create stream from async generator
    return nagareStream.create<T>((controller) => {
      (async () => {
        try {
          // Use the fluent builder's run method which handles LLM calls correctly
          const results = await this.builder.run(this.text);
          for (const result of results) {
            controller.next(result);
          }
          controller.complete();
        } catch (error) {
          controller.error(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
  }

  /**
   * Process and collect all results
   */
  async collect(): Promise<T[]> {
    const stream = this.stream();
    return stream.collect();
  }
}

/**
 * Create a stream-based FractoP processor
 * 
 * @example
 * ```typescript
 * const results = await fractopStream(longText)
 *   .withLLM(myLLM)
 *   .chunking({ size: 2000 })
 *   .collect();
 * ```
 */
export function fractopStream<T = string>(text: string): FractoPStream<T> {
  return new FractoPStream<T>(text);
}

/**
 * Process multiple texts as a stream
 * 
 * @example
 * ```typescript
 * const texts = ['text1', 'text2', 'text3'];
 * 
 * await fractopBatch(texts)
 *   .withLLM(myLLM)
 *   .chunking({ size: 2000 })
 *   .stream()
 *   .map(result => ({ ...result, processed: true }))
 *   .forEach(console.log);
 * ```
 */
export class FractoPBatch<T = string> {
  private texts: string[];
  private builder = fractop<T>();

  constructor(texts: string[]) {
    this.texts = texts;
  }

  /**
   * Configure the processor
   */
  withLLM(provider: LLMProvider | ((text: string) => Promise<T>)): this {
    this.builder.withLLM(provider);
    return this;
  }

  /**
   * Configure chunking
   */
  chunking(options: { size?: number; overlap?: number }): this {
    this.builder.chunking(options);
    return this;
  }

  /**
   * Create a stream of results
   */
  stream(): Stream<{ text: string; result: T[] }> {
    const processor = this.builder.build();
    
    return nagareStream.create<{ text: string; result: T[] }>((controller) => {
      (async () => {
        try {
          for (const text of this.texts) {
            // Use the fluent builder's run method which handles LLM calls correctly
            const result = await this.builder.run(text);
            controller.next({ text, result });
          }
          controller.complete();
        } catch (error) {
          controller.error(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });
  }

  /**
   * Process all texts and collect results
   */
  async collectAll(): Promise<Map<string, T[]>> {
    const results = new Map<string, T[]>();
    const items = await this.stream().collect();
    
    for (const { text, result } of items) {
      results.set(text, result);
    }
    
    return results;
  }
}

/**
 * Process multiple texts in batch
 */
export function fractopBatch<T = string>(texts: string[]): FractoPBatch<T> {
  return new FractoPBatch<T>(texts);
}

/**
 * Create a reactive pipeline with operators
 * 
 * @example
 * ```typescript
 * const pipeline = createPipeline()
 *   .source(longText)
 *   .chunk(2000, 200)
 *   .process(async (chunk) => await llm.summarize(chunk))
 *   .merge('weighted')
 *   .build();
 * 
 * const result = await pipeline.execute();
 * ```
 */
export class FractoPPipeline<T = string> {
  private sourceText?: string;
  private operations: Array<(input: any) => Promise<any>> = [];

  /**
   * Set the source text
   */
  source(text: string): this {
    this.sourceText = text;
    return this;
  }

  /**
   * Add chunking operation
   */
  chunk(size: number, overlap?: number): this {
    this.operations.push(async (text: string) => {
      // Manual chunking implementation
      const chunks: string[] = [];
      const overlapSize = overlap || 0;
      
      for (let i = 0; i < text.length; i += (size - overlapSize)) {
        chunks.push(text.substring(i, i + size));
        if (i + size >= text.length) break;
      }
      
      return chunks;
    });
    return this;
  }

  /**
   * Add processing operation
   */
  process<R>(fn: (chunk: any) => Promise<R>): FractoPPipeline<R> {
    this.operations.push(async (chunks: any[]) => {
      const results = await Promise.all(chunks.map(fn));
      return results;
    });
    return this as any;
  }

  /**
   * Add merge operation
   */
  merge(strategy: 'simple' | 'weighted' | ((results: T[]) => T)): this {
    this.operations.push(async (results: T[][]) => {
      if (strategy === 'simple') {
        return results.flat();
      } else if (strategy === 'weighted') {
        // Weighted merge logic
        const counts = new Map<string, number>();
        results.flat().forEach(item => {
          const key = JSON.stringify(item);
          counts.set(key, (counts.get(key) || 0) + 1);
        });
        return Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([item]) => JSON.parse(item));
      } else {
        return strategy(results.flat());
      }
    });
    return this;
  }

  /**
   * Execute the pipeline
   */
  async execute(): Promise<T> {
    if (!this.sourceText) {
      throw new Error('Source text is required');
    }

    let result: any = this.sourceText;
    
    for (const operation of this.operations) {
      result = await operation(result);
    }
    
    return result;
  }

  /**
   * Execute as a stream
   */
  executeStream(): Stream<T> {
    return nagareStream.create<T>((controller) => {
      this.execute()
        .then(result => {
          if (Array.isArray(result)) {
            result.forEach(item => controller.next(item));
          } else {
            controller.next(result);
          }
          controller.complete();
        })
        .catch(error => controller.error(error));
    });
  }
}

/**
 * Create a reactive processing pipeline
 */
export function createPipeline<T = string>(): FractoPPipeline<T> {
  return new FractoPPipeline<T>();
}