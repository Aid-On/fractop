# FractoP Real-World Examples

## 🚨 The Problem

LLMs have context limits. When you try to process a 100-page PDF or a full codebase:

```typescript
// ❌ This fails with large documents
const summary = await llm.process(entire100PageDocument);
// Error: Context length exceeded (150,000 tokens > 8,192 limit)
```

## ✅ The Solution: FractoP

### Example 1: Summarize a 100-Page Research Paper

```typescript
import { fractop } from '@aid-on/fractop';
import { readFileSync } from 'fs';

const paper = readFileSync('quantum-computing-thesis.txt', 'utf-8');
// 200,000+ characters

const summary = await fractop()
  .withLLM({
    model: 'groq:llama-3.1-70b',
    credentials: { groqApiKey: process.env.GROQ_API_KEY },
    messages: (chunk) => [
      { role: 'system', content: 'Summarize key findings. Be concise.' },
      { role: 'user', content: chunk }
    ]
  })
  .chunking({ size: 3000, overlap: 300 })  // Smart chunking
  .parallel(5)  // Process 5 chunks simultaneously
  .run(paper);

// Returns array of summaries from each chunk
// Can further process: summary.join('\n\n')
```

### Example 2: Extract All Functions from a Large Codebase

```typescript
import { fractopStream } from '@aid-on/fractop';
import { globSync } from 'glob';

// Read all TypeScript files (could be 1000+ files)
const files = globSync('src/**/*.ts');
const fullCode = files.map(f => readFileSync(f, 'utf-8')).join('\n');
// Could be millions of characters

interface FunctionInfo {
  name: string;
  params: string[];
  returnType: string;
  file: string;
}

// Stream processing to avoid memory issues
const functions = await fractopStream<FunctionInfo[]>()
  .withLLM({
    model: 'anthropic:claude-3-5-haiku',
    credentials: { anthropicApiKey: process.env.ANTHROPIC_API_KEY },
    messages: (chunk) => [
      { role: 'system', content: 'Extract all function signatures as JSON array.' },
      { role: 'user', content: chunk }
    ],
    transform: (response) => JSON.parse(response.text)
  })
  .chunking({ size: 4000, overlap: 500 })  // Overlap to not miss functions
  .stream()
  .map(functions => functions.filter(f => f.name.length > 0))
  .collect();

// Deduplicate and merge results
const allFunctions = [...new Set(functions.flat())];
console.log(`Found ${allFunctions.length} functions`);
```

### Example 3: Translate an Entire Book

```typescript
import { fractop } from '@aid-on/fractop';

const book = await fetch('https://example.com/war-and-peace.txt').then(r => r.text());
// 3.2 million characters

const translatedChapters = await fractop()
  .withLLM({
    model: 'gemini:gemini-2.5-pro',
    credentials: { geminiApiKey: process.env.GEMINI_API_KEY },
    messages: (chunk) => [
      { role: 'system', content: 'Translate to Japanese. Maintain literary style.' },
      { role: 'user', content: chunk }
    ]
  })
  .chunking({ 
    size: 2000,      // Smaller chunks for quality
    overlap: 200     // Overlap for context continuity
  })
  .retry(3, 2000)    // Retry on API failures
  .timeout(120000)   // 2 minutes timeout
  .run(book);

// Save translated book
writeFileSync('war-and-peace-jp.txt', translatedChapters.join(''));
```

### Example 4: Analyze Customer Reviews (Batch Processing)

```typescript
import { fractopBatch } from '@aid-on/fractop';

// 10,000 customer reviews
const reviews = await db.select().from('reviews').limit(10000);
const reviewTexts = reviews.map(r => r.content);

// Process in batches, extract sentiment and keywords
const analysis = await fractopBatch(reviewTexts)
  .withLLM({
    model: 'groq:llama-3.1-8b-instant',
    credentials: { groqApiKey: process.env.GROQ_API_KEY },
    messages: (review) => [
      { role: 'system', content: 'Analyze sentiment (positive/negative/neutral) and extract 3 keywords.' },
      { role: 'user', content: review }
    ],
    transform: (response) => {
      const lines = response.text.split('\n');
      return {
        sentiment: lines[0],
        keywords: lines.slice(1)
      };
    }
  })
  .collectAll();

// Aggregate results
const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
for (const [review, results] of analysis) {
  results.forEach(r => sentimentCounts[r.sentiment]++);
}
```

### Example 5: Generate Unit Tests for Large Codebase

