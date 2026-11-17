import { ApiError } from '@/contracts/common';
import { rateLimit } from '../http/rate-limit';
import { guardedFetch, GuardError, type GuardedResponse } from '../net/guarded-fetch';

/**
 * Every docs fetch goes through the outbound guard: public addresses only, every redirect checked again, a
 * timeout and a size cap. Docs are read with a plain browser-like Accept header and no cookies or keys.
 */
export const DOCS_LIMITS = {
  timeoutMs: 15_000,
  /** A docs page or llms.txt. */
  pageBytes: 3 * 1024 * 1024,
  /** llms-full.txt and OpenAPI files run larger. */
  bigBytes: 8 * 1024 * 1024,
  maxRedirects: 4,
} as const;

const HEADERS = {
  accept: 'text/html,text/markdown,text/plain,application/json,application/yaml,*/*;q=0.5',
  'user-agent': 'Dialed docs reader',
};

export type Fetched = { url: string; status: number; contentType: string; text: string; ok: boolean };

/** Fetches a docs URL through the guard. Network and guard failures throw a plain-worded ApiError. */
export async function fetchDocs(url: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<Fetched> {
  let res: GuardedResponse;
  try {
    res = await guardedFetch(
      url,
      { method: 'GET', headers: HEADERS },
      {
        timeoutMs: opts.timeoutMs ?? DOCS_LIMITS.timeoutMs,
        maxBytes: opts.maxBytes ?? DOCS_LIMITS.pageBytes,
        maxRedirects: DOCS_LIMITS.maxRedirects,
      },
    );
  } catch (error) {
    if (error instanceof GuardError)
      throw new ApiError(`docs_${error.code}`, `Couldn’t read ${url}: ${error.message}`, 422);
    throw error;
  }
  return {
    url: res.url,
    status: res.status,
    contentType: (res.headers.get('content-type') ?? '').toLowerCase(),
    text: res.text(),
    ok: res.ok,
  };
}

/** Like fetchDocs, but null on any failure (probing tries many addresses). */
export async function tryFetch(url: string, opts: { maxBytes?: number; timeoutMs?: number } = {}) {
  try {
    const got = await fetchDocs(url, opts);
    return got.ok ? got : null;
  } catch {
    return null;
  }
}

/** Docs lookups per person: generous for searching as you type, not for crawling. */
export function limitDiscovery(userId: string) {
  try {
    rateLimit(`discovery:${userId}`, 60, 10 * 60_000);
  } catch {
    throw new ApiError('rate_limited', 'That’s a lot of docs lookups in a short time. Wait a few minutes.', 429);
  }
}

export const looksLikeHtml = (f: Pick<Fetched, 'contentType' | 'text'>) =>
  f.contentType.includes('html') || /^\s*(<!doctype html|<html)/i.test(f.text.slice(0, 500));
