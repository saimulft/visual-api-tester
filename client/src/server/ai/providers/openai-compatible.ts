// Adapted from dl-cms/cms/src/server/ai/providers/openai-compatible.ts (no thinking levels or images)
import { cleanForGemini } from '../schema';
import { postSse, type SseOptions } from '../sse';
import { AiCallError, kindForResponse, type AiMessage, type ChatInput, type ProviderEvent } from '../types';

/**
 * OpenAI Chat Completions, which OpenRouter and Gemini (its OpenAI compatibility) speak too: each with its base
 * URL and headers. Streaming with usage in the last chunk.
 */
export type CompatProvider = 'openai' | 'openrouter' | 'gemini';

export const BASE_URLS: Record<CompatProvider, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

/** Gemini accepts a function call another model made with this in place of its own thought signature. */
export const GEMINI_SKIP_SIGNATURE = 'skip_thought_signature_validator';

export function compatHeaders(provider: CompatProvider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { authorization: `Bearer ${apiKey}` };
  if (provider === 'openrouter') {
    // OpenRouter's app attribution (optional).
    const app = process.env.APP_URL;
    if (app) headers['HTTP-Referer'] = app;
    headers['X-Title'] = 'Dialed';
  }
  return headers;
}

type Msg = Record<string, unknown>;

export function compatMessages(provider: CompatProvider, system: string, messages: AiMessage[]) {
  const out: Msg[] = [{ role: 'system', content: system }];
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  for (const [index, message] of messages.entries()) {
    if (message.role === 'user') {
      const text = message.parts.flatMap((p) => (p.type === 'text' && p.text ? [p.text] : [])).join('\n\n');
      if (text) out.push({ role: 'user', content: text });
    } else if (message.role === 'assistant') {
      const text = message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('');
      const ownSignatures = message.provider === 'gemini';
      const calls = message.parts.flatMap((p, i) => {
        if (p.type !== 'tool_call') return [];
        const call: Msg = {
          id: p.id,
          type: 'function',
          function: { name: p.name, arguments: JSON.stringify(p.args ?? {}) },
        };
        if (provider === 'gemini') {
          const first = message.parts.findIndex((q) => q.type === 'tool_call') === i;
          const signature = p.signature ?? (!ownSignatures && first ? GEMINI_SKIP_SIGNATURE : null);
          if (signature) call.extra_content = { google: { thought_signature: signature } };
        }
        return [call];
      });
      if (!text && !calls.length) continue;
      // OpenRouter's reasoning goes back unchanged within the current turn, for reasoning across tool calls.
      const reasoning =
        provider === 'openrouter' && index > lastUser
          ? message.parts.flatMap((p) =>
              p.type === 'native' && p.provider === 'openrouter'
                ? ((p.block as { reasoning_details?: unknown[] }).reasoning_details ?? [])
                : [],
            )
          : [];
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}),
        ...(reasoning.length ? { reasoning_details: reasoning } : {}),
      });
    } else {
      for (const p of message.parts) {
        if (p.type !== 'tool_result') continue;
        out.push({ role: 'tool', tool_call_id: p.callId, content: p.content || '(empty)' });
      }
    }
  }
  return out;
}

/** OpenAI's reasoning models take only `max_completion_tokens`. In all three the cap counts thinking too. */
const compatOutputCap = (provider: CompatProvider, maxOutput?: number) =>
  !maxOutput ? {} : provider === 'openai' ? { max_completion_tokens: maxOutput } : { max_tokens: maxOutput };

export function compatRequest(provider: CompatProvider, input: ChatInput) {
  const tools = input.tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: provider === 'gemini' ? cleanForGemini(t.parameters) : t.parameters,
    },
  }));
  return {
    url: `${BASE_URLS[provider]}/chat/completions`,
    headers: compatHeaders(provider, input.apiKey),
    body: {
      model: input.model,
      messages: compatMessages(provider, input.system, input.messages),
      ...(tools.length ? { tools } : {}),
      ...compatOutputCap(provider, input.maxOutput),
      stream: true,
      stream_options: { include_usage: true },
    },
  };
}

type ToolDelta = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
  extra_content?: { google?: { thought_signature?: string } };
};
type ReasoningDetail = Record<string, unknown> & { index?: number };
type Chunk = {
  error?: { code?: number | string; message?: string };
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: ToolDelta[];
      reasoning?: string | null;
      reasoning_content?: string | null;
      reasoning_details?: ReasoningDetail[];
    };
    finish_reason?: string | null;
  }[];
};

