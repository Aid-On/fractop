/**
 * LLM Adapter for FractoP
 * 
 * Converts simple async functions to LLMProvider interface
 */

import type { LLMProvider } from './types';

/**
 * Create an LLMProvider from a simple async function
 * This adapter allows using any LLM library with FractoP
 * 
 * @example
 * ```typescript
 * const provider = createLLMAdapter(async (chunk) => {
 *   const result = await myLLM.process(chunk);
 *   return result.text;
 * });
 * ```
 */
export function createLLMAdapter<T = string>(
  processChunk: (chunk: string) => Promise<T>
): LLMProvider {
  return {
    async chat(systemPrompt: string, userPrompt: string, _options?: {
      temperature?: number;
      maxTokens?: number;
    }): Promise<string> {
      // Combine system and user prompts for simple processors
      const fullPrompt = systemPrompt
        ? `${systemPrompt}\n\n${userPrompt}`
        : userPrompt;
      
      const result = await processChunk(fullPrompt);
      
      // Convert result to string if needed
      if (typeof result === 'string') {
        return result;
      } else if (result && typeof result === 'object' && 'toString' in result) {
        return result.toString();
      } else {
        return JSON.stringify(result);
      }
    }
  };
}

/**
 * Create an LLMProvider for UnillM integration
 * 
 * @example
 * ```typescript
 * import { generate } from '@aid-on/unillm';
 * 
 * const provider = createUnillMAdapter(
 *   'groq:llama-3.1-8b-instant',
 *   { groqApiKey: process.env.GROQ_API_KEY }
 * );
 * ```
 */
export function createUnillMAdapter(
  _model: string,
  _credentials: Record<string, unknown>
): LLMProvider {
  return {
    async chat(systemPrompt: string, userPrompt: string, _options?: {
      temperature?: number;
      maxTokens?: number;
    }): Promise<string> {
      // This is a placeholder - actual implementation would use UnillM
      // Since we can't import UnillM here (to avoid dependency), 
      // users should implement this themselves
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: userPrompt });
      
      // Users should replace this with actual UnillM call
      // const result = await generate(model, messages, { ...credentials, ...options });
      // return result.text;
      
      throw new Error(
        'UnillM adapter requires manual implementation. ' +
        'Please use createLLMAdapter with your own UnillM integration.'
      );
    }
  };
}