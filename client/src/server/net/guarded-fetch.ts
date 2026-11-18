import { fetch as undiciFetch, type HeadersInit as UndiciHeadersInit } from 'undici';
import { assertPublicHost, PrivateAddressError, publicDispatcher } from './public-address';

/**
 * The outbound guard. Every call Dialed makes for a person (an API, a docs page) goes through it:
 * - http and https only, to public addresses only (checked at DNS time, on every connection);
 * - a timeout (20 s by default) and a size cap (10 MB by default), counted as the body streams in;
 * - at most 3 redirects, each one checked again. A redirect to another host drops the credentials
 *   (Authorization, Cookie and any header named in `secretHeaders`), so a key only goes to its own host.
 */
export type GuardOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Header names that carry a key (an API's "apikey"): dropped when a redirect leaves the first host. */
  secretHeaders?: string[];
  signal?: AbortSignal;
};

export type GuardedInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | null;
};

export type GuardedResponse = {
  ok: boolean;
  status: number;
  headers: Headers;
  /** The final URL, after redirects. */
  url: string;
  redirects: number;
  ms: number;
  bytes: Buffer;
  text(): string;
  /** Parses the body as JSON; throws GuardError("bad_json") when it isn't. */
  json(): unknown;
};

export type GuardErrorCode =
  'bad_url' | 'private_address' | 'timeout' | 'too_large' | 'too_many_redirects' | 'network' | 'bad_json';

export class GuardError extends Error {
  readonly code: GuardErrorCode;
  constructor(code: GuardErrorCode, message: string) {
    super(message);
    this.name = 'GuardError';
    this.code = code;
  }
}

export const GUARD_DEFAULTS = { timeoutMs: 20_000, maxBytes: 10 * 1024 * 1024, maxRedirects: 3 } as const;

function parseUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = new URL(String(input));
  } catch {
    throw new GuardError('bad_url', 'That address isn’t a full URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new GuardError('bad_url', 'Only http and https addresses can be called.');
  if (url.username || url.password) throw new GuardError('bad_url', 'Put credentials in a key, not in the address.');
  try {
    assertPublicHost(url);
  } catch {
    throw new GuardError('private_address', 'That address points to a private or local network.');
  }
  return url;
}

async function readCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new GuardError('too_large', `The response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function isCause(error: unknown, check: (e: unknown) => boolean): boolean {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    if (check(current)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Calls a URL through the guard. Throws GuardError for anything the guard stops or the network fails. */
export async function guardedFetch(
  input: string | URL,
  init: GuardedInit = {},
  options: GuardOptions = {},
): Promise<GuardedResponse> {
  const timeoutMs = options.timeoutMs ?? GUARD_DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? GUARD_DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? GUARD_DEFAULTS.maxRedirects;
  const secret = new Set([
    'authorization',
    'cookie',
    'proxy-authorization',
    ...(options.secretHeaders ?? []).map((h) => h.toLowerCase()),
  ]);

  const started = Date.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;

  let url = parseUrl(input);
  const firstHost = url.host;
  let method = (init.method ?? 'GET').toUpperCase();
  let headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body = init.body ?? null;

  for (let redirects = 0; ; redirects++) {
    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(url, {
        method,
        headers: headers as UndiciHeadersInit,
        body: method === 'GET' || method === 'HEAD' ? undefined : (body ?? undefined),
        redirect: 'manual',
        signal,
        dispatcher: publicDispatcher(),
      });
    } catch (error) {
      if (timeout.aborted) throw new GuardError('timeout', `No answer within ${Math.round(timeoutMs / 1000)} seconds.`);
      if (isCause(error, (e) => e instanceof PrivateAddressError || (e as { code?: string }).code === 'EPRIVATE'))
        throw new GuardError('private_address', 'That address points to a private or local network.');
      if (options.signal?.aborted) throw new GuardError('timeout', 'The call was stopped.');
      throw new GuardError('network', 'Couldn’t reach that address. Check it and try again.');
    }

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      if (redirects >= maxRedirects)
        throw new GuardError('too_many_redirects', `It redirected more than ${maxRedirects} times.`);
      const next = parseUrl(new URL(location, url));
      // Leaving the first host, or dropping from https to http, drops the credentials.
      if (next.host !== firstHost || (url.protocol === 'https:' && next.protocol !== 'https:'))
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !secret.has(k.toLowerCase())));
      // 303 always, and 301/302 after a POST, become a GET without a body (what browsers do).
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET';
        body = null;
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^content-(type|length)$/i.test(k)));
      }
      url = next;
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = await readCapped(res.body as ReadableStream<Uint8Array> | null, maxBytes);
    } catch (error) {
      if (error instanceof GuardError) throw error;
      if (timeout.aborted) throw new GuardError('timeout', `No answer within ${Math.round(timeoutMs / 1000)} seconds.`);
      throw new GuardError('network', 'The connection dropped while reading the answer.');
    }
    const responseHeaders = new Headers();
    res.headers.forEach((value, name) => responseHeaders.append(name, value));
    return {
      ok: res.ok,
      status: res.status,
      headers: responseHeaders,
      url: url.toString(),
      redirects,
      ms: Date.now() - started,
      bytes,
      text: () => bytes.toString('utf8'),
      json: () => {
        try {
          return JSON.parse(bytes.toString('utf8'));
        } catch {
          throw new GuardError('bad_json', 'The answer isn’t valid JSON.');
        }
      },
    };
  }
}
