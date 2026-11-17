import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SpecOp } from '@/contracts/setup';
import hackerNews from '../seed/specs/hacker-news.json';
import type { ChatInput, ProviderEvent } from '../ai/types';
import { db, newId } from '../db';
import { createTestDb } from '../db/testing';
import { resetRateLimits } from '../http/rate-limit';
import type { GuardedResponse } from '../net/guarded-fetch';
import { resetCallCounts, useTransportForTests, type Transport } from '../runner/call';
import { seal } from '../secrets';
import * as auth from '../services/auth';
import { ctxFor, type Ctx } from '../services/context';
import * as projects from '../services/projects';
import * as setups from '../services/setups';
import { runSetup } from './loop';
import { applyOp, emptyDraft, SpecOpError, type Draft } from './spec-ops';

const t = await createTestDb();

// The spec operations that rebuild the Hacker News seed spec, in the order an AI would send them.
const hn = hackerNews as unknown as {
  api: Record<string, unknown>;
  endpoints: Record<string, unknown>[];
  channels: { id: string; title: string; controls: Record<string, unknown>[] }[];
  notes: Record<string, unknown>[];
  run: Record<string, unknown>;
};
const setApi = { op: 'set_api', api: hn.api } as SpecOp;
const addSearch = { op: 'add_endpoint', endpoint: hn.endpoints[0] } as SpecOp;
const addChannel = (i: number) =>
  ({
    op: 'add_channel',
    channel: { id: hn.channels[i].id, title: hn.channels[i].title },
    planned: hn.channels[i].controls.map((c) => c.label),
  }) as SpecOp;
const addControl = (ci: number, ki: number, over: Record<string, unknown> = {}) =>
  ({
    op: 'add_control',
    channelId: hn.channels[ci].id,
    control: { ...hn.channels[ci].controls[ki], ...over },
  }) as SpecOp;
const setRun = { op: 'set_run', run: hn.run } as SpecOp;
const allOps: SpecOp[] = [
  setApi,
  addSearch,
  addChannel(0),
  addControl(0, 0),
  addControl(0, 1),
  addChannel(1),
  addControl(1, 0),
  addControl(1, 1),
  addControl(1, 2),
  ...hn.notes.map((note) => ({ op: 'add_note', note }) as SpecOp),
  setRun,
];

function applyAll(ops: SpecOp[], pinnedHost: string | null = null): Draft {
  let draft = emptyDraft();
  for (const op of ops) draft = applyOp(draft, op, { pinnedHost }).draft;
  return draft;
}

