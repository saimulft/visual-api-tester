// Adapted from dl-cms/cms/src/server/ai/fallback.test.ts (one level, no thinking levels)
import { describe, expect, it, vi } from 'vitest';
import type { AiErrorKind } from '@/contracts/ai';
import { walkChain, type Attempt, type Credential, type WalkEvent } from './fallback';
import { AiCallError, type ChatInput, type ProviderEvent } from './types';

/** What a fake key does on each try: answer, fail before any output, or fail after some text. */
type Step =
  | { ok: string; tokens?: [number, number] }
  | { fail: AiErrorKind; status?: number; retryAfterMs?: number; detail?: string; afterText?: string };

function fakeStream(script: Record<string, Step[]>) {
  const calls: string[] = [];
  const stream = (input: ChatInput) =>
    (async function* (): AsyncGenerator<ProviderEvent> {
      calls.push(input.apiKey);
      const step = script[input.apiKey]?.shift() ?? { fail: 'unavailable' as AiErrorKind };
      if ('ok' in step) {
        yield { type: 'native', block: { type: 'thinking' } };
        yield { type: 'text', delta: step.ok };
        yield { type: 'usage', inputTokens: step.tokens?.[0] ?? 10, outputTokens: step.tokens?.[1] ?? 2 };
        yield { type: 'done', stop: 'end' };
        return;
      }
      yield { type: 'usage', inputTokens: 7, outputTokens: 0 };
      if (step.afterText) yield { type: 'text', delta: step.afterText };
      throw new AiCallError(step.fail, { status: step.status, retryAfterMs: step.retryAfterMs, detail: step.detail });
    })();
  return { stream, calls };
}

const key = (apiKey: string, over: Partial<Credential> = {}): Credential => ({
  keyId: `id-${apiKey}`,
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  apiKey,
  label: apiKey,
  ...over,
});

async function walk(chain: Credential[], script: Record<string, Step[]>, opts: { startAt?: number } = {}) {
  const { stream, calls } = fakeStream(script);
  const attempts: Attempt[] = [];
  const sleep = vi.fn(async () => {});
  const events: WalkEvent[] = [];
  let error: AiCallError | null = null;
  try {
    for await (const event of walkChain(
      chain,
      { system: 'S', messages: [], tools: [] },
      {
        signal: new AbortController().signal,
        startAt: opts.startAt,
        onAttempt: (a) => attempts.push(a),
        sleep,
        stream,
      },
    ))
      events.push(event);
  } catch (e) {
    error = e as AiCallError;
  }
  const text = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
  const used = events.find((e) => e.type === 'credential');
  return { events, attempts, calls, sleep, error, text, used };
}

const summary = (attempts: Attempt[]) => attempts.map((a) => `${a.credential.label}:${a.ok ? 'ok' : a.errorKind}`);