```typescript
import { fractop } from '@aid-on/fractop';

const componentCode = readFileSync('src/components/Dashboard.tsx', 'utf-8');
// Complex 5000-line component

const tests = await fractop()
  .withLLM({
    model: 'openai:gpt-4o',
    credentials: { openaiApiKey: process.env.OPENAI_API_KEY },
    messages: (chunk) => [
      { role: 'system', content: 'Generate comprehensive Jest unit tests.' },
      { role: 'user', content: chunk }
    ]
  })
  .chunking({ size: 2000 })  // Each chunk gets its own tests
  .parallel(3)
  .run(componentCode);

// Combine all test cases
const testFile = `
import { render, screen } from '@testing-library/react';
import Dashboard from './Dashboard';

describe('Dashboard Component', () => {
  ${tests.join('\n\n')}
});
`;

writeFileSync('src/components/Dashboard.test.tsx', testFile);
```

### Example 6: Real-time Document Q&A

```typescript
import { fractopStream } from '@aid-on/fractop';

async function askQuestion(document: string, question: string) {
  const answers = await fractopStream()
    .withLLM({
      model: 'anthropic:claude-3-5-sonnet',
      credentials: { anthropicApiKey: process.env.ANTHROPIC_API_KEY },
      messages: (chunk) => [
        { role: 'system', content: `Answer this question: ${question}` },
        { role: 'user', content: chunk }
      ]
    })
    .chunking({ size: 3000, overlap: 500 })
    .stream()
    .filter(answer => answer.length > 10)  // Filter out non-answers
    .take(5)  // Take first 5 relevant answers
    .collect();
  
  return answers;
}

// Usage
const manual = readFileSync('kubernetes-manual.txt', 'utf-8');
const answers = await askQuestion(manual, "How do I set up auto-scaling?");
```

### Example 7: Code Migration Assistant

```typescript
import { fractop } from '@aid-on/fractop';

// Migrate entire codebase from Vue 2 to Vue 3
const oldCode = globSync('src/**/*.vue')
  .map(f => ({ path: f, content: readFileSync(f, 'utf-8') }));

for (const file of oldCode) {
  const migrated = await fractop()
    .withLLM({
      model: 'anthropic:claude-3-5-haiku',
      credentials: { anthropicApiKey: process.env.ANTHROPIC_API_KEY },
      messages: (chunk) => [
        { role: 'system', content: 'Migrate Vue 2 code to Vue 3. Update Composition API, fix breaking changes.' },
        { role: 'user', content: chunk }
      ]
    })
    .chunking({ size: 2000, overlap: 300 })
    .run(file.content);
  
  writeFileSync(file.path, migrated.join(''));
}
```

## 🎯 Why FractoP?

### Without FractoP:
- ❌ Manual chunking logic (complex, error-prone)
- ❌ Lose context between chunks
- ❌ No automatic retries
- ❌ Memory issues with large files
- ❌ Complex parallel processing setup

### With FractoP:
- ✅ Automatic intelligent chunking
- ✅ Context preservation with overlap
- ✅ Built-in retry and timeout
- ✅ Memory-efficient streaming
- ✅ Simple parallel processing
- ✅ Type-safe with TypeScript

## Performance Comparison

```typescript
// Processing a 50MB log file

// ❌ Naive approach - FAILS
const analysis = await llm.analyze(entire50MBLog);  // Error: Too large

// ❌ Manual chunking - COMPLEX
const chunks = [];
for (let i = 0; i < log.length; i += 2000) {
  chunks.push(log.slice(i, i + 2000));
}
const results = [];
for (const chunk of chunks) {
  try {
    const result = await llm.analyze(chunk);
    results.push(result);
  } catch (e) {
    // Manual retry logic...
  }
}
// Lost context, no overlap, no dedup...

// ✅ FractoP - SIMPLE & POWERFUL
const analysis = await fractop()
  .withLLM(llm)
  .chunking({ size: 3000, overlap: 300 })
  .parallel(5)
  .retry(3)
  .run(entire50MBLog);
```

## Common Patterns

### Pattern 1: Extract → Transform → Aggregate

```typescript
const insights = await fractop()
  .withLLM(extractorLLM)          // Extract data
  .chunking({ size: 3000 })
  .run(document)
  .then(extracted => fractop()
    .withLLM(transformerLLM)       // Transform data
    .run(extracted.join('\n')))
  .then(transformed => fractop()
    .withLLM(aggregatorLLM)        // Final aggregation
    .run(transformed.join('\n')));
```

### Pattern 2: Progressive Refinement

```typescript
// First pass: rough analysis
const rough = await fractop()
  .withLLM(fastLLM)
  .chunking({ size: 5000 })  // Large chunks, fast
  .parallel(10)
  .run(document);

// Second pass: detailed analysis on important parts
const detailed = await fractop()
  .withLLM(powerfulLLM)
  .chunking({ size: 1000, overlap: 200 })  // Small chunks, quality
  .run(rough.filter(r => r.includes('important')).join('\n'));
```