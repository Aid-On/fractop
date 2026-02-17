/**
 * FractoP Fluent API
 * 
 * A more elegant way to build text processing pipelines
 */

import { FractalProcessor } from './core';
import type { ChunkContext, FractalConfig, LLMProvider, MergeResult, ProcessOptions, ProcessResult } from './types';
import { createLLMAdapter } from './llm-adapter';
import { simpleMerge, weightedMerge } from './core';
import type { ModelSpec, Credentials } from '@aid-on/unillm';
import { generate } from '@aid-on/unillm';

/**
 * UnillM processor configuration
 */
interface UnillMProcessor<T = string> {
  model: ModelSpec | string;
  messages?: (chunk: string) => Array<{ role: string; content: string }>;
  credentials: Credentials;
  options?: { temperature?: number; maxTokens?: number };
  transform?: (response: { text: string }) => T;
}

/**
 * Fluent builder for creating FractoP pipelines
 * 
 * @example
 * ```typescript
 * const pipeline = fractop()
 *   .withLLM(async (text) => await llm.process(text))
 *   .chunking({ size: 3000, overlap: 300 })
 *   .parallel(3)
 *   .retry(3, 1000)
 *   .timeout(30000)
 *   .build();
 * 
 * const result = await pipeline.process(text);
 * ```
 */
export class FractoPBuilder<T = string> {
  private llmProvider?: LLMProvider | ((text: string) => Promise<T>);
  private config: Partial<FractalConfig> = {};
  private processOptions: Partial<ProcessOptions<T>> = {};
  private contextGenerator?: (text: string) => Promise<string>;
  private chunkProcessor?: (chunk: string, context: ChunkContext) => Promise<ProcessResult<T>>;
  private resultMerger?: (results: T[][]) => MergeResult<T>;

  /**
   * Set the LLM provider, processing function, or UnillM configuration
   * 
   * @example
   * ```typescript
   * // Function processor
   * .withLLM(async (chunk) => await myLLM.process(chunk))
   * 
   * // UnillM configuration
   * .withLLM({
   *   model: 'groq:llama-3.1-70b',
   *   credentials: { groqApiKey: process.env.GROQ_API_KEY },
   *   messages: (chunk) => [
   *     { role: 'system', content: 'Summarize this text.' },
   *     { role: 'user', content: chunk }
   *   ]
   * })
   * ```
   */
  withLLM(provider: LLMProvider | ((text: string) => Promise<T>) | UnillMProcessor<T>): this {
    // Check if it's a UnillM processor configuration
    if (provider && typeof provider === 'object' && 'model' in provider) {
      const unillmConfig = provider as UnillMProcessor<T>;
      this.llmProvider = async (chunk: string) => {
        const messages = unillmConfig.messages 
          ? unillmConfig.messages(chunk)
          : [{ role: 'user', content: chunk }];
        
        const result = await generate(
          unillmConfig.model,
          messages,
          unillmConfig.credentials,
          unillmConfig.options || {}
        );
        
        return unillmConfig.transform ? unillmConfig.transform(result) : result.text as unknown as T;
      };
    } else {
      this.llmProvider = provider as LLMProvider | ((text: string) => Promise<T>);
    }
    return this;
  }

  /**
   * Configure chunking parameters
   */
  chunking(options: { size?: number; overlap?: number }): this {
    if (options.size) this.config.chunkSize = options.size;
    if (options.overlap) this.config.overlapSize = options.overlap;
    return this;
  }

  /**
   * Enable parallel processing with specified concurrency
   */
  parallel(concurrency?: number): this {
    this.config.parallelProcessing = true;
    if (concurrency) this.config.concurrency = concurrency;
    return this;
  }

  /**
   * Configure retry behavior
   */
  retry(maxRetries: number, delay?: number): this {
    this.config.maxRetries = maxRetries;
    if (delay) this.config.retryDelay = delay;
    return this;
  }

  /**
   * Set timeout for processing
   */
  timeout(ms: number, perChunk?: boolean): this {
    if (perChunk) {
      this.config.chunkTimeout = ms;
    } else {
      this.config.timeout = ms;
    }
    return this;
  }

  /**
   * Set context generator for processing
   */
  context(generator: (text: string) => Promise<string>): this {
    this.contextGenerator = generator;
    return this;
  }

  /**
   * Set chunk processor
   */
  process(processor: (chunk: string, context: ChunkContext) => Promise<ProcessResult<T>>): this {
    this.chunkProcessor = processor;
    return this;
  }

  /**
   * Set result merger
   */
  merge(merger: ((results: T[][]) => MergeResult<T>) | 'simple'): this {
    if (merger === 'simple') {
      this.resultMerger = (results) => simpleMerge<T>(results, this.config.minResultCount || 30);
    } else {
      this.resultMerger = merger;
    }
    return this;
  }

  /**
   * Set minimum result count
   */
  minResults(count: number): this {
    this.config.minResultCount = count;
    return this;
  }

  /**
   * Enable streaming mode
   */
  streaming(): this {
    this.config.enableStreaming = true;
    return this;
  }

  /**
   * Build the processor
   */
  build(): FractalProcessor<T> {
    if (!this.llmProvider) {
      throw new Error('LLM provider is required. Use .withLLM() or .withUnillM()');
    }

    // Convert function to LLMProvider if needed
    const provider = typeof this.llmProvider === 'function'
      ? createLLMAdapter(this.llmProvider)
      : this.llmProvider;

    // Apply smart defaults
    const finalConfig: FractalConfig = {
      chunkSize: 3000,
      overlapSize: 300,
      parallelProcessing: false,
      concurrency: 3,
      maxRetries: 2,
      retryDelay: 1000,
      chunkTimeout: 30000,
      ...this.config
    };

    return new FractalProcessor<T>(provider, finalConfig);
  }

  /**
   * Build and immediately process text
   */
  async run(text: string): Promise<T[]> {
    const processor = this.build();
    
    // Store the LLM function if it was provided as a function
    const llmFunction = typeof this.llmProvider === 'function' ? this.llmProvider : null;
    
    // Always use processWithMetadata with proper options
    const options: ProcessOptions<T> = {
      generateContext: this.contextGenerator || (async () => ''),
      processChunk: this.chunkProcessor || (async (chunk, context) => {
        // If we have a function LLM, call it directly
        if (llmFunction) {
          const result = await llmFunction(chunk);
          return { items: [result] };
        }
        // Otherwise, this must be a full LLMProvider, so we need to process differently
        // The user should provide processChunk if they want custom processing
        return { items: [chunk as unknown as T] };
      }),
      getKey: (item: T) => JSON.stringify(item),
      mergeResults: this.resultMerger || ((results) => ({
        items: results.flat(),
        needsSupplement: false
      }))
    };
    
    const result = await processor.processWithMetadata(text, options);
    return result.items;
  }
}

/**
 * Create a new fluent builder
 * 
 * @example
 * ```typescript
 * import { fractop } from '@aid-on/fractop';
 * 
 * const result = await fractop()
 *   .withLLM(myLLM)
 *   .chunking({ size: 2000, overlap: 200 })
 *   .parallel(5)
 *   .run(text);
 * ```
 */
export function fractop<T = string>(): FractoPBuilder<T> {
  return new FractoPBuilder<T>();
}