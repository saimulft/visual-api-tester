// Adapted from dl-cms/cms/src/server/ai/providers/anthropic.ts (no thinking levels: each model runs its default)
import type { AiErrorKind } from '@/contracts/ai';
import { postSse, type SseOptions } from '../sse';
import { AiCallError, NO_CREDIT_PATTERN, type AiMessage, type ChatInput, type ProviderEvent } from '../types';

/**
 * Anthropic Messages API over plain fetch, streaming. The system prompt and the tools are cached (prompt
 * caching), and so is the conversation (automatic caching of the last block), so each step of the setup loop
 * reads the earlier ones from the cache. Current models think adaptively by default; their thinking blocks go
 * back unchanged within the turn.
 */
const URL = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';
const MAX_TOKENS = 32_000;
/** Models that take server-side refusal fallbacks ("default" routing). */
const REFUSAL_FALLBACK = /^claude-(fable-5-2|fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;
const CACHE = { type: 'ephemeral' } as const;

type Block = Record<string, unknown>;

/** Tool ids must match ^[a-zA-Z0-9_-]+$ (another provider's ids may not). */
const toolId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'call';

/**
 * The conversation in Anthropic's shape. Thinking blocks go back unchanged on every request, as Anthropic asks:
 * the setup loop's history only ever grows, and the API ignores, unbilled, any block the model can't read.
 */
export function anthropicMessages(messages: AiMessage[]) {
  const out: { role: 'user' | 'assistant'; content: Block[] }[] = [];
  const push = (role: 'user' | 'assistant', content: Block[]) => {
    if (!content.length) return;
    const prev = out.at(-1);
    if (prev?.role === role) prev.content.push(...content);
    else out.push({ role, content });
  };
  messages.forEach((message) => {
    const content: Block[] = [];
    for (const part of message.parts) {
      if (part.type === 'text' && part.text) content.push({ type: 'text', text: part.text });
      else if (part.type === 'tool_call')
        content.push({
          type: 'tool_use',
          id: toolId(part.id),
          name: part.name,
          input: part.args && typeof part.args === 'object' ? part.args : {},
        });
      else if (part.type === 'tool_result')
        content.push({
          type: 'tool_result',
          tool_use_id: toolId(part.callId),
          content: [{ type: 'text', text: part.content || '(empty)' }],
          ...(part.isError ? { is_error: true } : {}),
        });
      else if (part.type === 'native' && part.provider === 'anthropic') content.push(part.block as Block);
    }
    push(message.role === 'assistant' ? 'assistant' : 'user', content);
  });
  return out;
}

export function anthropicRequest(input: ChatInput) {
  // On a refusal Anthropic answers on a fallback model instead of stopping.
  const fallback = REFUSAL_FALLBACK.test(input.model);
  const maxTokens = Math.min(MAX_TOKENS, input.maxOutput ?? MAX_TOKENS);
  const tools = input.tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
    ...(i === input.tools.length - 1 ? { cache_control: CACHE } : {}),
  }));
  return {
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': VERSION,
      ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
    },
    body: {
      model: input.model,
      max_tokens: maxTokens,
      stream: true,
      cache_control: CACHE,
      system: [{ type: 'text', text: input.system, cache_control: CACHE }],
      messages: anthropicMessages(input.messages),
      ...(tools.length ? { tools } : {}),
      ...(fallback ? { fallbacks: 'default' } : {}),
    },
  };
}

function kindForError(type: string, message: string): AiErrorKind {
  switch (type) {
    case 'authentication_error':
    case 'permission_error':
      return 'auth';
    case 'rate_limit_error':
    case 'billing_error':
      return 'rate_limit';
    case 'timeout_error':
      return 'timeout';
    case 'invalid_request_error':
    case 'request_too_large':
    case 'not_found_error':
      return NO_CREDIT_PATTERN.test(message) ? 'rate_limit' : 'bad_request';
    default:
      return 'unavailable';
  }
}

type AttemptUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};
type UsageBlock = AttemptUsage & { iterations?: AttemptUsage[] };

/**
 * Tokens in and out of a usage block. Cached input counts in full. With refusal fallbacks the top level covers
 * only the last attempt; `iterations` has each one.
 */
