/**
 * FractoP - Core Fractal Processor
 *
 * Fractal architecture for processing infinite-length text:
 * - Split text into overlapping chunks
 * - Process each chunk with context propagation
 * - Merge and deduplicate results
 * - Supplement if needed
 *
 * Medical-grade reliability features:
 * - Timeout support (overall and per-chunk)
 * - Retry logic with exponential backoff
 * - Circuit breaker pattern
 * - Event system for observability
 * - Error recovery with partial results
 */

import type {
  LLMProvider,
  FractalConfig,
  ChunkContext,
  ProcessResult,
  MergeResult,
  ProcessOptions,
  FractalEvent,
  FractalEventListener,
  FractalCallbacks,
  FractalResult,
} from './types';
import type { Stream } from '@aid-on/nagare';
import { stream as nagareStream } from '@aid-on/nagare';

/** Resolved configuration with all defaults applied */
interface ResolvedConfig {
  chunkSize: number;
  overlapSize: number;
  minResultCount: number;
  supplementCount: number;
  parallelProcessing: boolean;
  concurrency: number;
  enableStreaming: boolean;
  timeout?: number;
  chunkTimeout: number;
  maxRetries: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
}

/** Timeout error class */
export class TimeoutError extends Error {
  constructor(message: string, public phase: 'overall' | 'chunk') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Circuit breaker error class */
export class CircuitBreakerError extends Error {
  constructor(public consecutiveFailures: number) {
    super(`Circuit breaker open after ${consecutiveFailures} consecutive failures`);
    this.name = 'CircuitBreakerError';
  }
}

export class FractalProcessor<T> {
  private config: ResolvedConfig;
  private listeners: FractalEventListener<T>[] = [];

  constructor(
    private llm: LLMProvider,
    config: FractalConfig = {}
  ) {
    this.config = {
      chunkSize: config.chunkSize ?? 6000, // Safer default for token limits
      overlapSize: config.overlapSize ?? 500,
      minResultCount: config.minResultCount ?? 30,
      supplementCount: config.supplementCount ?? 50,
      parallelProcessing: config.parallelProcessing ?? false,
      concurrency: config.concurrency ?? 3,
      enableStreaming: config.enableStreaming ?? false,
      timeout: config.timeout,
      chunkTimeout: config.chunkTimeout ?? 60000,
      maxRetries: config.maxRetries ?? 3,
      retryDelay: config.retryDelay ?? 1000,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 3,
    };
  }

  /**
   * Convert unknown error to Error object
   */
  private toError(e: unknown): Error {
    return e instanceof Error ? e : new Error(String(e));
  }

