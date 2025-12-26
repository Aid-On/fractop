/**
 * FractoP Fluent API
 *
 * A more elegant way to build text processing pipelines
 */
import { FractalProcessor } from './core';
import { createLLMAdapter } from './llm-adapter';
import { simpleMerge } from './core';
/**
 * Fluent builder for creating FractoP pipelines
 *
 * @example
 * ```typescript
 * const pipeline = fractop()
 *   .withLLM(async (text) => await llm.process(text))
 *   .chunking({ size: 3000, overlap: 300 })
 *   .parallel(3)
 *   .retry(3, 1000)
 *   .timeout(30000)
 *   .build();
 *
 * const result = await pipeline.process(text);
 * ```
 */
export class FractoPBuilder {
    llmProvider;
    config = {};
    processOptions = {};
    contextGenerator;
    chunkProcessor;
    resultMerger;
    /**
     * Set the LLM provider or processing function
     */
    withLLM(provider) {
        this.llmProvider = provider;
        return this;
    }
    /**
     * Set the UnillM processor
     * @example
     * ```typescript
     * .withUnillM(async (chunk) => {
     *   const result = await generate('groq:llama-3.1-8b', messages, options);
     *   return result.text;
     * })
     * ```
     */
    withUnillM(processor) {
        this.llmProvider = processor;
        return this;
    }
    /**
     * Configure chunking parameters
     */
    chunking(options) {
        if (options.size)
            this.config.chunkSize = options.size;
        if (options.overlap)
            this.config.overlapSize = options.overlap;
        return this;
    }
    /**
     * Enable parallel processing with specified concurrency
     */
    parallel(concurrency) {
        this.config.parallelProcessing = true;
        if (concurrency)
            this.config.concurrency = concurrency;
        return this;
    }
    /**
     * Configure retry behavior
     */
    retry(maxRetries, delay) {
        this.config.maxRetries = maxRetries;
        if (delay)
            this.config.retryDelay = delay;
        return this;
    }
    /**
     * Set timeout for processing
     */
    timeout(ms, perChunk) {
        if (perChunk) {
            this.config.chunkTimeout = ms;
        }
        else {
            this.config.timeout = ms;
        }
        return this;
    }
    /**
     * Set context generator for processing
     */
    context(generator) {
        this.contextGenerator = generator;
        return this;
    }
    /**
     * Set chunk processor
     */
    process(processor) {
        this.chunkProcessor = processor;
        return this;
    }
    /**
     * Set result merger
     */
    merge(merger) {
        if (merger === 'simple') {
            this.resultMerger = (results) => simpleMerge(results, this.config.minResultCount || 30);
        }
        else {
            this.resultMerger = merger;
        }
        return this;
    }
    /**
     * Set minimum result count
     */
    minResults(count) {
        this.config.minResultCount = count;
        return this;
    }
    /**
     * Enable streaming mode
     */
    streaming() {
        this.config.enableStreaming = true;
        return this;
    }
    /**
     * Build the processor
     */
    build() {
        if (!this.llmProvider) {
            throw new Error('LLM provider is required. Use .withLLM() or .withUnillM()');
        }
        // Convert function to LLMProvider if needed
        const provider = typeof this.llmProvider === 'function'
            ? createLLMAdapter(this.llmProvider)
            : this.llmProvider;
        // Apply smart defaults
        const finalConfig = {
            chunkSize: 3000,
            overlapSize: 300,
            parallelProcessing: false,
            concurrency: 3,
            maxRetries: 2,
            retryDelay: 1000,
            chunkTimeout: 30000,
            ...this.config
        };
        return new FractalProcessor(provider, finalConfig);
    }
    /**
     * Build and immediately process text
     */
    async run(text) {
        const processor = this.build();
        if (this.contextGenerator || this.chunkProcessor || this.resultMerger) {
            // Use metadata processing if any custom options are set
            const options = {
                generateContext: this.contextGenerator || (async () => ({})),
                processChunk: this.chunkProcessor || (async (chunk) => ({ items: [chunk] })),
                getKey: (item) => JSON.stringify(item),
                mergeResults: this.resultMerger || ((results) => ({
                    items: results.flat(),
                    needsSupplement: false
                }))
            };
            const result = await processor.processWithMetadata(text, options);
            return result.items;
        }
        // Simple processing with default options
        return processor.process(text, {
            generateContext: async () => '',
            processChunk: async (chunk) => ({ items: [chunk] }),
            getKey: (item) => JSON.stringify(item),
            mergeResults: (results) => ({
                items: results.flat(),
                needsSupplement: false
            })
        });
    }
}
/**
 * Create a new fluent builder
 *
 * @example
 * ```typescript
 * import { fractop } from '@aid-on/fractop';
 *
 * const result = await fractop()
 *   .withLLM(myLLM)
 *   .chunking({ size: 2000, overlap: 200 })
 *   .parallel(5)
 *   .run(text);
 * ```
 */
export function fractop() {
    return new FractoPBuilder();
}
