import { sql } from 'kysely';
import { ApiError } from '@/contracts/common';
import type { RunError, RunRequestLog } from '@/contracts/runs';
import { db, dialect } from '../db';
import { GuardError, guardedFetch, type GuardedResponse } from '../net/guarded-fetch';
import { scrub, type BuiltRequest } from './request';

/**
 * One outbound call, the runner's way: through chat F's guard (the only way out), inside the person's caps
 * (60 calls a minute, 5,000 a day), with retries (a 429 honours Retry-After up to 3 times; a 5xx or a
 * timeout gets one more try), and a friendly error when it still fails.
 */

// ---------- Transport ----------

export type Transport = typeof guardedFetch;
const globals = globalThis as unknown as {
  __dialedTransport?: Transport | null;
  __dialedCallTimes?: Map<string, { times: number[]; seeded: boolean }>;
  __dialedSleep?: ((ms: number) => Promise<void>) | null;
  __dialedClockSkew?: number;
};

/** Tests answer calls themselves instead of reaching the internet (Vitest only). Pass null to undo. */
export function useTransportForTests(transport: Transport | null, sleep?: ((ms: number) => Promise<void>) | null) {
  if (!process.env.VITEST) throw new Error('useTransportForTests only works under Vitest.');
  globals.__dialedTransport = transport;
  globals.__dialedSleep = sleep ?? null;
}

/** Tests move the caps' clock forward instead of waiting a real minute (Vitest only). */
export function skewClockForTests(ms: number) {
  if (!process.env.VITEST) throw new Error('skewClockForTests only works under Vitest.');
  globals.__dialedClockSkew = (globals.__dialedClockSkew ?? 0) + ms;
}

const clock = () => Date.now() + (globals.__dialedClockSkew ?? 0);
const transport = (): Transport => globals.__dialedTransport ?? guardedFetch;
const sleep = (ms: number) =>
  globals.__dialedSleep ? globals.__dialedSleep(ms) : new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------- Caps ----------

export const CALLS_PER_MINUTE = 60;
export const CALLS_PER_DAY = 5000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const callTimes = (globals.__dialedCallTimes ??= new Map<string, { times: number[]; seeded: boolean }>());

/** Calls in the last day, counted from runs (each run keeps one log entry per call). */
async function callsFromRuns(userId: string, since: number): Promise<{ at: number; calls: number }[]> {
  const length =
    dialect === 'postgres' ? sql<number>`json_array_length(requests::json)` : sql<number>`json_array_length(requests)`;
  const rows = await db
    .selectFrom('runs')
    .select(['started_at', length.as('calls')])
    .where('user_id', '=', userId)
    .where('started_at', '>=', since)
    .execute();
  return rows.map((r) => ({ at: Number(r.started_at), calls: Number(r.calls) || 0 }));
}

async function windowFor(userId: string) {
  let entry = callTimes.get(userId);
  if (!entry) {
    entry = { times: [], seeded: false };
    callTimes.set(userId, entry);
  }
  if (!entry.seeded) {
    entry.seeded = true;
    const since = clock() - DAY;
    for (const run of await callsFromRuns(userId, since)) for (let i = 0; i < run.calls; i++) entry.times.push(run.at);
    entry.times.sort((a, b) => a - b);
  }
  const cutoff = clock() - DAY;
  while (entry.times.length && entry.times[0] < cutoff) entry.times.shift();
  return entry;
}

