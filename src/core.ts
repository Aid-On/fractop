/** FractoP - Core Fractal Processor */
import type {
  LLMProvider,
  FractalConfig,
  ChunkContext,
  MergeResult,
  ProcessOptions,
  FractalEvent,
  FractalEventListener,
  FractalCallbacks,
  FractalResult,
} from './types';
import type { Stream } from '@aid-on/nagare';
import { stream as nagareStream } from '@aid-on/nagare';
import {
  type ResolvedConfig,
  toError,
  withTimeout,
  withRetry,
  splitIntoChunks,
} from './core-processing';
import {
  processChunksParallel,
  processChunksSequential,
  mergeAndSupplement,
} from './core-chunks';

export { TimeoutError, CircuitBreakerError } from './core-processing';
export type { ResolvedConfig } from './core-processing';

/** Resolve a partial FractalConfig into a full ResolvedConfig with defaults */
function resolveConfig(config: FractalConfig): ResolvedConfig {
  return {
    chunkSize: config.chunkSize ?? 6000,
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

export class FractalProcessor<T> {
  private config: ResolvedConfig;
  private listeners: FractalEventListener<T>[] = [];
  private llm: LLMProvider;

  constructor(
    llm: LLMProvider,
    config: FractalConfig = {}
  ) {
    this.llm = llm;
    this.config = resolveConfig(config);
  }

  /** Add an event listener */
  on(listener: FractalEventListener<T>): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Emit an event to all listeners */
  private emit(event: FractalEvent<T>): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[FractoP] Event listener error:', e);
      }
    }
  }

  /** Main entry point for fractal processing (legacy API) */
  async process(text: string, options: ProcessOptions<T>): Promise<T[]> {
    const result = await this.processWithMetadata(text, options);
    return result.items;
  }

  /** Main entry point with full metadata */
  async processWithMetadata(
    text: string,
    options: ProcessOptions<T>,
    callbacks?: FractalCallbacks<T>
  ): Promise<FractalResult<T>> {
    const startTime = Date.now();
    const emit = (e: FractalEvent<T>) => this.emit(e);

    if (callbacks?.onEvent) {
      this.on(callbacks.onEvent);
    }

    const processCore = async (): Promise<FractalResult<T>> => {
      const chunks = splitIntoChunks(text, this.config);
      this.emit({ type: 'start', totalChunks: chunks.length });

      let globalContext: string;
      try {
        globalContext = await options.generateContext(text);
        this.emit({ type: 'context_generated', context: globalContext });
      } catch (error) {
        const err = toError(error);
        this.emit({ type: 'error', error: err, phase: 'context' });
        throw err;
      }

      const chunkParams = { chunks, globalContext, options, config: this.config, emit, startTime };
      const chunkResult = this.config.parallelProcessing
        ? await processChunksParallel(chunkParams)
        : await processChunksSequential({ ...chunkParams, onProgress: callbacks?.onProgress });

      if (this.config.parallelProcessing) {
        callbacks?.onProgress?.(chunkResult.chunksProcessed, chunks.length);
      }

      const { items, supplemented } = await mergeAndSupplement({
        text, allResults: chunkResult.allResults, options, config: this.config, emit
      });

      const duration = Date.now() - startTime;
      this.emit({ type: 'complete', totalItems: items.length, duration });
      callbacks?.onComplete?.(items, duration);

      return {
        items, duration,
        chunksProcessed: chunkResult.chunksProcessed,
        chunksFailed: chunkResult.chunksFailed,
        supplemented,
        circuitBreakerTripped: chunkResult.circuitBreakerTripped,
      };
    };

    try {
      if (this.config.timeout) {
        return await withTimeout(processCore, this.config.timeout, 'overall');
      }
      return await processCore();
    } catch (error) {
      const err = toError(error);
      if (callbacks?.onError) {
        const recoveredItems = await callbacks.onError(err, []);
        const duration = Date.now() - startTime;
        return { items: recoveredItems, duration, chunksProcessed: 0, chunksFailed: 0, supplemented: false, circuitBreakerTripped: false };
      }
      throw err;
    }
  }

  /** Stream processing for memory-efficient handling */
  async *processStream(text: string, options: ProcessOptions<T>): AsyncIterableIterator<T> {
    const chunks = splitIntoChunks(text, this.config);
    const globalContext = await options.generateContext(text);
    let previousSummary: string | undefined;

    for (let i = 0; i < chunks.length; i++) {
      const context: ChunkContext = { index: i, total: chunks.length, globalContext, previousSummary };
      try {
        const result = await withRetry(
          () => options.processChunk(chunks[i], context),
          i, this.config, (e) => this.emit(e as FractalEvent<T>)
        );
        for (const item of result.items) { yield item; }
        previousSummary = result.summary;
      } catch (error) {
        this.emit({ type: 'chunk_failed', index: i, error: toError(error), skipped: true });
      }
    }
  }

  /** Create a Nagare Stream for reactive processing */
  processAsStream(text: string, options: ProcessOptions<T>): Stream<T> {
    return nagareStream.create<T>((controller) => {
      const generator = this.processStream(text, options);
      (async () => {
        try {
          for await (const item of generator) { controller.next(item); }
          controller.complete();
        } catch (error) { controller.error(toError(error)); }
      })();
    });
  }

  /** Get the LLM provider */
  getLLM(): LLMProvider { return this.llm; }

  /** Get configuration */
  getConfig(): ResolvedConfig { return { ...this.config }; }

  /** Split text into chunks (delegates to standalone function) */
  private splitIntoChunks(text: string): string[] {
    return splitIntoChunks(text, this.config);
  }
}

/** Simple merge: flatten all results */
export function simpleMerge<T>(results: T[][], minCount: number): MergeResult<T> {
  const items = results.flat();
  return { items, needsSupplement: items.length < minCount };
}

/** Weighted merge: aggregate weights for duplicate items */
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

  const items = Array.from(weightMap.values()).sort((a, b) => b.weight - a.weight);
  return { items, needsSupplement: items.length < minCount };
}