describe('spec operations', () => {
  it('build a spec step by step, saying what’s still missing until it passes', () => {
    const first = applyOp(emptyDraft(), setApi, { pinnedHost: null });
    expect(first.result.valid).toBe(false);
    expect(first.result.todo.map((p) => p.message)).toEqual(
      expect.arrayContaining([
        'Add at least one endpoint.',
        'Add at least one channel.',
        'Call set_run to say what the Run button does.',
      ]),
    );
    expect(first.events).toEqual([{ kind: 'log', text: 'Set the API to Hacker News Search at hn.algolia.com' }]);

    const channel = applyOp(applyAll([setApi, addSearch]), addChannel(0), { pinnedHost: null });
    expect(channel.planned).toEqual({ channelId: 'what', labels: ['Search for', 'Post type'] });

    const draft = applyAll(allOps);
    const done = applyOp(draft, { op: 'finish' }, { pinnedHost: null });
    expect(done.result).toMatchObject({ ok: true, valid: true });
    expect(done.spec).toEqual(hackerNews);
  });

  it('reject a bad operation with messages an AI can fix, and leave the draft as it was', () => {
    const draft = applyAll([setApi, addSearch, addChannel(0)]);
    const before = JSON.stringify(draft);
    let error: SpecOpError | null = null;
    try {
      applyOp(draft, addControl(0, 0, { endpointId: 'serch' }), { pinnedHost: null });
    } catch (e) {
      error = e as SpecOpError;
    }
    expect(error).toBeInstanceOf(SpecOpError);
    expect(error!.problems[0].path).toBe('channels.0.controls.0.endpointId');
    expect(error!.problems[0].message).toContain('"serch", which doesn\'t exist. Use one of: "search"');
    expect(JSON.stringify(draft)).toBe(before);

    expect(() =>
      applyOp(draft, addControl(0, 1, { options: [{ value: 'story', label: 'Stories' }] }), { pinnedHost: null }),
    ).toThrow(SpecOpError);
    expect(() =>
      applyOp(
        draft,
        {
          op: 'add_endpoint',
          endpoint: { ...hn.endpoints[0], id: 'paid', cost: { perCall: 1, perRecord: 0, unit: 'credits' } },
        } as SpecOp,
        {
          pinnedHost: null,
        },
      ),
    ).toThrow(/needs a fix/);
    expect(() => applyOp(draft, addSearch, { pinnedHost: null })).toThrow('already exists');
    expect(() => applyOp(draft, { op: 'finish' }, { pinnedHost: null })).toThrow('doesn’t pass the contract yet');
  });

  it('keep the base URL on the host a key is saved for, whatever a page says', () => {
    const evil = { op: 'set_api', api: { ...hn.api, baseUrl: 'https://evil.example.com/api/v1' } } as SpecOp;
    expect(() => applyOp(emptyDraft(), evil, { pinnedHost: 'hn.algolia.com' })).toThrow(/fixed to hn\.algolia\.com/);
    expect(applyOp(emptyDraft(), setApi, { pinnedHost: 'hn.algolia.com' }).draft.api?.baseUrl).toBe(
      'https://hn.algolia.com/api/v1',
    );
  });

  it('drop a channel when its last control goes', () => {
    const draft = applyAll(allOps);
    const one = applyOp(draft, { op: 'remove_control', id: 'query' }, { pinnedHost: null }).draft;
    expect(one.channels[0].controls.map((c) => c.id)).toEqual(['type']);
    const none = applyOp(one, { op: 'remove_control', id: 'type' }, { pinnedHost: null }).draft;
    expect(none.channels.map((c) => c.id)).toEqual(['filters']);
  });
});

// ---------- The built-in loop against a scripted fake AI ----------

let nadia: Ctx;
let answer: (url: string) => GuardedResponse = () => respond(404, {});

function respond(status: number, data: unknown): GuardedResponse {
  const text = JSON.stringify(data);
  return {
    ok: status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    url: 'https://hn.algolia.com/api/v1/search',
    redirects: 0,
    ms: 4,
    bytes: Buffer.from(text),
    text: () => text,
    json: () => JSON.parse(text),
  };
}
const calls: string[] = [];
const transport: Transport = async (input) => {
  calls.push(String(input));
  return answer(String(input));
};

type Turn = { text?: string; calls?: { name: string; args: unknown }[] };

/** A fake provider that plays one turn per call, and records what it was sent. */
function scripted(turns: Turn[]) {
  const seen: ChatInput[] = [];
  const stream = (input: ChatInput) =>
    (async function* (): AsyncGenerator<ProviderEvent> {
      seen.push(structuredClone({ ...input, signal: undefined }) as unknown as ChatInput);
      const turn = turns[seen.length - 1] ?? { text: 'I am out of ideas.' };
      yield { type: 'usage', inputTokens: 100, outputTokens: 0 };
      if (turn.text) yield { type: 'text', delta: turn.text };
      for (const [i, call] of (turn.calls ?? []).entries())
        yield { type: 'tool_call', id: `call_${seen.length}_${i}`, name: call.name, args: call.args };
      yield { type: 'usage', inputTokens: 100, outputTokens: 20 };
      yield { type: 'done', stop: turn.calls?.length ? 'tool_calls' : 'end' };
    })();
  return { stream, seen };
}

const asCall = (op: SpecOp) => {
  const { op: name, ...args } = op;
  return { name, args };
};

async function newBuiltinSetup(name: string, over: Record<string, unknown> = {}) {
  return setups.start(nadia, {
    name,
    apiName: 'Hacker News Search',
    apiSlug: 'hacker-news',
    docsUrl: 'https://hn.algolia.com/api',
    brief: 'AI launch posts with at least 50 points in the last day',
    via: 'builtin',
    ...over,
  });
}

const kinds = async (setupId: string) => (await setups.events(nadia, setupId)).map((e) => e.kind);

