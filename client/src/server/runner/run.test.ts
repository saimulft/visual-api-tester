import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import coresignal from '../seed/specs/coresignal.json';
import hackerNews from '../seed/specs/hacker-news.json';
import { db } from '../db';
import { createTestDb } from '../db/testing';
import { resetRateLimits } from '../http/rate-limit';
import type { GuardedResponse } from '../net/guarded-fetch';
import { GuardError } from '../net/guarded-fetch';
import * as apiKeys from '../services/api-keys';
import * as auth from '../services/auth';
import { ctxFor, type Ctx } from '../services/context';
import * as projects from '../services/projects';
import * as datasets from '../services/datasets';
import * as runs from '../services/runs';
import { resetCallCounts, skewClockForTests, takeSlot, useTransportForTests, type Transport } from './call';
import { previewRun, runProject, testCall } from './run';

const t = await createTestDb();

type Seen = { url: string; method: string; headers: Record<string, string>; body: string | null };
let seen: Seen[] = [];
let answer: (req: Seen) => GuardedResponse | Promise<GuardedResponse> = () => respond(404, {});
const slept: number[] = [];
const fakeSleep = async (ms: number) => {
  slept.push(ms);
  skewClockForTests(ms);
};

function respond(
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
  url = 'https://x.test/',
): GuardedResponse {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const bytes = Buffer.from(text);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    url,
    redirects: 0,
    ms: 5,
    bytes,
    text: () => text,
    json: () => JSON.parse(text),
  };
}

const fake: Transport = async (input, init = {}) => {
  const req = {
    url: String(input),
    method: init.method ?? 'GET',
    headers: init.headers ?? {},
    body: typeof init.body === 'string' ? init.body : null,
  };
  seen.push(req);
  return answer(req);
};

let nadia: Ctx;
let other: Ctx;
let hnId: string;
let csId: string;
let keyId: string;

beforeAll(async () => {
  resetRateLimits();
  useTransportForTests(fake, fakeSleep);
  const meta = { ip: '203.0.113.20', userAgent: 'vitest' };
  const a = await auth.signUp({ email: 'nadia@brightfield.com.au', password: 'field-notes-2026!' }, meta);
  const b = await auth.signUp({ email: 'sam@tidepool.io', password: 'field-notes-2026!' }, meta);
  await db.updateTable('users').set({ email_checked_at: Date.now() }).execute();
  const load = async (id: string) =>
    ctxFor(await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
  nadia = await load(a.user.id);
  other = await load(b.user.id);

  const hn = await projects.create(nadia, { name: 'AI launch posts', apiName: 'Hacker News Search' });
  await projects.saveSpec(nadia, hn.id, hackerNews, { author: 'ai' });
  hnId = hn.id;
  const key = await apiKeys.create(nadia, {
    apiSlug: 'coresignal',
    apiName: 'CoreSignal',
    host: 'api.coresignal.com',
    secret: 'cs-live-abcdef7Qk1',
  });
  keyId = key.id;
  const cs = await projects.create(nadia, {
    name: 'AU software companies',
    apiName: 'CoreSignal',
    apiKeyId: key.id,
    creditLimit: 1000,
  });
  await projects.saveSpec(nadia, cs.id, coresignal, { author: 'ai' });
  csId = cs.id;
});

afterAll(async () => {
  useTransportForTests(null);
  await t.close();
});

beforeEach(async () => {
  await db.deleteFrom('runs').execute();
  seen = [];
  slept.length = 0;
  resetCallCounts();
});

const hits = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    objectID: String(from + i),
    title: `Post ${from + i}`,
    points: 100 + i,
    author: 'pg',
  }));

/** A fake CoreSignal: ids from the search, a record per collect, credits in a header. */
function coresignalApi(opts: { total?: number; refuse?: boolean } = {}) {
  let credits = 11480;
  return (req: Seen) => {
    if (opts.refuse) return respond(401, { message: 'Invalid API key' });
    if (req.headers.apikey !== 'cs-live-abcdef7Qk1') return respond(401, { message: 'no key' });
    const url = new URL(req.url);
    if (url.pathname.endsWith('/search/es_dsl')) {
      const size = Number(url.searchParams.get('items_per_page') ?? 1000);
      const ids = Array.from({ length: size }, (_, i) => 81244310 + i);
      return respond(200, ids, { 'x-total-results': String(opts.total ?? 3412), 'x-next-page-after': '1' });
    }
    const id = Number(url.pathname.split('/').pop());
    credits -= 20;
    return respond(
      200,
      { id, company_name: `Company ${id}`, employees_count: 120, hq: { city: 'Sydney' } },
      {
        'x-credits-remaining': String(credits),
      },
    );
  };
}

