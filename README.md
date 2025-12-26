# @aid-on/fractop

[![npm version](https://badge.fury.io/js/@aid-on%2Ffractop.svg)](https://www.npmjs.com/package/@aid-on/fractop)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)

[日本語](./README.ja.md) | English

FractoP (Fractal Processor) - A library for processing infinite-length text with LLMs using fractal architecture.

## Features

- **UnillM Integration**: Seamless integration with @aid-on/unillm for unified LLM access
- **Infinite Length Support**: Process documents of any size through intelligent chunking
- **Context Propagation**: Maintains global context and inter-chunk summaries throughout processing
- **Smart Chunking**: Splits at paragraph/sentence boundaries with configurable overlap (safer 3000 char default for LLMs)
- **Type-Safe Adapters**: Convert any async function to LLMProvider without using `any` types
- **Parallel Processing**: Optional parallel chunk processing for better performance
- **Streaming API**: Memory-efficient processing with Nagare Stream<T> integration
- **Automatic Deduplication**: Removes duplicate extracted items automatically
- **Supplement Processing**: Automatically extracts additional items when results are insufficient
- **Enterprise-Grade Reliability**: Built-in timeouts, retries with exponential backoff, and circuit breaker pattern

## Installation

```bash
npm install @aid-on/fractop
```

## Quick Start

### With UnillM (Recommended)

```typescript
import { createWithUnillM } from '@aid-on/fractop';
import { generate } from '@aid-on/unillm';

// Create a processor with UnillM integration
const processor = createWithUnillM(
  async (chunk) => {
    const result = await generate(
      'groq:llama-3.1-8b-instant',
      [
        { role: 'system', content: 'Summarize this text concisely.' },
        { role: 'user', content: chunk }
      ],
      { groqApiKey: process.env.GROQ_API_KEY }
    );
    return result.text;
  },
  { chunkSize: 3000, overlapSize: 300 }
);

// Process long text
const summary = await processor.process(longText);
```

### With Custom LLM Provider

```typescript
import { FractalProcessor, createLLMAdapter, simpleMerge } from '@aid-on/fractop';
import type { Stream } from '@aid-on/nagare';

// Create an adapter for your LLM
const llmAdapter = createLLMAdapter(async (text) => {
  // Your LLM implementation here
  return await yourLLM.complete(text);
});

// Create a processor
const processor = new FractalProcessor<{ keyword: string; weight: number }>(llmAdapter, {
  chunkSize: 6000,       // Characters per chunk (safer default for token limits)
  overlapSize: 500,      // Overlap between chunks
  minResultCount: 30,    // Minimum results threshold
  parallelProcessing: false,  // Enable for parallel processing
  concurrency: 3,        // Max concurrent chunks in parallel mode
});

// Process long text
const keywords = await processor.process(longText, {
  generateContext: async (text) => {
    // Generate document summary
    return await llm.chat(
      'Summarizer',
      `Summarize this document in 3 sentences:\n\n${text.substring(0, 8000)}`,
      { temperature: 0.3 }
    );
  },

  processChunk: async (chunk, context) => {
    // Extract keywords from this chunk
    const response = await llm.chat(
      'Keyword Extractor',
      `Context: ${context.globalContext}\n\n` +
      `Extract keywords from:\n${chunk}`,
      { temperature: 0.2 }
    );
    return { items: parseKeywords(response) };
  },

  mergeResults: (results) => simpleMerge(results, 30),
  getKey: (item) => item.keyword,
});
```

## Architecture

FractoP uses a fractal architecture to process documents that exceed LLM context limits:

1. **Global Context Generation**: Creates a summary of the entire document
2. **Intelligent Chunking**: Splits document at natural boundaries with overlap
3. **Sequential Processing**: Processes each chunk with context propagation
4. **Result Merging**: Combines and deduplicates results from all chunks
5. **Supplement Processing**: Adds more results if below minimum threshold

### Processing Flow

```
Input Text
    ↓
Generate Global Context
    ↓
Split into Chunks (with overlap)
    ↓
Process Each Chunk (with context)
    ↓
Merge & Deduplicate Results
    ↓
Supplement if Needed
    ↓
Final Results
```

## API Reference

### UnillM Integration Helpers

#### createWithUnillM(processor, config)
Creates a FractalProcessor optimized for UnillM usage.

```typescript
const processor = createWithUnillM(
  async (chunk: string) => {
    // Process with UnillM
    const result = await generate(model, messages, options);
    return result.text;
  },
  { chunkSize: 3000 } // Optimized defaults for LLMs
);
```

#### createLLMAdapter(asyncFn)
Converts any async function to an LLMProvider interface.

```typescript
const adapter = createLLMAdapter(async (text) => {
  return await myLLM.process(text);
});
```

#### createUnillMProcessor(config)
Creates an advanced processor with metadata support.

```typescript
const processor = createUnillMProcessor({
  processChunk: async (chunk, context) => {
    // Process with context
    return processedResult;
  },
  generateContext: async (text) => ({ summary: '...' }),
  mergeResults: (results) => ({ items: results.flat(), needsSupplement: false })
});
```

## Configuration

### FractalConfig Options

```typescript
interface FractalConfig {
  chunkSize?: number;        // Default: 6000 (safer for token limits)
  overlapSize?: number;      // Default: 500
  minResultCount?: number;   // Default: 30
  supplementCount?: number;  // Default: 50
  parallelProcessing?: boolean;  // Default: false
  concurrency?: number;      // Default: 3
  enableStreaming?: boolean; // Default: false
  timeout?: number;          // Overall timeout in ms
  chunkTimeout?: number;     // Per-chunk timeout in ms
  maxRetries?: number;       // Default: 3
  retryDelay?: number;       // Initial retry delay in ms
  circuitBreakerThreshold?: number;  // Default: 3
}
```

### Merge Functions

#### simpleMerge<T>(results, minCount)

Flattens all results and flags for supplementation if below minCount.

```typescript
const merged = simpleMerge(results, 30);
```

#### weightedMerge<T>(results, getKey, minCount)

Aggregates weights for items appearing in multiple chunks.

```typescript
const merged = weightedMerge(
  results,
  (item) => item.keyword,
  30
);
```

## Advanced Features

### Parallel Processing

Process chunks in parallel for better performance (note: context propagation is disabled in this mode):

```typescript
const processor = new FractalProcessor(llm, {
  parallelProcessing: true,
  concurrency: 5,  // Process up to 5 chunks simultaneously
});

// Use for tasks that don't require context propagation
const keywords = await processor.process(text, options);
```

### Streaming API with Nagare

Stream results for memory-efficient processing of massive documents:

```typescript
// Using async iterator
for await (const item of processor.processStream(text, options)) {
  console.log('Received item:', item);
  // Process items as they arrive
}

// Using Nagare Stream<T>
const stream: Stream<T> = processor.processAsStream(text, options);
stream
  .filter(item => item.weight > 0.5)
  .map(item => item.keyword)
  .subscribe({
    next: keyword => console.log('High-weight keyword:', keyword),
    complete: () => console.log('Stream complete')
  });
```

## Reliability Features

### Timeout Control

```typescript
const processor = new FractalProcessor(llm, {
  timeout: 300000,        // 5 minutes overall
  chunkTimeout: 60000,    // 1 minute per chunk
});
```

### Automatic Retry with Exponential Backoff

```typescript
const processor = new FractalProcessor(llm, {
  maxRetries: 3,          // Retry up to 3 times
  retryDelay: 1000,       // Start with 1s, then 2s, 4s...
});
```

### Circuit Breaker Pattern

```typescript
const processor = new FractalProcessor(llm, {
  circuitBreakerThreshold: 3,  // Break after 3 consecutive failures
});

const result = await processor.processWithMetadata(text, options);
if (result.circuitBreakerTripped) {
  console.error('Processing halted due to repeated errors');
}
```

### Event System for Observability

```typescript
processor.on((event) => {
  switch (event.type) {
    case 'chunk_start':
      console.log(`Processing chunk ${event.index + 1}/${event.total}`);
      break;
    case 'chunk_complete':
      console.log(`Chunk ${event.index + 1} completed`);
      break;
    case 'chunk_retry':
      console.warn(`Retrying chunk ${event.index} (attempt ${event.attempt})`);
      break;
    case 'complete':
      console.log(`Processing complete: ${event.totalItems} results`);
      break;
  }
});
```

## LLMProvider Interface

```typescript
interface LLMProvider {
  chat(
    systemPrompt: string,
    userPrompt: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<string>;
}
```

Compatible with:
- OpenAI GPT
- Anthropic Claude
- Google Gemini
- Cloudflare Workers AI
- Any LLM with a chat completion API

## Use Cases

- **Term Extraction**: Extract and define technical terms from documents
- **Keyword Analysis**: Extract weighted keywords for search/tagging
- **Document Structuring**: Extract pillars/topics and assign sections
- **Translation**: Translate long documents chunk by chunk
- **Summarization**: Generate multi-level summaries

## TypeScript Support

FractoP is written in TypeScript and provides full type safety:

```typescript
// Define your item type
interface ExtractedItem {
  term: string;
  definition: string;
  confidence: number;
}

// Create a typed processor
const processor = new FractalProcessor<ExtractedItem>(llm, config);

// Process with type-safe options
const results = await processor.process<ExtractedItem>(text, {
  processChunk: async (chunk, context) => {
    // Return type is enforced
    return {
      items: extractedItems,
      summary: 'Processed successfully'
    };
  },
  getKey: (item) => item.term,  // Type-safe property access
});
```

## Performance Considerations

- **Chunk Size**: Larger chunks use more tokens but maintain better context
- **Overlap Size**: More overlap preserves context but increases processing
- **Parallel Processing**: Chunks are processed sequentially to maintain context flow
- **Caching**: Consider implementing LLM response caching for repeated processing

## License

MIT