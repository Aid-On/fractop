/**
 * FractoP - Fractal Processor
 *
 * A library for processing infinite-length text with LLMs using fractal architecture.
 * Split → Process → Merge → Supplement
 *
 * Enterprise-grade reliability features:
 * - Timeout support (overall and per-chunk)
 * - Retry logic with exponential backoff
 * - Circuit breaker pattern
 * - Event system for observability
 * - Error recovery with partial results
 */

// Types
export type {
  LLMProvider,
  FractalConfig,
  ChunkContext,
  ProcessResult,
  MergeResult,
  ProcessOptions,
  TermDefinition,
  KeywordWeight,
  PillarData,
  SectionData,
  StructuredContent,
  // Medical-grade types
  FractalEvent,
  FractalEventListener,
  FractalCallbacks,
  FractalResult,
} from './types';

// Core
export {
  FractalProcessor,
  simpleMerge,
  weightedMerge,
  // Error classes
  TimeoutError,
  CircuitBreakerError,
} from './core';
