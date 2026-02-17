/**
 * Example: Nagare Stream Integration with FractoP
 */

import { fractopStream, fractopBatch, createPipeline } from '../src/nagare-integration.js';
import { fractop } from '../src/fluent.js';

// Mock LLM for demonstration
const mockLLM = async (chunk: string): Promise<string> => {
  // Simulate LLM processing
  await new Promise(resolve => setTimeout(resolve, 100));
  return `Processed: ${chunk.substring(0, 50)}...`;
};

async function streamExample() {
  console.log('=== Stream Example ===');
  
  const longText = `
    This is a very long document that needs to be processed in chunks.
    It contains multiple paragraphs with different topics.
    
    Each chunk will be processed independently by the LLM.
    The results will be streamed back as they become available.
    
    This approach allows for efficient processing of large documents
    without loading everything into memory at once.
  `.repeat(10);

  // Using fractopStream for reactive processing
  const stream = fractopStream(longText)
    .withLLM(mockLLM)
    .chunking({ size: 200, overlap: 20 })
    .parallel(3)
    .stream();

  console.log('Streaming results:');
  const results = await stream.collect();
  for (const result of results) {
    console.log(`- ${result}`);
  }
}

async function batchExample() {
  console.log('\n=== Batch Example ===');
  
  const texts = [
    'First document about technology',
    'Second document about science',
    'Third document about mathematics'
  ];

  // Process multiple texts as a batch
  const results = await fractopBatch(texts)
    .withLLM(mockLLM)
    .chunking({ size: 100 })
    .collectAll();

  console.log('Batch results:');
  results.forEach((result, text) => {
    console.log(`${text}: ${result.length} chunks processed`);
  });
}

async function pipelineExample() {
  console.log('\n=== Pipeline Example ===');
  
  const longText = 'This is a document that will be processed through a pipeline.'.repeat(5);

  // Create a reactive processing pipeline
  const pipeline = createPipeline<string>()
    .source(longText)
    .chunk(50, 10)
    .process(async (chunk) => {
      // Process each chunk
      return await mockLLM(chunk);
    })
    .merge('simple');

  const result = await pipeline.execute();
  console.log('Pipeline result:', Array.isArray(result) ? `${result.length} items` : result);
}

async function fluentApiExample() {
  console.log('\n=== Fluent API Example (Primary Interface) ===');
  
  const text = 'Process this text using the elegant fluent API.'.repeat(3);

  // The primary, most elegant way to use FractoP
  const result = await fractop<string>()
    .withLLM(mockLLM)
    .chunking({ size: 100, overlap: 10 })
    .parallel(2)
    .retry(3, 1000)
    .timeout(30000)
    .run(text);

  console.log('Fluent API results:', result);
}

// Run all examples
async function main() {
  try {
    await fluentApiExample();  // Primary interface - show first
    await streamExample();
    await batchExample();
    await pipelineExample();
  } catch (error) {
    console.error('Error:', error);
  }
}

main();