  /**
   * Add an event listener
   */
  on(listener: FractalEventListener<T>): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: FractalEvent<T>): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[FractoP] Event listener error:', e);
      }
    }
  }

  /**
   * Execute a function with timeout
   */
  private async withTimeout<R>(
    fn: () => Promise<R>,
    timeoutMs: number,
    phase: 'overall' | 'chunk'
  ): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TimeoutError(`Timeout after ${timeoutMs}ms`, phase));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Execute a function with retry logic
   */
  private async withRetry<R>(
    fn: () => Promise<R>,
    chunkIndex: number
  ): Promise<R> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        if (this.config.chunkTimeout) {
          return await this.withTimeout(fn, this.config.chunkTimeout, 'chunk');
        }
        return await fn();
      } catch (error) {
        lastError = this.toError(error);
        this.emit({ type: 'chunk_retry', index: chunkIndex, attempt: attempt + 1, error: lastError });

        if (attempt < this.config.maxRetries - 1) {
          // Exponential backoff
          const delay = this.config.retryDelay * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  /**
   * Main entry point for fractal processing (legacy API - returns items only)
   */
  async process(text: string, options: ProcessOptions<T>): Promise<T[]> {
    const result = await this.processWithMetadata(text, options);
    return result.items;
  }

  /**
   * Main entry point with full metadata (medical-grade API)
   */
  async processWithMetadata(
    text: string,
    options: ProcessOptions<T>,
    callbacks?: FractalCallbacks<T>
  ): Promise<FractalResult<T>> {
    const startTime = Date.now();
    const allResults: T[][] = [];
    let previousSummary: string | undefined;
    let consecutiveFailures = 0;
    let circuitBreakerTripped = false;
    let chunksProcessed = 0;
    let chunksFailed = 0;
    let supplemented = false;

    // Register callback event listener if provided
    if (callbacks?.onEvent) {
      this.on(callbacks.onEvent);
    }

    try {
      // Check overall timeout wrapper
      const processCore = async (): Promise<FractalResult<T>> => {
        // Step 1: Split text into chunks
        const chunks = this.splitIntoChunks(text);
        this.emit({ type: 'start', totalChunks: chunks.length });

        // Step 2: Generate global context
        let globalContext: string;
        try {
          globalContext = await options.generateContext(text);
          this.emit({ type: 'context_generated', context: globalContext });
        } catch (error) {
          const err = this.toError(error);
          this.emit({ type: 'error', error: err, phase: 'context' });
          throw err;
        }

        // Step 3: Process chunks (parallel or sequential based on config)
        if (this.config.parallelProcessing) {
          // Parallel processing without context propagation
          const chunkPromises = chunks.map(async (chunk, i) => {
            // Check for overall timeout
            if (this.config.timeout && Date.now() - startTime > this.config.timeout) {
              this.emit({ type: 'timeout', phase: 'overall', elapsed: Date.now() - startTime });
              return null;
            }

            return this.processChunkWithHandling(
              chunk,
              i,
              chunks.length,
              globalContext,
              undefined, // No context propagation in parallel mode
              options,
              startTime
            );
          });

          // Process with concurrency limit
          const results = await this.processInBatches(chunkPromises, this.config.concurrency);
          
          for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
              allResults.push(result.value.items);
              chunksProcessed++;
            } else if (result.status === 'rejected') {
              chunksFailed++;
              this.emit({ 
                type: 'chunk_failed', 
                index: results.indexOf(result), 
                error: this.toError(result.reason), 
                skipped: false 
              });
            }
          }
          
          callbacks?.onProgress?.(chunksProcessed, chunks.length);
        } else {
          // Sequential processing with context propagation
          for (let i = 0; i < chunks.length; i++) {
            // Check for overall timeout
            if (this.config.timeout && Date.now() - startTime > this.config.timeout) {
              this.emit({ type: 'timeout', phase: 'overall', elapsed: Date.now() - startTime });
              break;
            }

            // Check circuit breaker
            if (consecutiveFailures >= this.config.circuitBreakerThreshold) {
              this.emit({ type: 'circuit_breaker_open', consecutiveFailures });
              circuitBreakerTripped = true;
              break;
            }

            const result = await this.processChunkWithHandling(
              chunks[i],
              i,
              chunks.length,
              globalContext,
              previousSummary,
              options,
              startTime
            );

            if (result) {
              allResults.push(result.items);
              previousSummary = result.summary;
              consecutiveFailures = 0; // Reset on success
              chunksProcessed++;
            } else {
              consecutiveFailures++;
              chunksFailed++;
            }

            callbacks?.onProgress?.(i + 1, chunks.length);
          }
        }

        // Step 4: Merge results
        let items: T[];
        try {
          const merged = options.mergeResults(allResults);
          const totalItems = merged.items.length;
          items = this.deduplicateItems(merged.items, options.getKey);
          this.emit({ type: 'merge_complete', totalItems, uniqueItems: items.length });

          // Step 5: Supplement if needed
          if (merged.needsSupplement && options.supplement && items.length < this.config.minResultCount) {
            this.emit({
              type: 'supplement_start',
              currentCount: items.length,
              targetCount: this.config.minResultCount,
            });

            try {
              const supplementItems = await options.supplement(text, items);
              const beforeCount = items.length;
              const combined = [...items, ...supplementItems];
              items = this.deduplicateItems(combined, options.getKey);
              supplemented = true;
              this.emit({ type: 'supplement_complete', addedCount: items.length - beforeCount });
            } catch (error) {
              const err = this.toError(error);
              this.emit({ type: 'error', error: err, phase: 'supplement' });
              // Continue with existing items
            }
          }
        } catch (error) {
          const err = this.toError(error);
          this.emit({ type: 'error', error: err, phase: 'merge' });
          // Return whatever we have
          items = allResults.flat();
        }

        const duration = Date.now() - startTime;
        this.emit({ type: 'complete', totalItems: items.length, duration });
        callbacks?.onComplete?.(items, duration);

        return {
          items,
          duration,
          chunksProcessed,
          chunksFailed,
          supplemented,
          circuitBreakerTripped,
        };
      };

      // Apply overall timeout if configured
      if (this.config.timeout) {
        return await this.withTimeout(processCore, this.config.timeout, 'overall');
      }
      return await processCore();
    } catch (error) {
      const err = this.toError(error);

      // Try error callback for recovery
      if (callbacks?.onError) {
        const partialItems = allResults.flat();
        const recoveredItems = await callbacks.onError(err, partialItems);
        const duration = Date.now() - startTime;
        return {
          items: recoveredItems,
          duration,
          chunksProcessed,
          chunksFailed,
          supplemented,
          circuitBreakerTripped,
        };
      }

      throw err;
    }
  }

  /**
   * Process a single chunk with error handling
   */
  private async processChunkWithHandling(
    chunk: string,
    index: number,
    total: number,
    globalContext: string,
    previousSummary: string | undefined,
    options: ProcessOptions<T>,
    startTime: number
  ): Promise<ProcessResult<T> | null> {
    const chunkStart = Date.now();
    this.emit({ type: 'chunk_start', index, total });

    const context: ChunkContext = {
      index,
      total,
      globalContext,
      previousSummary,
    };

    try {
      const result = await this.withRetry(
        () => options.processChunk(chunk, context),
        index
      );

      const duration = Date.now() - chunkStart;
      this.emit({
        type: 'chunk_complete',
        index,
        total,
        itemCount: result.items.length,
        duration,
      });

      return result;
    } catch (error) {
      const err = this.toError(error);
      this.emit({ type: 'chunk_failed', index, error: err, skipped: true });
      return null;
    }
  }

  /**
   * Process promises in batches with concurrency limit
   */
  private async processInBatches<R>(
    promises: Promise<R>[],
    batchSize: number
  ): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = [];
    
    for (let i = 0; i < promises.length; i += batchSize) {
      const batch = promises.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(batch);
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Stream processing for memory-efficient handling of large texts
   */
  async *processStream(
    text: string,
    options: ProcessOptions<T>
  ): AsyncIterableIterator<T> {
    const chunks = this.splitIntoChunks(text);
    const globalContext = await options.generateContext(text);
    let previousSummary: string | undefined;

    for (let i = 0; i < chunks.length; i++) {
      const context: ChunkContext = {
        index: i,
        total: chunks.length,
        globalContext,
        previousSummary,
      };

      try {
        const result = await this.withRetry(
          () => options.processChunk(chunks[i], context),
          i
        );

        // Yield items one by one
        for (const item of result.items) {
          yield item;
        }

        previousSummary = result.summary;
      } catch (error) {
        // Continue to next chunk on error
        this.emit({ 
          type: 'chunk_failed', 
          index: i, 
          error: this.toError(error), 
          skipped: true 
        });
      }
    }
  }

  /**
   * Create a Nagare Stream for reactive processing
   */
  processAsStream(
    text: string,
    options: ProcessOptions<T>
  ): Stream<T> {
    // Use nagareStream.create to create a stream from async generator
    return nagareStream.create<T>((controller) => {
      const generator = this.processStream(text, options);
      
      // Start consuming the async generator
      (async () => {
        try {
          for await (const item of generator) {
            controller.next(item);
          }
          controller.complete();
        } catch (error) {
          controller.error(this.toError(error));
        }
      })();
    });
  }

  /**
   * Get the LLM provider (for use in custom processors)
   */
  getLLM(): LLMProvider {
    return this.llm;
  }

  /**
   * Get configuration (for use in custom processors)
   */
  getConfig(): ResolvedConfig {
    return { ...this.config };
  }

  /**
   * Split text into meaningful chunks with overlap
   */
  private splitIntoChunks(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + this.config.chunkSize;

      if (end >= text.length) {
        chunks.push(text.slice(start));
        break;
      }

      // Try to split at paragraph boundaries
      const searchStart = Math.max(end - 500, start);
      const searchText = text.slice(searchStart, end + 500);

      // Priority: paragraph > sentence > word boundary
      const boundaries = [
        /\n\n/g,                   // Paragraph boundary
        /[。．！？][\n\s]/g,  // End of sentence with space/newline
        /[、,\s]/g,            // Delimiter characters
      ];

      let bestBreak = end;
      for (const pattern of boundaries) {
        let match;
        let lastMatch = -1;
        pattern.lastIndex = 0;

        while ((match = pattern.exec(searchText)) !== null) {
          const absPos = searchStart + match.index + match[0].length;
          if (absPos <= end + 200 && absPos > start) {
            lastMatch = absPos;
          }
        }

        if (lastMatch > 0) {
          bestBreak = lastMatch;
          break;
        }
      }

      chunks.push(text.slice(start, bestBreak));
      // Calculate next start with overlap, ensuring we always advance
      const nextStart = bestBreak - this.config.overlapSize;
      // Always advance at least 1 character to prevent infinite loops
      start = Math.max(nextStart, start + 1);
      if (start < 0) start = 0;
    }

    return chunks;
  }

  /**
   * Remove duplicates based on key function
   */
  private deduplicateItems(items: T[], getKey: (item: T) => string): T[] {
    const seen = new Map<string, T>();
    for (const item of items) {
      const key = getKey(item);
      if (!seen.has(key)) {
        seen.set(key, item);
      }
    }
    return Array.from(seen.values());
  }
}

/**
 * Simple merge: flatten all results
 */
export function simpleMerge<T>(
  results: T[][],
  minCount: number
): MergeResult<T> {
  const items = results.flat();
  return {
    items,
    needsSupplement: items.length < minCount,
  };
}

/**
 * Weighted merge: aggregate weights for duplicate items
 */
export function weightedMerge<T extends { weight?: number }>(
  results: T[][],
  getKey: (item: T) => string,
  minCount: number
): MergeResult<T> {
  const weightMap = new Map<string, T & { weight: number }>();

  for (const items of results) {
    for (const item of items) {
      const key = getKey(item);
      const existing = weightMap.get(key);
      if (existing) {
        existing.weight += item.weight ?? 1;
      } else {
        weightMap.set(key, { ...item, weight: item.weight ?? 1 });
      }
    }
  }

  const items = Array.from(weightMap.values())
    .sort((a, b) => b.weight - a.weight);

  return {
    items,
    needsSupplement: items.length < minCount,
  };
}