describe('a single-endpoint run', () => {
  it('waits for a free slot when a run passes 60 calls a minute', async () => {
    answer = (req) => {
      const page = Number(new URL(req.url).searchParams.get('page') ?? 0);
      return respond(200, { hits: hits(10, page * 10), nbHits: 1000 });
    };
    for (let i = 0; i < 59; i++) await takeSlot(nadia.user.id, { wait: false });
    const result = await runProject(nadia, hnId, { values: { take: 30 }, trigger: 'manual' });
    expect(result.rows).toBe(30);
    expect(slept.some((ms) => ms > 50_000)).toBe(true);
  });

  it('runs Hacker News, takes the posts asked for and logs the request', async () => {
    answer = (req) => {
      const page = Number(new URL(req.url).searchParams.get('page') ?? 0);
      return respond(200, { hits: hits(50, page * 50), nbHits: 1284 });
    };
    const result = await runProject(nadia, hnId, { values: { take: 50 }, trigger: 'manual' });
    expect(result.status).toBe('ok');
    expect(result.rows).toBe(50);
    expect(result.matches).toBe(1284);
    expect(result.credits).toBe(0);
    expect(seen).toHaveLength(1);
    expect(result.requests[0].url).toContain('hitsPerPage=50');
    expect(result.requests[0].records).toBe(50);
    expect(result.sample[0]).toMatchObject({ objectID: '0', title: 'Post 0' });

    const listed = await runs.list(nadia, { projectId: hnId });
    expect(listed[0]).toMatchObject({ id: result.runId, status: 'ok', rows: 50, projectName: 'AI launch posts' });
    const project = await projects.get(nadia, hnId);
    expect(project.lastRunAt).not.toBeNull();
  });

  it('pages until it has enough, and drops a page that repeats the first', async () => {
    // An API whose pages start at 1: no page param and page=1 give the same page.
    answer = (req) => {
      const page = Number(new URL(req.url).searchParams.get('page') ?? 1);
      return respond(200, { hits: hits(10, (Math.max(page, 1) - 1) * 10), nbHits: 95 });
    };
    const result = await runProject(nadia, hnId, { values: { take: 20 }, trigger: 'manual' });
    // take 20 sets hitsPerPage=20, but this fake answers 10 a page.
    expect(result.rows).toBe(20);
    expect(seen.map((s) => new URL(s.url).searchParams.get('page'))).toEqual([null, '1', '2']);
    const ids = result.sample.map((r) => r.objectID);
    expect(new Set(ids).size).toBe(20);
  });

  it('retries a 429 after Retry-After, and says so', async () => {
    let calls = 0;
    answer = () =>
      ++calls === 1 ? respond(429, {}, { 'retry-after': '4' }) : respond(200, { hits: hits(10), nbHits: 10 });
    const result = await runProject(nadia, hnId, { values: { take: 10 }, trigger: 'manual' });
    expect(result.status).toBe('ok');
    expect(result.retries).toBe(1);
    expect(slept).toContain(4000);
    expect(result.error).toEqual({ code: 'rate_limited', text: 'Rate limited, retried after 4 s' });
  });

  it('gives up after 3 rate-limit retries', async () => {
    answer = () => respond(429, {}, { 'retry-after': '1' });
    const result = await runProject(nadia, hnId, { values: { take: 10 }, trigger: 'manual' });
    expect(result.status).toBe('failed');
    expect(seen).toHaveLength(4);
    expect(result.error?.code).toBe('rate_limited');
  });

  it('retries a timeout once, then says the API took too long', async () => {
    answer = () => {
      throw new GuardError('timeout', 'No answer within 20 seconds.');
    };
    const result = await runProject(nadia, hnId, { values: { take: 10 }, trigger: 'manual' });
    expect(seen).toHaveLength(2);
    expect(result.status).toBe('failed');
    expect(result.error).toEqual({ code: 'timeout', text: 'The API took too long.' });
  });

  it('retries a 5xx once', async () => {
    let calls = 0;
    answer = () => (++calls === 1 ? respond(503, 'down') : respond(200, { hits: hits(5), nbHits: 5 }));
    const result = await runProject(nadia, hnId, { values: { take: 10 }, trigger: 'manual' });
    expect(result.status).toBe('ok');
    expect(result.rows).toBe(5);
    expect(seen).toHaveLength(2);
  });

  it('refuses bad input with the control’s label', async () => {
    await expect(runProject(nadia, hnId, { values: { take: 5000 }, trigger: 'manual' })).rejects.toMatchObject({
      code: 'bad_input',
      message: 'Posts per page must stay between 10 and 200.',
    });
    expect(seen).toHaveLength(0);
  });
});