describe('the fallback walk over the person’s keys', () => {
  it('moves past bad keys to the one that works, reporting every attempt', async () => {
    const r = await walk([key('fake-1'), key('fake-2'), key('real')], {
      'fake-1': [{ fail: 'auth', status: 401 }],
      'fake-2': [{ fail: 'auth', status: 401 }],
      real: [{ ok: 'Hello', tokens: [120, 30] }],
    });
    expect(r.error).toBeNull();
    expect(r.text).toBe('Hello');
    expect(summary(r.attempts)).toEqual(['fake-1:auth', 'fake-2:auth', 'real:ok']);
    expect(r.attempts[2]).toMatchObject({ inputTokens: 120, outputTokens: 30 });
    expect(r.used).toMatchObject({ type: 'credential', index: 2, credential: { label: 'real' } });
    expect(JSON.stringify(r.events)).not.toContain('"apiKey"');
    expect(r.sleep).not.toHaveBeenCalled();
    // The held events (thinking) come out after the credential, before the text.
    expect(r.events.map((e) => e.type).slice(0, 3)).toEqual(['credential', 'native', 'text']);
  });

  it('doesn’t wait out a rate limit when another key is left', async () => {
    const r = await walk([key('a'), key('b')], {
      a: [{ fail: 'rate_limit', status: 429, retryAfterMs: 4000 }],
      b: [{ ok: 'Hi' }],
    });
    expect(summary(r.attempts)).toEqual(['a:rate_limit', 'b:ok']);
    expect(r.sleep).not.toHaveBeenCalled();
  });

  it('retries a rate limit three times on the last key, honouring Retry-After', async () => {
    const limited = { fail: 'rate_limit' as const, status: 429, retryAfterMs: 2000 };
    const r = await walk([key('only')], { only: [limited, limited, limited] });
    expect(summary(r.attempts)).toEqual(['only:rate_limit', 'only:rate_limit', 'only:rate_limit']);
    expect(r.sleep.mock.calls).toEqual([[2000], [2000]]);
    expect(r.error?.kind).toBe('rate_limit');
  });

  it('doesn’t retry when the credit is gone', async () => {
    const r = await walk([key('only')], { only: [{ fail: 'rate_limit', status: 429, detail: 'insufficient_quota' }] });
    expect(r.attempts).toHaveLength(1);
    expect(r.sleep).not.toHaveBeenCalled();
  });

  it('backs off on an outage, then skips the provider’s other keys for another provider', async () => {
    const down = { fail: 'unavailable' as const, status: 503 };
    const r = await walk([key('a-1'), key('a-2'), key('openai', { provider: 'openai', model: 'gpt-6-luna' })], {
      'a-1': [down, down, down],
      openai: [{ ok: 'From OpenAI' }],
    });
    expect(summary(r.attempts)).toEqual(['a-1:unavailable', 'a-1:unavailable', 'a-1:unavailable', 'openai:ok']);
    expect(r.calls).not.toContain('a-2');
    const [first, second] = r.sleep.mock.calls.map((c) => (c as unknown as [number])[0]);
    expect(first).toBeGreaterThanOrEqual(500);
    expect(first).toBeLessThan(750);
    expect(second).toBeGreaterThanOrEqual(1000);
    expect(second).toBeLessThan(1250);
  });

  it('treats a timeout and a network failure like an outage', async () => {
    for (const kind of ['timeout', 'network'] as const) {
      const r = await walk([key('a'), key('b'), key('c', { provider: 'gemini', model: 'gemini-3.8-flash' })], {
        a: [{ fail: kind }, { fail: kind }, { fail: kind }],
        c: [{ ok: 'ok' }],
      });
      expect(summary(r.attempts)).toEqual([`a:${kind}`, `a:${kind}`, `a:${kind}`, 'c:ok']);
    }
  });

  it('moves a rejected request on only to another model or provider', async () => {
    const r = await walk([key('a'), key('b'), key('c', { model: 'claude-opus-5-5' })], {
      a: [{ fail: 'bad_request', status: 400 }],
      c: [{ ok: 'ok' }],
    });
    expect(summary(r.attempts)).toEqual(['a:bad_request', 'c:ok']);
    const none = await walk([key('a'), key('b')], { a: [{ fail: 'bad_request', status: 400 }] });
    expect(none.error?.kind).toBe('bad_request');
    expect(none.calls).toEqual(['a']);
  });

  it('drops an output cap only when the provider says it’s the problem', async () => {
    const seen: string[] = [];
    const CAP = "max_tokens is too large: 5000. This model's maximum value is 4096.";
    const rejecting = (refusal: (input: ChatInput) => string | null) => (input: ChatInput) =>
      (async function* (): AsyncGenerator<ProviderEvent> {
        seen.push(String(input.maxOutput ?? '-'));
        const detail = refusal(input);
        if (detail) throw new AiCallError('bad_request', { status: 400, detail });
        yield { type: 'text', delta: 'ok' };
        yield { type: 'done', stop: 'end' };
      })();
    const run = async (stream: ReturnType<typeof rejecting>) => {
      seen.length = 0;
      for await (const e of walkChain(
        [key('a')],
        { system: 'S', messages: [], tools: [], maxOutput: 5_000 },
        { signal: new AbortController().signal, stream, sleep: async () => {} },
      ))
        void e;
    };
    await run(rejecting((input) => (input.maxOutput ? CAP : null)));
    expect(seen).toEqual(['5000', '-']);
    await expect(run(rejecting(() => 'Something else entirely.'))).rejects.toMatchObject({ kind: 'bad_request' });
    expect(seen).toEqual(['5000']);
  });

  it('charges a call cut off before its usage report', async () => {
    const request = {
      system: 'x'.repeat(3_500),
      messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'y'.repeat(3_500) }] }],
      tools: [],
    };
    const attempts: Attempt[] = [];
    try {
      for await (const e of walkChain([key('a')], request, {
        signal: new AbortController().signal,
        maxTries: 1,
        sleep: async () => {},
        onAttempt: (a) => attempts.push(a),
        stream: () =>
          (async function* (): AsyncGenerator<ProviderEvent> {
            yield { type: 'progress', bytes: 700 };
            throw new AiCallError('network');
          })(),
      }))
        void e;
    } catch {
      /* expected */
    }
    expect(attempts[0].inputTokens).toBeGreaterThan(3_000);
    expect(attempts[0].outputTokens).toBeGreaterThanOrEqual(200);
  });

  it('never falls back once text went out', async () => {
    const r = await walk([key('a'), key('b')], {
      a: [{ fail: 'unavailable', afterText: 'Partial answer' }],
      b: [{ ok: 'should not run' }],
    });
    expect(r.text).toBe('Partial answer');
    expect(r.error?.committed).toBe(true);
    expect(r.calls).toEqual(['a']);
  });

  it('stops at once when the person stops', async () => {
    const controller = new AbortController();
    controller.abort();
    const attempts: Attempt[] = [];
    const run = walkChain(
      [key('a'), key('b')],
      { system: '', messages: [], tools: [] },
      {
        signal: controller.signal,
        onAttempt: (a) => attempts.push(a),
        stream: () =>
          (async function* (): AsyncGenerator<ProviderEvent> {
            throw new DOMException('aborted', 'AbortError');
          })(),
      },
    );
    await expect(run.next()).rejects.toThrow('aborted');
    expect(summary(attempts)).toEqual(['a:null']);
  });

  it('starts from the key that answered the previous step', async () => {
    const r = await walk([key('a'), key('b')], { b: [{ ok: 'ok' }] }, { startAt: 1 });
    expect(r.calls).toEqual(['b']);
  });

  it('fails clearly with no keys', async () => {
    const r = await walk([], {});
    expect(r.error).toBeInstanceOf(AiCallError);
    expect(r.error?.message).toBe('No AI key is set up.');
  });
});