beforeAll(async () => {
  resetRateLimits();
  resetCallCounts();
  useTransportForTests(transport, async () => {});
  // start() would launch the real loop; these tests run it themselves with a fake AI.
  setups.setLauncher(() => {});
  const a = await auth.signUp(
    { email: 'nadia@brightfield.com.au', password: 'field-notes-2026!' },
    {
      ip: '203.0.113.30',
      userAgent: 'vitest',
    },
  );
  await db.updateTable('users').set({ email_checked_at: Date.now() }).execute();
  nadia = ctxFor(await db.selectFrom('users').selectAll().where('id', '=', a.user.id).executeTakeFirstOrThrow());
  await db
    .insertInto('ai_keys')
    .values({
      id: newId(),
      user_id: nadia.user.id,
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      label: '',
      secret: seal('sk-ant-api03-fake-key-for-tests'),
      last4: 'ests',
      position: 0,
      last_test_at: null,
      last_test_ok: null,
      last_test_ms: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    })
    .execute();
});

afterAll(async () => {
  useTransportForTests(null);
  await t.close();
});

beforeEach(() => {
  resetRateLimits();
  calls.length = 0;
  answer = () =>
    respond(200, {
      hits: [
        { objectID: '1', title: 'Launch: an AI tool', points: 120 },
        { objectID: '2', title: 'Show HN: another', points: 64 },
      ],
      nbHits: 2,
    });
});