describe('search then collect', () => {
  it('searches for free, collects the first take, and counts credits', async () => {
    answer = coresignalApi();
    const result = await runProject(nadia, csId, { values: { take: 5 }, trigger: 'manual' });
    expect(result.status).toBe('ok');
    expect(result.matches).toBe(3412);
    expect(result.rows).toBe(5);
    expect(result.credits).toBe(100);
    expect(seen[0].method).toBe('POST');
    expect(seen.slice(1).every((s) => s.method === 'GET' && s.url.includes('/collect/'))).toBe(true);
    expect(result.requests).toHaveLength(6);
    // The log is masked; the real key never reaches it.
    expect(JSON.stringify(result.requests)).not.toContain('abcdef');
    expect(result.requests[0].headers.apikey).toBe('••••7Qk1');
    const key = await apiKeys.get(nadia, keyId);
    expect(key.creditsLeft).toBe(11380);
  });

  it('skips companies already saved, so repeats cost no credits', async () => {
    answer = coresignalApi();
    const dataset = await datasets.create(nadia, { projectId: csId, name: 'AU software' });
    expect(dataset.keyPath).toBe('id');
    const first = await runProject(nadia, csId, { values: { take: 5 }, trigger: 'manual', datasetId: dataset.id });
    expect(first).toMatchObject({ rows: 5, newRows: 5, credits: 100 });
    seen = [];
    const second = await runProject(nadia, csId, { values: { take: 5 }, trigger: 'manual', datasetId: dataset.id });
    // The search asks for 10 ids, the first 5 are saved already, so only the next 5 are collected.
    expect(new URL(seen[0].url).searchParams.get('items_per_page')).toBe('10');
    expect(second).toMatchObject({ rows: 5, newRows: 5, credits: 100 });
    expect(seen.filter((s) => s.url.includes('/collect/')).map((s) => s.url.split('/').pop())).toEqual([
      '81244315',
      '81244316',
      '81244317',
      '81244318',
      '81244319',
    ]);
    expect(await datasets.get(nadia, dataset.id)).toMatchObject({ rows: 10, repeatsSkipped: 5, runs: 2 });
  });

  it('asks first when a manual run costs more than the project’s limit', async () => {
    answer = coresignalApi();
    await expect(runProject(nadia, csId, { values: { take: 60 }, trigger: 'manual' })).rejects.toMatchObject({
      code: 'confirm_credits',
      status: 409,
    });
    expect(seen).toHaveLength(0);
    const result = await runProject(nadia, csId, { values: { take: 60 }, trigger: 'manual', confirmCredits: 1200 });
    expect(result.rows).toBe(60);
    expect(result.credits).toBe(1200);
  });

  it('stops a scheduled run over its limit without spending anything', async () => {
    answer = coresignalApi();
    const result = await runProject(nadia, csId, { values: { take: 30 }, trigger: 'schedule', creditLimit: 400 });
    expect(seen).toHaveLength(0);
    expect(result.status).toBe('stopped');
    expect(result.credits).toBe(0);
    expect(result.error?.code).toBe('credit_limit');
    expect(result.error?.text).toContain('600 credits, over the schedule’s limit of 400');
  });

  it('says plainly when the key is refused', async () => {
    answer = coresignalApi({ refuse: true });
    const result = await runProject(nadia, csId, { values: { take: 5 }, trigger: 'manual' });
    expect(result.status).toBe('failed');
    expect(result.error).toEqual({
      code: 'key_refused',
      text: 'Your CoreSignal key was refused. Replace it in Settings.',
    });
  });

  it('previews the live match count for free, asking for one id', async () => {
    answer = coresignalApi({ total: 3412 });
    const preview = await previewRun(nadia, csId, { take: 25 });
    expect(preview).toMatchObject({
      matches: 3412,
      take: 25,
      credits: 500,
      unit: 'credits',
      needsKey: false,
      free: false,
    });
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0].url).searchParams.get('items_per_page')).toBe('1');
    // The same count again comes from the cache.
    await previewRun(nadia, csId, { take: 40 });
    expect(seen).toHaveLength(1);
  });
});

