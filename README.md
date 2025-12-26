# @aid-on/fractop

[![npm version](https://badge.fury.io/js/@aid-on%2Ffractop.svg)](https://www.npmjs.com/package/@aid-on/fractop)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)

[日本語](./README.ja.md) | English

FractoP (Fractal Processor) - Elegant text processing for LLMs with streaming, batching, and fractal chunking.

## ✨ Features

- **🎯 Fluent API**: Elegant chainable interface for building processing pipelines
- **🌊 Nagare Streaming**: Reactive stream processing with `Stream<T>` integration
- **🔄 Smart Chunking**: Intelligent text splitting with overlap for context preservation
- **⚡ Parallel Processing**: Concurrent chunk processing for maximum performance
- **🛡️ Enterprise Reliability**: Timeouts, retries, and circuit breaker patterns built-in
- **🎨 UnillM Integration**: Works seamlessly with any LLM through UnillM adapters
- **📦 Batch Processing**: Process multiple documents efficiently
- **🔁 Auto-retry**: Exponential backoff for transient failures

## Installation

```bash
npm install @aid-on/fractop
```

## 🚀 Quick Start

### Primary Interface - Fluent API

The most elegant way to use FractoP:

```typescript
import { fractop } from '@aid-on/fractop';

// Simple and elegant
const results = await fractop()
  .withLLM(async (chunk) => {
    // Your LLM logic here
    const response = await callYourLLM(chunk);
    return response;
  })
  .chunking({ size: 3000, overlap: 300 })
  .parallel(5)
  .retry(3, 1000)
  .timeout(30000)
  .run(longText);
```

### With GROQ/OpenAI

```typescript
const summaries = await fractop()
  .withLLM(async (chunk) => {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'Summarize concisely.' },
          { role: 'user', content: chunk }
        ]
      })
    });
    const data = await response.json();
    return data.choices[0].message.content;
  })
  .chunking({ size: 2000, overlap: 200 })
  .run(document);
```

### With UnillM

```typescript
import { generate } from '@aid-on/unillm';

const results = await fractop()
  .withUnillM(async (chunk) => {
    const result = await generate(
      'groq:llama-3.1-70b',
      [
        { role: 'system', content: 'Extract key points.' },
        { role: 'user', content: chunk }
      ],
      { groqApiKey: process.env.GROQ_API_KEY }
    );
    return result.text;
  })
  .chunking({ size: 3000 })
  .parallel(3)
  .run(text);
```

## 🌊 Streaming with Nagare

Process large documents with memory-efficient streaming:

```typescript
import { fractopStream } from '@aid-on/fractop';

// Stream results as they're processed
const stream = fractopStream(largeDocument)
  .withLLM(async (chunk) => await processChunk(chunk))
  .chunking({ size: 2000, overlap: 200 })
  .parallel(3)
  .stream();

// Reactive stream operations
await stream
  .map(result => result.toUpperCase())
  .filter(result => result.length > 100)
  .take(10)
  .collect();
```

### Batch Processing

Process multiple documents efficiently:

```typescript
import { fractopBatch } from '@aid-on/fractop';

const documents = ['doc1.txt', 'doc2.txt', 'doc3.txt'];

const results = await fractopBatch(documents)
  .withLLM(async (chunk) => await summarize(chunk))
  .chunking({ size: 2000 })
  .collectAll();

// Results is a Map<string, T[]>
for (const [doc, summaries] of results) {
  console.log(`${doc}: ${summaries.length} chunks processed`);
}
```

## 🔧 Advanced Features

### Custom Processing Pipeline

```typescript
const pipeline = await fractop<ExtractedEntity>()
  .withLLM(llmProcessor)
  .chunking({ size: 4000, overlap: 400 })
  .parallel(5)
  .retry(3, 2000)
  .timeout(60000, true)  // per-chunk timeout
  .minResults(50)
  .merge('simple')  // or provide custom merger
  .run(text);
```

### Context-Aware Processing

```typescript
const results = await fractop()
  .withLLM(llmProcessor)
  .context(async (text) => {
    // Generate global context from full document
    return await generateSummary(text.substring(0, 5000));
  })
  .process(async (chunk, context) => {
    // Process each chunk with context
    return await extractWithContext(chunk, context);
  })
  .merge((results) => customMergeLogic(results))
  .run(document);
```

### Stream Processing

Process documents as reactive streams:

```typescript
// Stream individual results
const stream = fractopStream(document)
  .withLLM(async (chunk) => await analyze(chunk))
  .chunking({ size: 2000, overlap: 200 })
  .stream();

// Use Nagare's reactive operators
const processed = await stream
  .map(result => transform(result))
  .filter(result => result.score > 0.8)
  .collect();
```

## 🏗️ Architecture

FractoP's fractal architecture enables processing of unlimited document sizes:

```mermaid
graph TD
    A[Input Text] --> B[Smart Chunking]
    B --> C[Parallel/Sequential Processing]
    C --> D[Stream Results]
    D --> E[Merge & Deduplicate]
    E --> F[Final Output]
```

### Key Concepts

1. **Fractal Chunking**: Intelligent text splitting that preserves context
2. **Stream Processing**: Memory-efficient processing with Nagare streams
3. **Context Propagation**: Maintains document understanding across chunks
4. **Result Merging**: Smart deduplication and aggregation

## 📊 Performance

```typescript
// Optimize for speed
const fast = await fractop()
  .withLLM(llm)
  .chunking({ size: 5000 })  // Larger chunks
  .parallel(10)               // High concurrency
  .run(text);

// Optimize for quality
const quality = await fractop()
  .withLLM(llm)
  .chunking({ size: 2000, overlap: 500 })  // More overlap
  .retry(5, 2000)                          // More retries
  .timeout(120000)                         // Longer timeout
  .run(text);
```

## 🛡️ Reliability Features

### Automatic Retries
```typescript
fractop()
  .withLLM(llm)
  .retry(3, 1000)  // 3 retries with exponential backoff
  .run(text);
```

### Timeouts
```typescript
fractop()
  .withLLM(llm)
  .timeout(60000)        // Overall timeout
  .timeout(5000, true)   // Per-chunk timeout
  .run(text);
```

### Circuit Breaker
Automatically stops processing after consecutive failures to prevent cascade failures.

## 🎯 Common Use Cases

### Document Summarization
```typescript
const summary = await fractop()
  .withLLM(async (chunk) => await summarize(chunk))
  .chunking({ size: 3000, overlap: 300 })
  .merge(results => results.join('\n'))
  .run(document);
```

### Keyword Extraction
```typescript
const keywords = await fractop<string[]>()
  .withLLM(async (chunk) => await extractKeywords(chunk))
  .chunking({ size: 2000 })
  .merge(results => [...new Set(results.flat())])
  .run(document);
```

### Translation
```typescript
const translated = await fractop()
  .withLLM(async (chunk) => await translate(chunk, 'ja'))
  .chunking({ size: 2000, overlap: 200 })
  .run(document);
```

### Question Answering
```typescript
const answers = await fractop()
  .withLLM(async (chunk) => await answerQuestion(chunk, question))
  .chunking({ size: 3000 })
  .parallel(5)
  .run(document);
```

## ⚙️ Configuration

### Default Settings

```typescript
{
  chunkSize: 3000,        // Optimized for LLM token limits
  overlapSize: 300,       // Context preservation
  concurrency: 3,         // Parallel processing threads
  maxRetries: 2,          // Retry attempts
  retryDelay: 1000,       // Initial retry delay (ms)
  chunkTimeout: 30000     // Per-chunk timeout (ms)
}
```

### Advanced Configuration

```typescript
const processor = fractop()
  .withLLM(llm)
  .chunking({ 
    size: 4000,      // Larger chunks for better context
    overlap: 500     // More overlap for continuity
  })
  .parallel(5)       // 5 concurrent processors
  .retry(3, 2000)    // 3 retries, 2s initial delay
  .timeout(60000)    // 1 minute overall timeout
  .minResults(100)   // Minimum 100 results
  .build();
```

## 📦 API Reference

### Main Exports

```typescript
// Primary fluent interface
import { fractop } from '@aid-on/fractop';

// Streaming interfaces
import { fractopStream, fractopBatch } from '@aid-on/fractop';

// Core processor (advanced use)
import { FractalProcessor } from '@aid-on/fractop';

// Utilities
import { simpleMerge, weightedMerge } from '@aid-on/fractop';
```

### Fluent API Methods

| Method | Description |
|--------|-------------|
| `.withLLM(fn)` | Set LLM processor function |
| `.withUnillM(fn)` | Set UnillM processor |
| `.chunking(opts)` | Configure chunk size and overlap |
| `.parallel(n)` | Enable parallel processing |
| `.retry(n, delay)` | Configure retry behavior |
| `.timeout(ms, perChunk?)` | Set timeout limits |
| `.context(fn)` | Set context generator |
| `.process(fn)` | Set chunk processor |
| `.merge(strategy)` | Set merge strategy |
| `.minResults(n)` | Set minimum result count |
| `.run(text)` | Execute processing |

## 🔬 TypeScript

Full TypeScript support with generics:

```typescript
interface Analysis {
  sentiment: 'positive' | 'negative' | 'neutral';
  score: number;
  keywords: string[];
}

const results = await fractop<Analysis>()
  .withLLM(async (chunk): Promise<Analysis> => {
    // Type-safe processing
    return analyzeChunk(chunk);
  })
  .merge((results: Analysis[][]) => {
    // Type-safe merging
    return combineAnalyses(results);
  })
  .run(document);

// results is Analysis[]
```

## 🚀 Performance Tips

1. **Chunk Size**: Balance between context and token limits (2000-4000 chars recommended)
2. **Overlap**: 10-20% of chunk size for good context preservation
3. **Concurrency**: Match your LLM rate limits (3-5 for most providers)
4. **Streaming**: Use `fractopStream` for documents > 100KB
5. **Batching**: Use `fractopBatch` for multiple documents

## License

MIT