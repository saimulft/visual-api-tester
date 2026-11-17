import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import coresignal from '../seed/specs/coresignal.json';
import hackerNews from '../seed/specs/hacker-news.json';
import { db } from '../db';
import { createTestDb } from '../db/testing';
import { resetRateLimits } from '../http/rate-limit';
import { sentMail } from '../mail';
import type { GuardedResponse } from '../net/guarded-fetch';
import { resetCallCounts, useTransportForTests, type Transport } from '../runner/call';
import * as apiKeys from '../services/api-keys';
import * as auth from '../services/auth';
import { ctxFor, type Ctx } from '../services/context';
import * as datasets from '../services/datasets';
import * as projects from '../services/projects';
import * as schedules from '../services/schedules';
import { runDueSchedules } from './job';
import { describeTiming, nextRuns, patternOf } from './timing';

const t = await createTestDb();

let calls = 0;
let keyRefused = false;
function respond(status: number, data: unknown, headers: Record<string, string> = {}): GuardedResponse {
  const text = JSON.stringify(data);
  return {
    ok: status < 300,
    status,
    headers: new Headers(headers),
    url: 'https://x.test/',
    redirects: 0,
    ms: 1,
    bytes: Buffer.from(text),
    text: () => text,
    json: () => data,
  };
}
const fake: Transport = async (url, init = {}) => {
  calls++;
  const u = new URL(String(url));
  if (u.host === 'api.coresignal.com') {
    if (keyRefused || init.headers?.apikey !== 'cs-live-abcdef7Qk1') return respond(401, { message: 'Invalid key' });
    if (u.pathname.endsWith('/es_dsl')) return respond(200, [1, 2, 3], { 'x-total-results': '3' });
    return respond(200, { id: Number(u.pathname.split('/').pop()), name: 'Kestrel Labs' });
  }
  return respond(200, { hits: [{ objectID: 'a', title: 'Show HN: A' }, { objectID: 'b', title: 'Show HN: B' }], nbHits: 2 });
};

let nadia: Ctx;
let hnId: string;
let csId: string;

beforeAll(async () => {
  resetRateLimits();
  useTransportForTests(fake, async () => undefined);
  const a = await auth.signUp(
    { email: 'nadia@brightfield.com.au', password: 'field-notes-2026!' },
    { ip: '203.0.113.40', userAgent: 'vitest' },
  );
  await db
    .updateTable('users')
    .set({ email_checked_at: Date.now(), alert_email: 'alerts@brightfield.com.au', timezone: 'Australia/Sydney' })
    .execute();
  nadia = ctxFor(await db.selectFrom('users').selectAll().where('id', '=', a.user.id).executeTakeFirstOrThrow());
  const hn = await projects.create(nadia, { name: 'AI launch posts', apiName: 'Hacker News Search' });
  await projects.saveSpec(nadia, hn.id, hackerNews, { author: 'ai' });
  hnId = hn.id;
  const key = await apiKeys.create(nadia, {
    apiSlug: 'coresignal',
    apiName: 'CoreSignal',
    host: 'api.coresignal.com',
    secret: 'cs-live-abcdef7Qk1',
  });
  const cs = await projects.create(nadia, { name: 'AU software companies', apiName: 'CoreSignal', apiKeyId: key.id });
  await projects.saveSpec(nadia, cs.id, coresignal, { author: 'ai' });
  csId = cs.id;
});

afterAll(async () => {
  useTransportForTests(null);
  await t.close();
});

beforeEach(() => {
  calls = 0;
  keyRefused = false;
  sentMail.length = 0;
  resetCallCounts();
});

const due = async (id: string) =>
  db.updateTable('schedules').set({ next_run_at: Date.now() - 60_000 }).where('id', '=', id).execute();

describe('timing', () => {
  it('turns a cadence into croner patterns and the next runs, right across daylight saving', () => {
    expect(patternOf({ cadence: 'weekly', days: [1], dayOfMonth: null, time: '09:00', timezone: 'UTC' })).toBe('0 9 * * 1');
    const weekly = { cadence: 'weekly' as const, days: [1], dayOfMonth: null, time: '09:00', timezone: 'Australia/Sydney' };
    // Sydney moves to daylight time on 4 Oct 2026: 09:00 stays 09:00 local.
    const runs = nextRuns(weekly, Date.UTC(2026, 8, 26), 3).map((at) => new Date(at).toISOString());
    expect(runs).toEqual(['2026-09-27T23:00:00.000Z', '2026-10-04T22:00:00.000Z', '2026-10-11T22:00:00.000Z']);
    expect(describeTiming(weekly, 'Australia/Sydney')).toBe('Every Monday at 09:00');
    expect(describeTiming({ ...weekly, cadence: 'hourly' })).toBe('Every hour, on the hour');
    expect(describeTiming({ ...weekly, cadence: 'monthly', dayOfMonth: 1, time: '08:00' }, 'Australia/Sydney')).toBe(
      '1st of each month at 08:00',
    );
  });
});

