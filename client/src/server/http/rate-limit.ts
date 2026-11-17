// Adapted from dl-cms/cms/src/server/http/rate-limit.ts
import { errors } from '@/contracts/common';

/**
 * A small in-memory sliding-window limiter (per server instance), for sign-up, log-in, resets and resends.
 * Keys are made up by the caller: `login:ip:1.2.3.4`, `login:email:a@b.c`.
 */
const globals = globalThis as unknown as { __dialedRateLimits?: Map<string, number[]> };
const hits = (globals.__dialedRateLimits ??= new Map<string, number[]>());
const MAX_KEYS = 10_000;
/** The longest window any limit here uses: a key past it counts for nothing. */
const LONGEST_WINDOW_MS = 60 * 60 * 1000;

/**
 * Keeps the map to size. Keys past every window go first, then the ones with the fewest hits: anyone can make
 * up new addresses or emails, each with one hit, and that mustn't push out a counter close to its limit.
 */
function makeRoom() {
  if (hits.size <= MAX_KEYS) return;
  const now = Date.now();
  for (const [key, times] of hits)
    if (!times.length || now - times[times.length - 1] >= LONGEST_WINDOW_MS) hits.delete(key);
  if (hits.size <= MAX_KEYS) return;
  const fewestFirst = [...hits.entries()].sort(
    ([, a], [, b]) => a.length - b.length || a[a.length - 1] - b[b.length - 1],
  );
  for (const [key] of fewestFirst.slice(0, Math.ceil(MAX_KEYS / 10))) hits.delete(key);
}

function recent(key: string, windowMs: number) {
  const now = Date.now();
  return (hits.get(key) ?? []).filter((t) => now - t < windowMs);
}

function retryAfter(times: number[], windowMs: number) {
  return Math.max(1, Math.ceil((times[0] + windowMs - Date.now()) / 1000));
}

/** Counts a hit and throws a 429 once the key is over its limit. */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const times = recent(key, windowMs);
  if (times.length >= limit) throw errors.rateLimited(retryAfter(times, windowMs));
  times.push(Date.now());
  hits.set(key, times);
  makeRoom();
}

/** Throws a 429 when the key is over its limit, without counting (log-in only counts failures). */
export function assertUnderLimit(key: string, limit: number, windowMs: number) {
  const times = recent(key, windowMs);
  if (times.length >= limit) throw errors.rateLimited(retryAfter(times, windowMs));
}

export function recordHit(key: string) {
  const list = hits.get(key) ?? [];
  list.push(Date.now());
  hits.set(key, list);
  makeRoom();
}

/** Forgets a key's hits (a successful reset clears the failed log-ins for that email). */
export function clearHits(key: string) {
  hits.delete(key);
}

/** Tests start from a clean slate. */
export function resetRateLimits() {
  hits.clear();
}

export const MINUTE = 60_000;