function usageOf(usage: UsageBlock) {
  let input = 0;
  let output = 0;
  for (const u of usage.iterations?.length ? usage.iterations : [usage]) {
    input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    output += u.output_tokens ?? 0;
  }
  return { input, output };
}

function parse(data: string): Block {
  try {
    return JSON.parse(data) as Block;
  } catch {
    throw new AiCallError('invalid_response');
  }
}

export async function* streamAnthropic(input: ChatInput, sse: Partial<SseOptions> = {}): AsyncGenerator<ProviderEvent> {
  const { headers, body } = anthropicRequest(input);
  const blocks = new Map<number, Block & { json?: string }>();
  let usage = { input: 0, output: 0 };
  let stopReason: string | null = null;
  let finished = false;
  let calls = 0;
  let texted = false;

  for await (const message of postSse(URL, headers, body, { signal: input.signal, ...sse })) {
    const event = parse(message.data);
    switch (event.type) {
      case 'message_start': {
        usage = usageOf(((event.message as Block)?.usage ?? {}) as UsageBlock);
        // Reported now as well: a call stopped before the end still used this much.
        yield { type: 'usage', inputTokens: usage.input, outputTokens: usage.output };
        break;
      }
      case 'content_block_start': {
        const block = { ...(event.content_block as Block) };
        if (block.type === 'tool_use') block.json = '';
        blocks.set(Number(event.index), block);
        if (block.type === 'text' && typeof block.text === 'string' && block.text) {
          texted = true;
          yield { type: 'text', delta: block.text };
        }
        break;
      }
      case 'content_block_delta': {
        const block = blocks.get(Number(event.index));
        const delta = (event.delta ?? {}) as Record<string, string>;
        if (delta.type === 'text_delta') {
          if (delta.text) {
            texted = true;
            yield { type: 'text', delta: delta.text };
          }
        } else if (!block) {
          break;
        } else if (delta.type === 'input_json_delta') {
          block.json = (block.json ?? '') + (delta.partial_json ?? '');
          yield { type: 'progress', bytes: Buffer.byteLength(delta.partial_json ?? '') };
        } else if (delta.type === 'thinking_delta') {
          block.thinking = String(block.thinking ?? '') + (delta.thinking ?? '');
          if (delta.thinking) yield { type: 'thinking', delta: delta.thinking };
        } else if (delta.type === 'signature_delta') {
          block.signature = delta.signature;
        }
        break;
      }
      case 'content_block_stop': {
        const block = blocks.get(Number(event.index));
        blocks.delete(Number(event.index));
        if (!block || block.type === 'text') break;
        if (block.type === 'tool_use') {
          calls++;
          const raw = block.json?.trim() || '{}';
          try {
            yield { type: 'tool_call', id: String(block.id), name: String(block.name), args: JSON.parse(raw) };
          } catch {
            yield {
              type: 'tool_call',
              id: String(block.id),
              name: String(block.name),
              args: raw,
              error: 'The arguments weren’t valid JSON.',
            };
          }
        } else {
          const { json: _json, ...rest } = block;
          void _json;
          yield { type: 'native', block: rest };
        }
        break;
      }
      case 'message_delta': {
        const delta = (event.delta ?? {}) as Record<string, string | null>;
        if (delta.stop_reason) stopReason = delta.stop_reason;
        const u = (event.usage ?? {}) as UsageBlock;
        if (u.iterations?.length) usage = usageOf(u);
        else if (typeof u.output_tokens === 'number') usage.output = u.output_tokens;
        break;
      }
      case 'message_stop':
        finished = true;
        break;
      case 'error': {
        const error = (event.error ?? {}) as Record<string, string>;
        const detail = String(error.message ?? '').slice(0, 300);
        throw new AiCallError(kindForError(String(error.type), detail), { detail });
      }
      default:
        break; // ping, and event types added later
    }
  }
  if (!finished) throw new AiCallError('network', { detail: 'The stream ended early.' });
  if (stopReason === 'refusal')
    yield { type: 'text', delta: `${texted ? '\n\n' : ''}The model declined to answer this.` };
  yield { type: 'usage', inputTokens: usage.input, outputTokens: usage.output };
  yield { type: 'done', stop: calls > 0 ? 'tool_calls' : stopReason === 'max_tokens' ? 'length' : 'end' };
}