describe('the schedules-due job', () => {
  it('runs a due schedule once, not twice, saves to its dataset and moves the next run', async () => {
    const dataset = await datasets.create(nadia, { projectId: hnId, name: 'AI launch posts' });
    const schedule = await schedules.upsert(nadia, {
      projectId: hnId,
      datasetId: dataset.id,
      cadence: 'hourly',
      time: '09:00',
      timezone: 'Australia/Sydney',
      creditLimit: 0,
      emailCsv: true,
    });
    expect(schedule.name).toBe('Hourly: AI launch posts');
    expect(schedule.nextRunAt).toBeGreaterThan(Date.now());
    await due(schedule.id);

    // Two ticks at once, as two servers would: only one wins the claim.
    const [a, b] = await Promise.all([runDueSchedules({ wait: true }), runDueSchedules({ wait: true })]);
    expect([...a, ...b]).toEqual([schedule.id]);
    const ran = await db.selectFrom('runs').selectAll().where('schedule_id', '=', schedule.id).execute();
    expect(ran).toHaveLength(1);
    expect(ran[0]).toMatchObject({ trigger: 'schedule', status: 'ok', dataset_id: dataset.id });

    const after = await schedules.get(nadia, schedule.id);
    expect(after.nextRunAt).toBeGreaterThan(Date.now());
    expect(after.lastRun?.id).toBe(ran[0].id);
    expect((await datasets.get(nadia, dataset.id)).rows).toBe(2);

    // A tick with nothing due does nothing.
    expect(await runDueSchedules({ wait: true })).toEqual([]);

    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].to).toBe('alerts@brightfield.com.au');
    expect(sentMail[0].subject).toBe('New rows from Hourly: AI launch posts');
    const attachments = (sentMail[0] as { attachments?: { content: string }[] }).attachments;
    expect(attachments?.[0].content.split('\r\n')[0]).toBe('Object id,Title');
  });

  it('stops a run over its limit before spending, and emails', async () => {
    const schedule = await schedules.upsert(nadia, {
      projectId: csId,
      values: { take: 30 },
      cadence: 'weekly',
      days: [1],
      time: '09:00',
      timezone: 'Australia/Sydney',
      creditLimit: 400,
    });
    expect(schedule.creditsPerRecord).toBe(20);
    await due(schedule.id);
    await runDueSchedules({ wait: true });
    expect(calls).toBe(0);
    const after = await schedules.get(nadia, schedule.id);
    expect(after.lastRun).toMatchObject({ status: 'stopped', credits: 0 });
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].subject).toBe('Weekly: AU software companies stopped before spending');
    expect(sentMail[0].text).toContain('600 credits, over the schedule’s limit of 400');
  });

  it('emails when a bad key fails the run, unless alerts are muted', async () => {
    keyRefused = true;
    const schedule = await schedules.upsert(nadia, {
      projectId: csId,
      values: { take: 3 },
      cadence: 'daily',
      time: '07:30',
      timezone: 'Australia/Sydney',
      creditLimit: 1000,
      emailOnFail: true,
    });
    await due(schedule.id);
    await runDueSchedules({ wait: true });
    expect((await schedules.get(nadia, schedule.id)).state).toBe('failed');
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].text).toContain('Your CoreSignal key was refused. Replace it in Settings.');

    sentMail.length = 0;
    await db.updateTable('users').set({ alerts_muted: true }).where('id', '=', nadia.user.id).execute();
    await due(schedule.id);
    await runDueSchedules({ wait: true });
    expect(sentMail).toHaveLength(0);
    await db.updateTable('users').set({ alerts_muted: false }).where('id', '=', nadia.user.id).execute();
  });

  it('skips paused schedules and resumes them from now', async () => {
    const schedule = await schedules.upsert(nadia, {
      projectId: hnId,
      cadence: 'daily',
      time: '06:00',
      timezone: 'Australia/Sydney',
      creditLimit: 0,
      status: 'paused',
    });
    expect(schedule.nextRunAt).toBeNull();
    await due(schedule.id);
    expect(await runDueSchedules({ wait: true })).toEqual([]);
    const resumed = await schedules.setStatus(nadia, schedule.id, 'on');
    expect(resumed.nextRunAt).toBeGreaterThan(Date.now());
    const next = await schedules.nextRuns(nadia, resumed);
    expect(next).toHaveLength(3);
    expect(next[0].label).toMatch(/^\w+day \d+ \w+, 06:00$/);
  });
});
