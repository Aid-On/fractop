/**
 * FractoP - Type Definitions
 */

/**
 * LLM Provider Interface
 * Any LLM provider that implements this interface can be used with FractoP
 */
export interface LLMProvider {
  chat(
    systemPrompt: string,
    userPrompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<string>;
}

/**
 * Fractal Processor Configuration
 */
export interface FractalConfig {
  /** Chunk size in characters (default: 6000 - safer for token limits) */
  chunkSize?: number;
  /** Overlap size between chunks in characters (default: 500) */
  overlapSize?: number;
  /** Minimum result count before triggering supplement (default: 30) */
  minResultCount?: number;
  /** Target count for supplement extraction (default: 50) */
  supplementCount?: number;

  // Parallel processing options
  /** Enable parallel chunk processing without context propagation (default: false) */
  parallelProcessing?: boolean;
  /** Maximum concurrent chunk processing (default: 3) */
  concurrency?: number;
  /** Enable streaming mode for memory-efficient processing (default: false) */
  enableStreaming?: boolean;

  // Reliability options
  /** Overall timeout in milliseconds (default: none) */
  timeout?: number;
  /** Per-chunk timeout in milliseconds (default: 60000) */
  chunkTimeout?: number;
  /** Maximum retry attempts per chunk (default: 3) */
  maxRetries?: number;
  /** Base delay between retries in milliseconds (default: 1000) */
  retryDelay?: number;
  /** Number of consecutive failures before circuit breaker trips (default: 3) */
  circuitBreakerThreshold?: number;
}

/**
 * Context passed to each chunk processor
 */
export interface ChunkContext {
  /** Current chunk index (0-based) */
  index: number;
  /** Total number of chunks */
  total: number;
  /** Global context (document summary) */
  globalContext: string;
  /** Summary from previous chunk (for context propagation) */
  previousSummary?: string;
}

/**
 * Result from processing a single chunk
 */
export interface ProcessResult<T> {
  /** Extracted items from this chunk */
  items: T[];
  /** Optional summary for context propagation to next chunk */
  summary?: string;
}

/**
 * Result from merging all chunk results
 */
export interface MergeResult<T> {
  /** Merged items */
  items: T[];
  /** Whether supplement processing is needed */
  needsSupplement: boolean;
}

/**
 * Processing options for FractalProcessor.process()
 */
export interface ProcessOptions<T> {
  /** Generate global context from the full text */
  generateContext: (text: string) => Promise<string>;
  /** Process a single chunk with context */
  processChunk: (chunk: string, context: ChunkContext) => Promise<ProcessResult<T>>;
  /** Merge results from all chunks */
  mergeResults: (results: T[][]) => MergeResult<T>;
  /** Optional: supplement extraction when results are insufficient */
  supplement?: (text: string, existing: T[]) => Promise<T[]>;
  /** Get unique key for deduplication */
  getKey: (item: T) => string;
}

// Common result types for built-in extractors

/**
 * Term with definition (for glossary extraction)
 */
export interface TermDefinition {
  term: string;
  reading?: string;
  definition: string;
  score?: number;
}

/**
 * Keyword with weight (for keyword extraction)
 */
export interface KeywordWeight {
  text: string;
  weight: number;
}

/**
 * Pillar/topic data (for document structure)
 */
export interface PillarData {
  title: string;
  description: string;
  weight?: number;
}

/**
 * Section with pillar assignment
 */
export interface SectionData {
  text: string;
  pillarTitle: string;
}

/**
 * Structured content extraction result
 */
export interface StructuredContent {
  pillars: PillarData[];
  sections: SectionData[];
  /** Original sections before translation (if translated) */
  originalSections?: SectionData[];
}

// Medical-grade event types

/**
 * Event types for FractalProcessor
 */
export type FractalEvent<T> =
  | { type: 'start'; totalChunks: number }
  | { type: 'context_generated'; context: string }
  | { type: 'chunk_start'; index: number; total: number }
  | { type: 'chunk_retry'; index: number; attempt: number; error: Error }
  | { type: 'chunk_complete'; index: number; total: number; itemCount: number; duration: number }
  | { type: 'chunk_failed'; index: number; error: Error; skipped: boolean }
  | { type: 'merge_complete'; totalItems: number; uniqueItems: number }
  | { type: 'supplement_start'; currentCount: number; targetCount: number }
  | { type: 'supplement_complete'; addedCount: number }
  | { type: 'complete'; totalItems: number; duration: number }
  | { type: 'error'; error: Error; phase: 'context' | 'chunk' | 'merge' | 'supplement' }
  | { type: 'timeout'; phase: 'overall' | 'chunk'; elapsed: number }
  | { type: 'circuit_breaker_open'; consecutiveFailures: number };

/**
 * Event listener type
 */
export type FractalEventListener<T> = (event: FractalEvent<T>) => void;

/**
 * Callbacks for FractalProcessor
 */
export interface FractalCallbacks<T> {
  /** Called on each event */
  onEvent?: FractalEventListener<T>;
  /** Called when processing completes successfully */
  onComplete?: (items: T[], duration: number) => void;
  /** Called on error (can return fallback items or re-throw) */
  onError?: (error: Error, partialItems: T[]) => T[] | Promise<T[]>;
  /** Called on progress updates */
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Processing result with metadata
 */
export interface FractalResult<T> {
  /** Extracted items */
  items: T[];
  /** Total processing time in milliseconds */
  duration: number;
  /** Number of chunks processed */
  chunksProcessed: number;
  /** Number of chunks that failed (if any) */
  chunksFailed: number;
  /** Whether supplement was applied */
  supplemented: boolean;
  /** Whether circuit breaker was triggered */
  circuitBreakerTripped: boolean;
}