export class CapError extends Error {
  readonly code: 'daily_cap' | 'minute_cap';
  constructor(code: 'daily_cap' | 'minute_cap', message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Takes one call slot for the person. Past 5,000 in a day it throws. Past 60 in a minute a run waits for a
 * slot (wait: true); a live count throws instead.
 */
export async function takeSlot(userId: string, opts: { wait: boolean }): Promise<void> {
  for (;;) {
    const entry = await windowFor(userId);
    const now = clock();
    if (entry.times.length >= CALLS_PER_DAY)
      throw new CapError(
        'daily_cap',
        `You’ve made ${CALLS_PER_DAY.toLocaleString('en-US')} calls in the last day, the daily limit. Try again later.`,
      );
    const inMinute = entry.times.filter((t) => t > now - MINUTE);
    if (inMinute.length < CALLS_PER_MINUTE) {
      entry.times.push(now);
      return;
    }
    if (!opts.wait) throw new CapError('minute_cap', 'That’s 60 calls this minute, the limit. Wait a moment.');
    await sleep(Math.max(250, inMinute[0] + MINUTE - now + 10));
  }
}

/** The daily-cap message when the person has used it up, without taking a slot; else null. */
export async function dailyCapReached(userId: string): Promise<string | null> {
  const entry = await windowFor(userId);
  return entry.times.length >= CALLS_PER_DAY
    ? `You’ve made ${CALLS_PER_DAY.toLocaleString('en-US')} calls in the last day, the daily limit. Try again later.`
    : null;
}

/** Forgets the counts (tests). */
export function resetCallCounts() {
  callTimes.clear();
}

// ---------- Errors ----------

/** A call that failed in a way the person should read. */
export class CallError extends Error {
  readonly error: RunError;
  readonly status: number | null;
  constructor(error: RunError, status: number | null = null) {
    super(error.text);
    this.error = error;
    this.status = status;
  }
}

/** The API's own message from an error body: message, error, detail or errors[0]. */
export function apiMessage(data: unknown): string | null {
  const pick = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 240);
    if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>;
      return (
        pick(o.message) ?? pick(o.error_description) ?? pick(o.detail) ?? pick(o.error) ?? pick(o.msg) ?? pick(o.title)
      );
    }
    if (Array.isArray(value)) return pick(value[0]);
    return null;
  };
  if (Array.isArray(data)) return pick(data[0]);
  const o = (data ?? {}) as Record<string, unknown>;
  return pick(o.message) ?? pick(o.error) ?? pick(o.detail) ?? pick(o.errors) ?? pick(o.error_description);
}

/** The friendly error for a status the API answered with. */
export function statusError(apiName: string, status: number, data: unknown): RunError {
  const said = apiMessage(data);
  if (status === 401 || status === 403)
    return { code: 'key_refused', text: `Your ${apiName} key was refused. Replace it in Settings.` };
  if (status === 402)
    return { code: 'no_credits', text: `${apiName} says the account is out of credits.${said ? ` ${said}` : ''}` };
  if (status === 404) return { code: 'not_found', text: `${apiName} has nothing at that address.` };
  if (status === 429)
    return { code: 'rate_limited', text: `${apiName} kept saying slow down, so the run stopped. Try again later.` };
  if (status >= 500)
    return { code: 'api_down', text: `${apiName} had a problem on its side (${status}). Try again later.` };
  return {
    code: 'bad_input',
    text: said ? `${apiName} refused the input: ${said}` : `${apiName} refused the input (${status}).`,
  };
}

export function guardErrorText(apiName: string, error: GuardError): RunError {
  switch (error.code) {
    case 'timeout':
      return { code: 'timeout', text: 'The API took too long.' };
    case 'private_address':
      return {
        code: 'private_address',
        text: 'That address points to a private or local network, so it wasn’t called.',
      };
    case 'too_large':
      return { code: 'too_large', text: `${apiName}’s answer was too large. Ask for fewer records.` };
    case 'bad_json':
      return { code: 'bad_json', text: `${apiName} didn’t answer with JSON.` };
    case 'too_many_redirects':
      return { code: 'redirects', text: `${apiName} redirected too many times.` };
    case 'bad_url':
      return { code: 'bad_url', text: error.message };
    default:
      return { code: 'network', text: `Couldn’t reach ${apiName}. Check your connection and try again.` };
  }
}

// ---------- One call ----------

export type CallResult = {
  response: GuardedResponse;
  data: unknown;
  retries: number;
  /** Seconds waited on 429s, for "Rate limited, retried after 4 s". */
  rateWaitSeconds: number;
  log: RunRequestLog;
};

export type CallOptions = {
  userId: string;
  apiName: string;
  /** Wait for a slot when the minute cap is reached (runs), or throw (live counts). */
  waitForSlot: boolean;
  /** The plain key, to scrub from anything echoed back. */
  secret?: string | null;
  timeoutMs?: number;
};

const MAX_RATE_RETRIES = 3;
const MAX_RETRY_AFTER_S = 30;

/** Retry-After in seconds (a number or an HTTP date), or null. */
export function retryAfterSeconds(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const n = Number(header);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : null;
}

