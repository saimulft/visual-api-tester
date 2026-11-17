// Adapted from dl-cms/cms/src/server/ai/sse.ts
import { AiCallError, kindForResponse, redactSecrets } from './types';

/** Time to the first byte of an answer, and the longest silence after it. */
export const FIRST_BYTE_MS = 60_000;
export const IDLE_MS = 180_000;
const MAX_RETRY_AFTER_MS = 8_000;

export type SseMessage = { event: string; data: string };

export type SseOptions = {
  signal: AbortSignal;
  firstByteMs?: number;
  idleMs?: number;
};

/** Retry-After in milliseconds (seconds or an HTTP date), capped at 8 s. */
export function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_AFTER_MS, seconds * 1000);
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - Date.now()));
  return undefined;
}

/** The provider's error message, redacted and short: for the server log only. */
export async function readErrorDetail(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  let message = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
    const first = Array.isArray(parsed) ? (parsed[0] as typeof parsed) : parsed;
    const nested =
      first && typeof first.error === 'object' && first.error !== null
        ? (first.error as { message?: unknown }).message
        : undefined;
    const candidate = nested ?? first?.message;
    if (typeof candidate === 'string') message = candidate;
  } catch {
    /* not JSON */
  }
  return redactSecrets(message.replace(/\s+/g, ' ').trim()).slice(0, 300);
}

/**
 * POSTs a streaming request and yields its server-sent events. HTTP errors, timeouts and network failures
 * throw AiCallError; the caller's own abort throws as it is (check `signal.aborted`).
 */
export async function* postSse(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: SseOptions,
): AsyncGenerator<SseMessage> {
  const { signal } = opts;
  signal.throwIfAborted();
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
  };
  const failure = (error: unknown) => {
    if (signal.aborted) return error;
    if (error instanceof AiCallError) return error;
    return new AiCallError(timedOut ? 'timeout' : 'network');
  };

  arm(opts.firstByteMs ?? FIRST_BYTE_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let finished = false;
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw failure(error);
    }
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new AiCallError(kindForResponse(response.status, detail), {
        status: response.status,
        retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
        detail,
      });
    }
    if (!response.body) throw new AiCallError('invalid_response', { status: response.status });

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let event = '';
    let data: string[] = [];
    const dispatch = (): SseMessage | null => {
      const message = data.length ? { event: event || 'message', data: data.join('\n') } : null;
      event = '';
      data = [];
      return message;
    };
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        throw failure(error);
      }
      if (chunk.done) break;
      arm(opts.idleMs ?? IDLE_MS);
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line === '') {
          const message = dispatch();
          if (message) yield message;
        } else if (line.startsWith(':')) {
          // A comment (OpenRouter's "processing" keepalive).
        } else {
          const at = line.indexOf(':');
          const field = at < 0 ? line : line.slice(0, at);
          const value = at < 0 ? '' : line.slice(at + 1).replace(/^ /, '');
          if (field === 'event') event = value;
          else if (field === 'data') data.push(value);
        }
      }
    }
    finished = true;
    buffer += decoder.decode();
    if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, ''));
    const last = dispatch();
    if (last) yield last;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    if (reader && !finished) await reader.cancel().catch(() => {});
  }
}
