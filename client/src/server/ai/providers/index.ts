// Adapted from dl-cms/cms/src/server/ai/providers/index.ts
import type { SseOptions } from '../sse';
import type { ChatInput, ProviderEvent } from '../types';
import { streamAnthropic } from './anthropic';
import { streamCompat } from './openai-compatible';

/** One streaming chat call to the input's provider. Throws AiCallError; the caller's abort throws as it is. */
export function streamChat(input: ChatInput, sse: Partial<SseOptions> = {}): AsyncGenerator<ProviderEvent> {
  return input.provider === 'anthropic' ? streamAnthropic(input, sse) : streamCompat(input.provider, input, sse);
}
