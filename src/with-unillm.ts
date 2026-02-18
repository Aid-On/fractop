/**
 * FractoP + UnillM Integration
 * 
 * Simple wrapper to use FractoP with UnillM providers
 */

import { FractalProcessor } from './core';
import type { FractalConfig, ChunkContext, LLMProvider, MergeResult, ProcessOptions } from './types';

/**
 * Create a FractalProcessor configured for use with UnillM
 * 
 * @example
 * ```typescript
 * import { generate } from '@aid-on/unillm';
 * import { createWithUnillM } from '@aid-on/fractop';
 * 
 * const processor = createWithUnillM(
 *   async (chunk) => {
 *     const result = await generate('groq:llama-3.1-8b-instant', [
 *       { role: 'system', content: 'Summarize this text' },
 *       { role: 'user', content: chunk }
 *     ], { groqApiKey: process.env.GROQ_API_KEY });
 *     return result.text;
 *   },
 *   { chunkSize: 3000, overlapSize: 300 }
 * );
 * 
 * const summary = await processor.process(longText);
 * ```
 */
export function createWithUnillM<T = string>(
  llmProcessor: (chunk: string) => Promise<T>,
  config?: FractalConfig
): FractalProcessor<T> {
  // Create an LLMProvider wrapper
  const provider: LLMProvider = {
    async chat(_systemPrompt: string, userPrompt: string): Promise<string> {
      // For simple processors, just pass the user prompt
      const result = await llmProcessor(userPrompt);
      return String(result);
    }
  };

  // Optimized defaults for LLM processing
  const llmOptimizedConfig: FractalConfig = {
    chunkSize: 3000,         // Safe for most LLMs
    overlapSize: 300,        // 10% overlap
    parallelProcessing: false, // Sequential by default to respect rate limits
    concurrency: 2,          // Low concurrency for API calls
    maxRetries: 2,           // Retry on transient failures
    retryDelay: 1000,        // 1 second initial delay
    chunkTimeout: 30000,     // 30 seconds per chunk
    ...config               // User overrides
  };
  
  return new FractalProcessor(provider, llmOptimizedConfig) as FractalProcessor<T>;
}

/**
 * Helper to create metadata-based processor for UnillM
 * 
 * @example
 * ```typescript
 * const processor = createWithUnillMMetadata({
 *   model: 'groq:llama-3.1-8b-instant',
 *   credentials: { groqApiKey: process.env.GROQ_API_KEY },
 *   systemPrompt: 'You are a helpful assistant'
 * });
 * ```
 */
export function createUnillMProcessor<T = unknown>(config: {
  processChunk: (chunk: string, context?: unknown) => Promise<T>;
  generateContext?: (text: string) => Promise<string>;
  mergeResults?: (results: T[][]) => MergeResult<T>;
  fractalConfig?: FractalConfig;
}) {
  // Create LLMProvider from processChunk
  const provider: LLMProvider = {
    async chat(_systemPrompt: string, userPrompt: string): Promise<string> {
      const result = await config.processChunk(userPrompt);
      return String(result);
    }
  };
  
  const processor = new FractalProcessor<T>(
    provider,
    config.fractalConfig || {
      chunkSize: 3000,
      overlapSize: 300,
      parallelProcessing: false
    }
  );
  
  return {
    processor,
    async processWithMetadata(text: string) {
      const options: ProcessOptions<T> = {
        generateContext: config.generateContext || (async () => ''),
        processChunk: async (chunk: string, _context: ChunkContext) => {
          const result = await config.processChunk(chunk);
          return {
            items: [result],
            metadata: { chunkLength: chunk.length }
          };
        },
        getKey: (item: T) => JSON.stringify(item),
        mergeResults: config.mergeResults || ((results: T[][]) => ({
          items: results.flat(),
          needsSupplement: false
        }))
      };
      
      return processor.processWithMetadata(text, options);
    }
  };
}