export async function* streamCompat(
  provider: CompatProvider,
  input: ChatInput,
  sse: Partial<SseOptions> = {},
): AsyncGenerator<ProviderEvent> {
  const { url, headers, body } = compatRequest(provider, input);
  const calls: { id: string; name: string; args: string; signature?: string }[] = [];
  const byIndex = new Map<number, number>();
  let usage = { input: 0, output: 0 };
  let finish: string | null = null;
  let ended = false;
  /** OpenRouter's reasoning blocks, put together from their pieces by index. */
  const details: ReasoningDetail[] = [];

  for await (const message of postSse(url, headers, body, { signal: input.signal, ...sse })) {
    if (message.data === '[DONE]') {
      ended = true;
      break;
    }
    let chunk: Chunk;
    try {
      chunk = JSON.parse(message.data) as Chunk;
    } catch {
      throw new AiCallError('invalid_response');
    }
    if (chunk.error) {
      // OpenRouter reports a failure after the stream started as a chunk with the upstream status.
      const detail = String(chunk.error.message ?? '').slice(0, 300);
      const status = Number(chunk.error.code);
      throw new AiCallError(Number.isFinite(status) ? kindForResponse(status, detail) : 'unavailable', {
        detail,
        ...(Number.isFinite(status) ? { status } : {}),
      });
    }
    if (chunk.usage) {
      const promptTokens = chunk.usage.prompt_tokens ?? 0;
      // Gemini leaves thinking out of completion_tokens but counts it in total_tokens.
      usage = {
        input: promptTokens,
        output: Math.max(chunk.usage.completion_tokens ?? 0, (chunk.usage.total_tokens ?? 0) - promptTokens),
      };
    }
    let argumentBytes = 0;
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta ?? {};
      const reasoning = delta.reasoning || delta.reasoning_content;
      if (typeof reasoning === 'string' && reasoning) yield { type: 'thinking', delta: reasoning };
      for (const piece of delta.reasoning_details ?? []) {
        const at = details.findIndex((d) => d.index === piece.index && d.type === piece.type);
        if (at < 0 || piece.index === undefined) {
          details.push({ ...piece });
          continue;
        }
        const merged = details[at];
        for (const [key, value] of Object.entries(piece)) {
          if (['text', 'summary', 'data'].includes(key) && typeof value === 'string')
            merged[key] = String(merged[key] ?? '') + value;
          else if (value !== undefined && value !== null) merged[key] = value;
        }
      }
      if (typeof delta.content === 'string' && delta.content) yield { type: 'text', delta: delta.content };
      for (const tc of delta.tool_calls ?? []) {
        // Gemini may leave out the index (each call arrives whole): match by id, else a new call.
        let at = tc.index !== undefined ? byIndex.get(tc.index) : tc.id ? calls.findIndex((c) => c.id === tc.id) : -1;
        if (at === undefined || at < 0) {
          at = calls.push({ id: '', name: '', args: '' }) - 1;
          if (tc.index !== undefined) byIndex.set(tc.index, at);
        }
        const call = calls[at];
        if (tc.id && !call.id) call.id = tc.id;
        if (tc.function?.name && !call.name) call.name = tc.function.name;
        if (tc.function?.arguments) {
          call.args += tc.function.arguments;
          argumentBytes += Buffer.byteLength(tc.function.arguments);
        }
        const signature = tc.extra_content?.google?.thought_signature;
        if (signature) call.signature = signature;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    yield { type: 'progress', bytes: argumentBytes };
  }
  if (!ended && !finish) throw new AiCallError('network', { detail: 'The stream ended early.' });
  if (finish === 'error') throw new AiCallError('unavailable');
  if (provider === 'openrouter' && details.length) yield { type: 'native', block: { reasoning_details: details } };

  for (const [i, call] of calls.entries()) {
    const id = call.id || `call_${i}_${Date.now().toString(36)}`;
    const raw = call.args.trim() || '{}';
    const extra = call.signature ? { signature: call.signature } : {};
    try {
      yield { type: 'tool_call', id, name: call.name, args: JSON.parse(raw), ...extra };
    } catch {
      yield { type: 'tool_call', id, name: call.name, args: raw, error: 'The arguments weren’t valid JSON.', ...extra };
    }
  }
  yield { type: 'usage', inputTokens: usage.input, outputTokens: usage.output };
  yield { type: 'done', stop: calls.length ? 'tool_calls' : finish === 'length' ? 'length' : 'end' };
}