/** The log entry for a call, from the masked copy of the request. */
export function logOf(
  masked: BuiltRequest,
  secret: string | null | undefined,
  outcome: { status: number | null; ms: number; bytes: number; records: number; retries: number; error: string | null },
): RunRequestLog {
  return {
    endpointId: masked.endpointId,
    method: masked.method,
    url: scrub(masked.url, secret),
    headers: masked.headers,
    body: masked.body === null ? null : scrub(masked.body, secret),
    status: outcome.status,
    ms: outcome.ms,
    bytes: outcome.bytes,
    records: outcome.records,
    retries: outcome.retries,
    error: outcome.error,
    at: Date.now(),
  };
}

/**
 * Sends one request (the real one, key included) and logs the masked copy. Returns the answer when the API
 * answered 2xx; throws CallError (with the log attached) when it didn't, after the retries.
 */
export async function callApi(request: BuiltRequest, masked: BuiltRequest, opts: CallOptions): Promise<CallResult> {
  let retries = 0;
  let rateRetries = 0;
  let rateWait = 0;
  let retriedOther = false;
  const started = Date.now();

  for (;;) {
    try {
      await takeSlot(opts.userId, { wait: opts.waitForSlot });
    } catch (error) {
      if (error instanceof CapError) throw new CallErrorWithLog({ code: error.code, text: error.message }, null, null);
      throw error;
    }
    let response: GuardedResponse;
    try {
      response = await transport()(
        request.url,
        { method: request.method, headers: request.headers, body: request.body },
        { timeoutMs: opts.timeoutMs, secretHeaders: request.secretHeaders },
      );
    } catch (error) {
      if (error instanceof GuardError) {
        if ((error.code === 'timeout' || error.code === 'network') && !retriedOther) {
          retriedOther = true;
          retries++;
          await sleep(1000);
          continue;
        }
        const failure = guardErrorText(opts.apiName, error);
        throw new CallErrorWithLog(
          failure,
          null,
          logOf(masked, opts.secret, {
            status: null,
            ms: Date.now() - started,
            bytes: 0,
            records: 0,
            retries,
            error: failure.text,
          }),
        );
      }
      throw error;
    }

    if (response.status === 429 && rateRetries < MAX_RATE_RETRIES) {
      const after = retryAfterSeconds(response.headers.get('retry-after')) ?? 2 ** (rateRetries + 1);
      if (after <= MAX_RETRY_AFTER_S) {
        rateRetries++;
        retries++;
        rateWait += after;
        await sleep(after * 1000);
        continue;
      }
    }
    if (response.status >= 500 && !retriedOther) {
      retriedOther = true;
      retries++;
      await sleep(1000);
      continue;
    }

    let data: unknown = null;
    const text = response.text();
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        data = response.ok ? undefined : text.slice(0, 240);
      }
    }
    const outcome = { status: response.status, ms: Date.now() - started, bytes: response.bytes.length, retries };
    if (!response.ok) {
      const failure = statusError(opts.apiName, response.status, data);
      failure.text = scrub(failure.text, opts.secret);
      throw new CallErrorWithLog(
        failure,
        response.status,
        logOf(masked, opts.secret, { ...outcome, records: 0, error: failure.text }),
      );
    }
    if (data === undefined) {
      const failure = { code: 'bad_json', text: `${opts.apiName} didn’t answer with JSON.` };
      throw new CallErrorWithLog(
        failure,
        response.status,
        logOf(masked, opts.secret, { ...outcome, records: 0, error: failure.text }),
      );
    }
    return {
      response,
      data,
      retries,
      rateWaitSeconds: rateWait,
      log: logOf(masked, opts.secret, { ...outcome, records: 0, error: null }),
    };
  }
}

/** A CallError that carries the failed call's log entry. */
export class CallErrorWithLog extends CallError {
  readonly log: RunRequestLog | null;
  constructor(error: RunError, status: number | null, log: RunRequestLog | null) {
    super(error, status);
    this.log = log;
  }
}

/** An ApiError from the builder (bad input, needs a key, wrong host) as a run error. */
export function runErrorOf(error: unknown, apiName: string): RunError {
  if (error instanceof CallError) return error.error;
  if (error instanceof ApiError) return { code: error.code, text: error.message };
  if (error instanceof GuardError) return guardErrorText(apiName, error);
  if (error instanceof CapError) return { code: error.code, text: error.message };
  console.error('[runner] unexpected error', error);
  return { code: 'internal', text: 'Something went wrong on our side. Try again.' };
}