describe('test calls', () => {
  it('calls a free endpoint once and lists the fields', async () => {
    answer = () => respond(200, { hits: hits(3), nbHits: 3 });
    const result = await testCall(nadia, hnId, 'search', {});
    expect(result.ok).toBe(true);
    expect(result.records).toBe(3);
    expect(result.total).toBe(3);
    expect(result.fields).toEqual(['objectID', 'title', 'points', 'author']);
    // Test calls stay out of the run list.
    expect((await runs.list(nadia, { projectId: hnId })).some((r) => r.trigger === 'test')).toBe(false);
  });

  it('never test-calls a paid endpoint', async () => {
    await expect(testCall(nadia, csId, 'collect', {})).rejects.toMatchObject({ code: 'not_free' });
    expect(seen).toHaveLength(0);
  });
});

describe('security', () => {
  it('sends no key to a host other than the key’s own', async () => {
    const moved = { ...coresignal, api: { ...coresignal.api, baseUrl: 'https://api.evil-mirror.example/cdapi/v2' } };
    const project = await projects.create(nadia, { name: 'Moved', apiName: 'CoreSignal', apiKeyId: keyId });
    await projects.saveSpec(nadia, project.id, moved, { author: 'ai' });
    answer = () => respond(200, []);
    const result = await runProject(nadia, project.id, { values: { take: 5 }, trigger: 'manual' });
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('wrong_host');
    expect(seen).toHaveLength(0);
  });

  it('refuses a private address through the real guard', async () => {
    useTransportForTests(null);
    try {
      const local = { ...hackerNews, api: { ...hackerNews.api, baseUrl: 'https://127.0.0.1:9' } };
      const project = await projects.create(nadia, { name: 'Local', apiName: 'Local' });
      await projects.saveSpec(nadia, project.id, local, { author: 'ai' });
      const result = await runProject(nadia, project.id, { values: {}, trigger: 'manual' });
      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('private_address');
    } finally {
      useTransportForTests(fake, fakeSleep);
    }
  });

  it('gives another account’s ids a 404', async () => {
    const checked = other;
    await expect(runProject(checked, hnId, { values: {}, trigger: 'manual' })).rejects.toMatchObject({ status: 404 });
    await expect(previewRun(checked, csId, {})).rejects.toMatchObject({ status: 404 });
    answer = () => respond(200, { hits: hits(3), nbHits: 3 });
    const mine = await runProject(nadia, hnId, { values: {}, trigger: 'manual' });
    await expect(runs.get(checked, mine.runId)).rejects.toMatchObject({ status: 404 });
    expect((await runs.list(checked)).length).toBe(0);
  });
});

describe('caps', () => {
  it('waits for a slot past 60 calls a minute, and stops at 5,000 a day', async () => {
    for (let i = 0; i < 60; i++) await takeSlot(nadia.user.id, { wait: false });
    await expect(takeSlot(nadia.user.id, { wait: false })).rejects.toMatchObject({ code: 'minute_cap' });
    resetCallCounts();
    const yesterday = Date.now() - 60 * 60 * 1000;
    await db
      .insertInto('runs')
      .values({
        id: 'cap-run',
        project_id: hnId,
        user_id: nadia.user.id,
        trigger: 'manual',
        preset_id: null,
        schedule_id: null,
        values: '{}',
        status: 'ok',
        matches: null,
        rows: 0,
        credits: 0,
        http_status: 200,
        error_code: null,
        error_text: null,
        retries: 0,
        requests: JSON.stringify(Array.from({ length: 5000 }, () => ({}))),
        sample: null,
        dataset_id: null,
        new_rows: 0,
        started_at: yesterday,
        finished_at: yesterday,
        created_at: yesterday,
      })
      .execute();
    await expect(runProject(nadia, hnId, { values: {}, trigger: 'manual' })).rejects.toMatchObject({
      code: 'daily_cap',
    });
    await db.deleteFrom('runs').where('id', '=', 'cap-run').execute();
    resetCallCounts();
  });
});
