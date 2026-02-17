/**
 * FractoP + Nagare Stream Integration
 *
 * Stream-based text processing with reactive patterns
 */
import { stream as nagareStream } from '@aid-on/nagare';
import { fractop } from './fluent';
/**
 * Create a Nagare stream from FractoP processing
 *
 * @example
 * ```typescript
 * const stream = fractopStream(text)
 *   .withLLM(async (chunk) => await llm.process(chunk))
 *   .chunking({ size: 2000 })
 *   .stream();
 *
 * await stream
 *   .map(result => result.toUpperCase())
 *   .filter(result => result.length > 100)
 *   .forEach(console.log);
 * ```
 */
export class FractoPStream {
    text;
    builder = fractop();
    constructor(text) {
        this.text = text;
    }
    /**
     * Configure the LLM processor
     */
    withLLM(provider) {
        this.builder.withLLM(provider);
        return this;
    }
    /**
     * Configure chunking
     */
    chunking(options) {
        this.builder.chunking(options);
        return this;
    }
    /**
     * Enable parallel processing
     */
    parallel(concurrency) {
        this.builder.parallel(concurrency);
        return this;
    }
    /**
     * Create a Nagare stream
     */
    stream() {
        const processor = this.builder.build();
        // Create stream from async generator
        return nagareStream.create((controller) => {
            (async () => {
                try {
                    // Process chunks and emit results  
                    const results = await processor.process(this.text, {
                        generateContext: async () => '',
                        processChunk: async (chunk) => ({ items: [chunk] }),
                        getKey: (item) => JSON.stringify(item),
                        mergeResults: (results) => ({
                            items: results.flat(),
                            needsSupplement: false
                        })
                    });
                    for (const result of results) {
                        controller.next(result);
                    }
                    controller.complete();
                }
                catch (error) {
                    controller.error(error instanceof Error ? error : new Error(String(error)));
                }
            })();
        });
    }
    /**
     * Process and collect all results
     */
    async collect() {
        const stream = this.stream();
        return stream.collect();
    }
}
/**
 * Create a stream-based FractoP processor
 *
 * @example
 * ```typescript
 * const results = await fractopStream(longText)
 *   .withLLM(myLLM)
 *   .chunking({ size: 2000 })
 *   .collect();
 * ```
 */
export function fractopStream(text) {
    return new FractoPStream(text);
}
/**
 * Process multiple texts as a stream
 *
 * @example
 * ```typescript
 * const texts = ['text1', 'text2', 'text3'];
 *
 * await fractopBatch(texts)
 *   .withLLM(myLLM)
 *   .chunking({ size: 2000 })
 *   .stream()
 *   .map(result => ({ ...result, processed: true }))
 *   .forEach(console.log);
 * ```
 */
export class FractoPBatch {
    texts;
    builder = fractop();
    constructor(texts) {
        this.texts = texts;
    }
    /**
     * Configure the processor
     */
    withLLM(provider) {
        this.builder.withLLM(provider);
        return this;
    }
    /**
     * Configure chunking
     */
    chunking(options) {
        this.builder.chunking(options);
        return this;
    }
    /**
     * Create a stream of results
     */
    stream() {
        const processor = this.builder.build();
        return nagareStream.create((controller) => {
            (async () => {
                try {
                    for (const text of this.texts) {
                        const result = await processor.process(text, {
                            generateContext: async () => '',
                            processChunk: async (chunk) => ({ items: [chunk] }),
                            getKey: (item) => JSON.stringify(item),
                            mergeResults: (results) => ({
                                items: results.flat(),
                                needsSupplement: false
                            })
                        });
                        controller.next({ text, result });
                    }
                    controller.complete();
                }
                catch (error) {
                    controller.error(error instanceof Error ? error : new Error(String(error)));
                }
            })();
        });
    }
    /**
     * Process all texts and collect results
     */
    async collectAll() {
        const results = new Map();
        const items = await this.stream().collect();
        for (const { text, result } of items) {
            results.set(text, result);
        }
        return results;
    }
}
/**
 * Process multiple texts in batch
 */
export function fractopBatch(texts) {
    return new FractoPBatch(texts);
}
/**
 * Create a reactive pipeline with operators
 *
 * @example
 * ```typescript
 * const pipeline = createPipeline()
 *   .source(longText)
 *   .chunk(2000, 200)
 *   .process(async (chunk) => await llm.summarize(chunk))
 *   .merge('weighted')
 *   .build();
 *
 * const result = await pipeline.execute();
 * ```
 */
export class FractoPPipeline {
    sourceText;
    operations = [];
    /**
     * Set the source text
     */
    source(text) {
        this.sourceText = text;
        return this;
    }
    /**
     * Add chunking operation
     */
    chunk(size, overlap) {
        this.operations.push(async (text) => {
            // Manual chunking implementation
            const chunks = [];
            const overlapSize = overlap || 0;
            for (let i = 0; i < text.length; i += (size - overlapSize)) {
                chunks.push(text.substring(i, i + size));
                if (i + size >= text.length)
                    break;
            }
            return chunks;
        });
        return this;
    }
    /**
     * Add processing operation
     */
    process(fn) {
        this.operations.push(async (chunks) => {
            const results = await Promise.all(chunks.map(fn));
            return results;
        });
        return this;
    }
    /**
     * Add merge operation
     */
    merge(strategy) {
        this.operations.push(async (results) => {
            if (strategy === 'simple') {
                return results.flat();
            }
            else if (strategy === 'weighted') {
                // Weighted merge logic
                const counts = new Map();
                results.flat().forEach(item => {
                    const key = JSON.stringify(item);
                    counts.set(key, (counts.get(key) || 0) + 1);
                });
                return Array.from(counts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([item]) => JSON.parse(item));
            }
            else {
                return strategy(results.flat());
            }
        });
        return this;
    }
    /**
     * Execute the pipeline
     */
    async execute() {
        if (!this.sourceText) {
            throw new Error('Source text is required');
        }
        let result = this.sourceText;
        for (const operation of this.operations) {
            result = await operation(result);
        }
        return result;
    }
    /**
     * Execute as a stream
     */
    executeStream() {
        return nagareStream.create((controller) => {
            this.execute()
                .then(result => {
                if (Array.isArray(result)) {
                    result.forEach(item => controller.next(item));
                }
                else {
                    controller.next(result);
                }
                controller.complete();
            })
                .catch(error => controller.error(error));
        });
    }
}
/**
 * Create a reactive processing pipeline
 */
export function createPipeline() {
    return new FractoPPipeline();
}
