// Adapted from dl-cms/cms/src/server/ai/fallback.ts (one level: the person's keys in order, no thinking levels)
import type { AiErrorKind, AiProvider } from '@/contracts/ai';
import { cutOffUsage } from './meter';
import { streamChat } from './providers';
import type { SseOptions } from './sse';
import { AiCallError, NO_CREDIT_PATTERN, type ChatInput, type ProviderEvent } from './types';

/**
 * The walk over the person's keys, tried from the top:
 * - a bad key, a rate limit or no credit moves to the next key;
 * - an outage, a timeout or an unreadable answer skips the rest of that provider's keys;
 * - a rejected request moves on only to another provider or model;
 * - each key gets up to 3 tries with backoff on temporary errors, but a rate limit with another key waiting
 *   moves on at once;
 * - once text or a tool call has gone out, a failure ends the call (no fallback).
 * A key that says the output cap is the problem gets one more try without it. A call that's cut off is still
 * charged (see meter.ts).
 */
export type Credential = {
  keyId: string;
  provider: AiProvider;
  model: string;
  apiKey: string;
  label: string;
};

export type PublicCredential = Omit<Credential, 'apiKey'>;

/** One provider call, failed or not: what ai_usage stores. */
export type Attempt = {
  credential: PublicCredential;
  ok: boolean;
  errorKind: AiErrorKind | null;
  message: string | null;
  inputTokens: number;
  outputTokens: number;
};

export type WalkEvent = ProviderEvent | { type: 'credential'; index: number; credential: PublicCredential };

export type StreamFn = (input: ChatInput, sse: Partial<SseOptions>) => AsyncGenerator<ProviderEvent>;

export type WalkOptions = {
  signal: AbortSignal;
  onAttempt?: (attempt: Attempt) => unknown;
  /** Where to start: the key that answered the previous step of the same run. */
  startAt?: number;
  maxTries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** The provider call (tests pass a fake). */
  stream?: StreamFn;
  sse?: Partial<SseOptions>;
};

const MAX_TRIES = 3;
const MAX_DELAY_MS = 8_000;
const RETRYABLE = new Set([408, 409, 425, 429, 529]);
/** A rejection that names the output limit: "max_tokens is too large", "the maximum context length is 8192 tokens". */
const OUTPUT_CAP_PATTERN = /max[_ -]?(completion[_ -]?|output[_ -]?)?tokens|maximum.{0,40}tokens/i;

export const publicCredential = (credential: Credential): PublicCredential => {
  const { apiKey, ...rest } = credential;
  void apiKey;
  return rest;
};

/** A key problem (bad key, rate limit, no credit): any other key may work. */
const isKeyProblem = (e: AiCallError) => e.kind === 'auth' || e.kind === 'rate_limit';

/** Whether `next` could succeed where `current` failed with `error`. */
export function nextMayHelp(
  error: AiCallError,
  current: Pick<Credential, 'provider' | 'model'>,
  next: Pick<Credential, 'provider' | 'model'>,
): boolean {
  if (isKeyProblem(error)) return true;
  if (next.provider !== current.provider) return true;
  return error.kind === 'bad_request' && next.model !== current.model;
}

function retryable(e: AiCallError): boolean {
  if (e.status !== undefined) return RETRYABLE.has(e.status) || e.status >= 500;
  // Failures without a status: network, timeouts and errors reported inside the stream.
  return e.kind === 'network' || e.kind === 'timeout' || e.kind === 'unavailable' || e.kind === 'rate_limit';
}

export function backoffMs(attempt: number): number {
  return Math.min(MAX_DELAY_MS, 500 * 2 ** Math.max(0, attempt - 1)) + Math.floor(Math.random() * 250);
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function* walkChain(
  chain: Credential[],
  request: Pick<ChatInput, 'system' | 'messages' | 'tools' | 'maxOutput'>,
  opts: WalkOptions,
): AsyncGenerator<WalkEvent> {
  if (!chain.length) throw new AiCallError('auth', { message: 'No AI key is set up.' });
  const stream = opts.stream ?? streamChat;
  const sleep = opts.sleep ?? sleepFor;
  const maxTries = opts.maxTries ?? MAX_TRIES;
  const findNext = (from: number, error: AiCallError) =>
    chain.findIndex((c, j) => j > from && nextMayHelp(error, chain[from], c));

  let i = Math.min(Math.max(0, opts.startAt ?? 0), chain.length - 1);
  while (true) {
    const credential = chain[i];
    const pub = publicCredential(credential);
    let lastError: AiCallError | null = null;
    let maxOutput = request.maxOutput;
    for (let attempt = 1; attempt <= maxTries; attempt++) {
      const held: ProviderEvent[] = [];
      let committed = false;
      let usage = { inputTokens: 0, outputTokens: 0 };
      let answering = false;
      let outputBytes = 0;
      const started = Date.now();
      /** `cutOff`: the provider took the call and its usage report may never have come. */
      const report = (ok: boolean, error: AiCallError | null, cutOff: boolean) =>
        opts.onAttempt?.({
          credential: pub,
          ok,
          errorKind: error?.kind ?? null,
          message: error?.message ?? null,
          ...(cutOff ? cutOffUsage(request, usage, outputBytes, Date.now() - started) : usage),
        });
      try {
        const events = stream(
          {
            ...request,
            maxOutput,
            provider: credential.provider,
            model: credential.model,
            apiKey: credential.apiKey,
            signal: opts.signal,
          },
          opts.sse ?? {},
        );
        for await (const event of events) {
          answering = true;
          if (event.type === 'progress') {
            outputBytes += event.bytes;
            continue;
          }
          if (event.type === 'usage') usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
          else if (event.type === 'text' || event.type === 'thinking') outputBytes += Buffer.byteLength(event.delta);
          if (committed) {
            yield event;
          } else if (event.type === 'text' || event.type === 'tool_call') {
            committed = true;
            yield { type: 'credential', index: i, credential: pub };
            yield* held;
            yield event;
          } else {
            held.push(event);
          }
        }
        if (!committed) {
          yield { type: 'credential', index: i, credential: pub };
          yield* held;
        }
        // A provider that reports no usage at all still costs something.
        await report(true, null, !usage.inputTokens && !usage.outputTokens);
        return;
      } catch (thrown) {
        if (opts.signal.aborted) {
          // Stopped by the person: the call counts, without an error, and the provider's report won't come.
          await report(committed, null, true);
          throw thrown;
        }
        const error =
          thrown instanceof AiCallError
            ? thrown
            : new AiCallError('invalid_response', { detail: String(thrown).slice(0, 300) });
        await report(false, error, answering);
        if (committed) {
          error.committed = true;
          throw error;
        }
        lastError = error;
        if (error.kind === 'bad_request' && maxOutput && OUTPUT_CAP_PATTERN.test(error.detail ?? '')) {
          maxOutput = undefined;
          attempt--;
          continue;
        }
        if (!retryable(error) || attempt === maxTries) break;
        // Waiting doesn't bring credit back; with another key waiting, neither is a rate limit worth waiting out.
        if (error.kind === 'rate_limit' && (findNext(i, error) >= 0 || NO_CREDIT_PATTERN.test(error.detail ?? '')))
          break;
        await sleep(error.retryAfterMs ?? backoffMs(attempt));
      }
    }
    const next = findNext(i, lastError!);
    if (next < 0) throw lastError!;
    console.warn(
      `[ai] ${credential.provider} key ${i + 1} of ${chain.length} failed (${lastError!.kind}); trying key ${next + 1}`,
    );
    i = next;
  }
}
