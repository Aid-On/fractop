/** FractoP - Chunk Processing Strategies */
import type { ProcessOptions, FractalEvent } from './types';
import type { ResolvedConfig } from './core-processing';
import {
  toError,
  processChunkWithHandling,
  deduplicateItems,
} from './core-processing';

/** Result from processing chunks (parallel or sequential) */
export interface ChunkProcessingResult<T> {
  allResults: T[][];
  chunksProcessed: number;
  chunksFailed: number;
  circuitBreakerTripped: boolean;
  previousSummary?: string;
}

/** Common parameters for chunk processing functions */
export interface ChunkProcessingParams<T> {
  chunks: string[];
  globalContext: string;
  options: ProcessOptions<T>;
  config: ResolvedConfig;
  emit: (event: FractalEvent<T>) => void;
  startTime: number;
  onProgress?: (completed: number, total: number) => void;
}

/** Parameters for merge and supplement */
export interface MergeParams<T> {
  text: string;
  allResults: T[][];
  options: ProcessOptions<T>;
  config: ResolvedConfig;
  emit: (event: FractalEvent<T>) => void;
}

/**
 * Process chunks in parallel with a bounded worker pool.
 *
 * 旧実装は `chunks.map(async …)` で全チャンクを即座に起動しており、
 * concurrency はバッチ待機の粒度でしかなかった（実同時実行数 = チャンク数 →
 * 50 チャンクで LLM 50 連射、レート制限を直撃）。現実装は **concurrency 本の
 * ワーカーが共有インデックスから連続的に仕事を取る**ため、同時実行数は常に
 * concurrency 以下で、wave 方式のような「遅いチャンクがバッチを堰き止める」
 * 待ちも生じない。直列モード同様に overall timeout と circuit breaker を尊重する
 * （並列での「連続失敗」は完了順で数える近似）。結果はチャンク順を保つ。
 */
export async function processChunksParallel<T>(
  params: ChunkProcessingParams<T>
): Promise<ChunkProcessingResult<T>> {
  const { chunks, globalContext, options, config, emit, startTime } = params;
  const itemsByIndex: (T[] | null)[] = new Array(chunks.length).fill(null);
  let nextIndex = 0;
  let chunksProcessed = 0;
  let chunksFailed = 0;
  let consecutiveFailures = 0;
  let circuitBreakerTripped = false;
  let timedOut = false;

  const worker = async (): Promise<void> => {
    while (true) {
      if (circuitBreakerTripped || timedOut) return;
      if (config.timeout && Date.now() - startTime > config.timeout) {
        if (!timedOut) {
          timedOut = true;
          emit({ type: 'timeout', phase: 'overall', elapsed: Date.now() - startTime });
        }
        return;
      }
      const i = nextIndex++;
      if (i >= chunks.length) return;

      const result = await processChunkWithHandling({
        chunk: chunks[i], index: i, total: chunks.length, globalContext,
        previousSummary: undefined, options, config, emit
      });

      if (result) {
        itemsByIndex[i] = result.items;
        chunksProcessed++;
        consecutiveFailures = 0;
      } else {
        chunksFailed++;
        consecutiveFailures++;
        if (consecutiveFailures >= config.circuitBreakerThreshold && !circuitBreakerTripped) {
          circuitBreakerTripped = true;
          emit({ type: 'circuit_breaker_open', consecutiveFailures });
        }
      }
    }
  };

  const poolSize = Math.max(1, Math.min(config.concurrency, chunks.length));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  const allResults = itemsByIndex.filter((r): r is T[] => r !== null);
  return { allResults, chunksProcessed, chunksFailed, circuitBreakerTripped };
}

/** Process chunks sequentially with context propagation */
export async function processChunksSequential<T>(
  params: ChunkProcessingParams<T>
): Promise<ChunkProcessingResult<T>> {
  const { chunks, globalContext, options, config, emit, startTime, onProgress } = params;
  const allResults: T[][] = [];
  let previousSummary: string | undefined;
  let consecutiveFailures = 0;
  let circuitBreakerTripped = false;
  let chunksProcessed = 0;
  let chunksFailed = 0;

  for (let i = 0; i < chunks.length; i++) {
    if (config.timeout && Date.now() - startTime > config.timeout) {
      emit({ type: 'timeout', phase: 'overall', elapsed: Date.now() - startTime });
      break;
    }
    if (consecutiveFailures >= config.circuitBreakerThreshold) {
      emit({ type: 'circuit_breaker_open', consecutiveFailures });
      circuitBreakerTripped = true;
      break;
    }

    const result = await processChunkWithHandling({
      chunk: chunks[i], index: i, total: chunks.length, globalContext,
      previousSummary, options, config, emit
    });

    if (result) {
      allResults.push(result.items);
      previousSummary = result.summary;
      consecutiveFailures = 0;
      chunksProcessed++;
    } else {
      consecutiveFailures++;
      chunksFailed++;
    }
    onProgress?.(i + 1, chunks.length);
  }

  return { allResults, chunksProcessed, chunksFailed, circuitBreakerTripped, previousSummary };
}

/** Merge results and optionally supplement */
export async function mergeAndSupplement<T>(
  params: MergeParams<T>
): Promise<{ items: T[]; supplemented: boolean }> {
  const { text, allResults, options, config, emit } = params;
  let supplemented = false;
  try {
    const merged = options.mergeResults(allResults);
    const totalItems = merged.items.length;
    let items = deduplicateItems(merged.items, options.getKey);
    emit({ type: 'merge_complete', totalItems, uniqueItems: items.length });

    if (merged.needsSupplement && options.supplement && items.length < config.minResultCount) {
      emit({ type: 'supplement_start', currentCount: items.length, targetCount: config.minResultCount });
      try {
        const supplementItems = await options.supplement(text, items);
        const beforeCount = items.length;
        items = deduplicateItems([...items, ...supplementItems], options.getKey);
        supplemented = true;
        emit({ type: 'supplement_complete', addedCount: items.length - beforeCount });
      } catch (error) {
        emit({ type: 'error', error: toError(error), phase: 'supplement' });
      }
    }
    return { items, supplemented };
  } catch (error) {
    emit({ type: 'error', error: toError(error), phase: 'merge' });
    return { items: allResults.flat(), supplemented };
  }
}