describe('the built-in setup loop', () => {
  it('reads, builds, tests and finishes, fixing a mistake on the way', async () => {
    const { projectId, setupId } = await newBuiltinSetup('AI launch posts');
    const fake = scripted([
      { text: 'Reading done. Setting up the search.', calls: [setApi, addSearch].map(asCall) },
      { calls: [addChannel(0), addControl(0, 0), addControl(0, 1, { endpointId: 'serch' })].map(asCall) },
      {
        calls: [
          addControl(0, 1),
          addChannel(1),
          addControl(1, 0),
          addControl(1, 1),
          addControl(1, 2),
          ...hn.notes.map((note) => ({ op: 'add_note', note }) as SpecOp),
          setRun,
        ].map(asCall),
      },
      { calls: [{ name: 'test_call', args: { endpointId: 'search' } }] },
      { calls: [{ name: 'finish', args: { summary: 'Search for launch posts by points and date.' } }] },
    ]);
    await runSetup(setupId, nadia.user.id, { stream: fake.stream, sleep: async () => {} });

    const view = await setups.view(nadia, setupId);
    expect(view.setup).toMatchObject({ status: 'done', who: 'Claude', model: 'claude-sonnet-5-5', error: null });
    expect(view.channels.map((c) => [c.title, c.controls.length, c.waiting.length])).toEqual([
      ['What to find', 2, 0],
      ['Filters', 3, 0],
    ]);
    expect(view.test).toMatchObject({ ok: true, records: 2 });
    const project = await projects.get(nadia, projectId);
    expect(project.status).toBe('ready');
    expect(project.spec).toEqual(hackerNews);

    // The bad control came back to the AI as a plain error it fixed in the next turn.
    const thirdTurn = fake.seen[2].messages.at(-1)!;
    const errorResult = thirdTurn.parts.find((p) => p.type === 'tool_result' && p.isError);
    expect(errorResult && 'content' in errorResult ? errorResult.content : '').toContain("doesn't exist");

    const seen = await kinds(setupId);
    expect(seen.filter((k) => k === 'control')).toHaveLength(5);
    expect(seen).toEqual(expect.arrayContaining(['endpoint', 'note', 'test', 'done']));
    const steps = (await setups.events(nadia, setupId)).filter((e) => e.kind === 'step');
    expect(steps.map((s) => (s.kind === 'step' ? `${s.step}:${s.status}` : ''))).toEqual([
      '1:running',
      '1:done',
      '2:running',
      '2:done',
      '3:running',
      '3:done',
      '4:running',
      '4:done',
      '4:done',
    ]);
    // Every provider call is metered, and the test call went to the API's own host only.
    const usage = await db.selectFrom('ai_usage').select(['purpose']).where('user_id', '=', nadia.user.id).execute();
    expect(usage.filter((u) => u.purpose === 'setup')).toHaveLength(5);
    expect(calls.every((u) => u.startsWith('https://hn.algolia.com/api/v1/search'))).toBe(true);
    const versions = await db
      .selectFrom('spec_versions')
      .select('version')
      .where('project_id', '=', projectId)
      .execute();
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  it('won’t finish before a test call passes', async () => {
    const { setupId } = await newBuiltinSetup('Untested');
    const fake = scripted([
      { calls: allOps.map(asCall) },
      { calls: [{ name: 'finish', args: {} }] },
      { text: 'I can’t test it.' },
      { text: 'Still can’t.' },
    ]);
    await runSetup(setupId, nadia.user.id, { stream: fake.stream });
    const finishResult = fake.seen[2].messages.at(-1)!.parts[0];
    expect('content' in finishResult ? finishResult.content : '').toContain('Run test_call on a free endpoint first');
    const view = await setups.view(nadia, setupId);
    expect(view.setup.status).toBe('failed');
    expect(view.setup.error).toBe('The AI stopped before the setup was done: Still can’t.');
  });

  it('keeps the host a key is saved for when a page tells the AI to change it', async () => {
    const { projectId, setupId } = await newBuiltinSetup('Pinned host', {
      apiKey: { host: 'hn.algolia.com', secret: 'not-really-needed-0001' },
    });
    const evil = { op: 'set_api', api: { ...hn.api, baseUrl: 'https://evil.example.com/api/v1' } } as SpecOp;
    const fake = scripted([
      { text: 'The docs say to use evil.example.com.', calls: [asCall(evil)] },
      { text: 'Stopping.' },
      { text: 'Stopped.' },
    ]);
    await runSetup(setupId, nadia.user.id, { stream: fake.stream });
    const result = fake.seen[1].messages.at(-1)!.parts[0];
    expect('content' in result && result.isError).toBe(true);
    expect('content' in result ? result.content : '').toContain('fixed to hn.algolia.com');
    const row = await db.selectFrom('setups').select('draft').where('id', '=', setupId).executeTakeFirstOrThrow();
    expect(JSON.parse(row.draft!).api).toBeUndefined();
    expect((await projects.get(nadia, projectId)).spec).toBeNull();
  });

  it('stops when the person cancels, and at the tool-call limit', async () => {
    const first = await newBuiltinSetup('Cancelled');
    const cancelling = scripted([{ calls: [setApi].map(asCall) }]);
    const stream = (input: ChatInput) => {
      void setups.cancel(nadia, first.setupId);
      return cancelling.stream(input);
    };
    await runSetup(first.setupId, nadia.user.id, { stream });
    const cancelled = await setups.view(nadia, first.setupId);
    expect(cancelled.setup.status).toBe('cancelled');
    expect(cancelled.project.status).toBe('failed');

    const second = await newBuiltinSetup('Too many calls');
    const busy = scripted([{ calls: allOps.map(asCall) }]);
    await runSetup(second.setupId, nadia.user.id, { stream: busy.stream, limits: { toolCalls: 3 } });
    const limited = await setups.view(nadia, second.setupId);
    expect(limited.setup.status).toBe('failed');
    expect(limited.setup.error).toContain('used its 3 tool calls');
  });

  it('starts a change setup from the current spec and keeps its ids', async () => {
    const { projectId, setupId: firstId } = await newBuiltinSetup('Change me');
    await setups.cancel(nadia, firstId);
    await projects.saveSpec(nadia, projectId, hackerNews, { author: 'ai' });
    const { setupId } = await setups.change(nadia, projectId, { brief: 'Drop the date filter' });
    const fake = scripted([
      { calls: [{ name: 'remove_control', args: { id: 'since' } }] },
      { calls: [{ name: 'test_call', args: { endpointId: 'search' } }] },
      { calls: [{ name: 'finish', args: {} }] },
    ]);
    await runSetup(setupId, nadia.user.id, { stream: fake.stream });
    const firstMessage = fake.seen[0].messages[0].parts[0];
    expect('text' in firstMessage ? firstMessage.text : '').toContain('Drop the date filter');
    expect('text' in firstMessage ? firstMessage.text : '').toContain('"id":"points"');
    const project = await projects.get(nadia, projectId);
    expect(project.status).toBe('ready');
    expect(project.spec!.channels[1].controls.map((c) => c.id)).toEqual(['points', 'take']);
  });
});
