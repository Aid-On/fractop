/**
 * FractoP - Core Processing Helpers
 *
 * Parallel and sequential chunk processing, batch utilities,
 * text splitting, and deduplication.
 */

import type {
  ChunkContext,
  ProcessResult,
  ProcessOptions,
  FractalEvent,
} from './types';

/** Resolved configuration with all defaults applied */
export interface ResolvedConfig {
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

/** Convert unknown error to Error object */
export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/** Execute a function with timeout */
export function withTimeout<R>(
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

/** Execute a function with retry logic */
export async function withRetry<R>(
  fn: () => Promise<R>,
  chunkIndex: number,
  config: ResolvedConfig,
  emit: (event: FractalEvent<unknown>) => void
): Promise<R> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      if (config.chunkTimeout) {
        return await withTimeout(fn, config.chunkTimeout, 'chunk');
      }
      return await fn();
    } catch (error) {
      lastError = toError(error);
      emit({ type: 'chunk_retry', index: chunkIndex, attempt: attempt + 1, error: lastError });

      if (attempt < config.maxRetries - 1) {
        const delay = config.retryDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}

/** Parameters for chunk handling */
export interface ChunkHandlingParams<T> {
  chunk: string;
  index: number;
  total: number;
  globalContext: string;
  previousSummary: string | undefined;
  options: ProcessOptions<T>;
  config: ResolvedConfig;
  emit: (event: FractalEvent<T>) => void;
}

/** Process a single chunk with error handling */
export async function processChunkWithHandling<T>(
  params: ChunkHandlingParams<T>
): Promise<ProcessResult<T> | null> {
  const { chunk, index, total, globalContext, previousSummary, options, config, emit } = params;
  const chunkStart = Date.now();
  emit({ type: 'chunk_start', index, total });

  const context: ChunkContext = { index, total, globalContext, previousSummary };

  try {
    const result = await withRetry(
      () => options.processChunk(chunk, context),
      index, config,
      emit as (event: FractalEvent<unknown>) => void
    );

    const duration = Date.now() - chunkStart;
    emit({ type: 'chunk_complete', index, total, itemCount: result.items.length, duration });
    return result;
  } catch (error) {
    emit({ type: 'chunk_failed', index, error: toError(error), skipped: true });
    return null;
  }
}

/** Process promises in batches with concurrency limit */
export async function processInBatches<R>(
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

/** Find the best break position using boundary patterns */
function findBestBreak(
  searchText: string, searchStart: number, end: number, start: number
): number {
  const boundaries = [/\n\n/g, /[。．！？][\n\s]/g, /[、,\s]/g];

  for (const pattern of boundaries) {
    let lastMatch = -1;
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(searchText)) !== null) {
      const absPos = searchStart + match.index + match[0].length;
      if (absPos <= end + 200 && absPos > start) {
        lastMatch = absPos;
      }
    }
    if (lastMatch > 0) return lastMatch;
  }
  return end;
}

/** Split text into meaningful chunks with overlap */
export function splitIntoChunks(text: string, config: ResolvedConfig): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = start + config.chunkSize;

    if (end >= text.length) {
      chunks.push(text.slice(start));
      break;
    }

    const searchStart = Math.max(end - 500, start);
    const searchText = text.slice(searchStart, end + 500);
    const bestBreak = findBestBreak(searchText, searchStart, end, start);

    chunks.push(text.slice(start, bestBreak));
    const nextStart = bestBreak - config.overlapSize;
    start = Math.max(nextStart, start + 1);
    if (start < 0) start = 0;
  }

  return chunks;
}

/** Remove duplicates based on key function */
export function deduplicateItems<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const key = getKey(item);
    if (!seen.has(key)) {
      seen.set(key, item);
    }
  }
  return Array.from(seen.values());
}
