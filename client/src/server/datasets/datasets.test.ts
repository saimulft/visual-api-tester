import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import hackerNews from '../seed/specs/hacker-news.json';
import { db } from '../db';
import { createTestDb } from '../db/testing';
import { resetRateLimits } from '../http/rate-limit';
import type { GuardedResponse } from '../net/guarded-fetch';
import { resetCallCounts, useTransportForTests, type Transport } from '../runner/call';
import { runProject } from '../runner/run';
import * as auth from '../services/auth';
import { ctxFor, type Ctx } from '../services/context';
import * as datasets from '../services/datasets';
import * as projects from '../services/projects';
import { exportResponse } from './export';

const t = await createTestDb();

let page = 0;
function respond(data: unknown): GuardedResponse {
  const text = JSON.stringify(data);
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    url: 'https://hn.algolia.com/api/v1/search',
    redirects: 0,
    ms: 1,
    bytes: Buffer.from(text),
    text: () => text,
    json: () => data,
  };
}
/** Each call returns the posts asked for: two repeat the last call's, the rest are new. */
const fake: Transport = async (url) => {
  const size = Number(new URL(String(url)).searchParams.get('hitsPerPage') ?? 10);
  const start = page * 8;
  page++;
  const hits = Array.from({ length: size }, (_, i) => ({
    objectID: String(start + i),
    title: `Post, "number" ${start + i}`,
    points: 100 + i,
    author: { name: 'pg', karma: 1 },
    tags: ['story', 'show_hn'],
  }));
  return respond({ hits, nbHits: 500 });
};

let nadia: Ctx;
let other: Ctx;
let projectId: string;

beforeAll(async () => {
  resetRateLimits();
  resetCallCounts();
  useTransportForTests(fake, async () => undefined);
  const meta = { ip: '203.0.113.30', userAgent: 'vitest' };
  const a = await auth.signUp({ email: 'nadia@brightfield.com.au', password: 'field-notes-2026!' }, meta);
  const b = await auth.signUp({ email: 'sam@tidepool.io', password: 'field-notes-2026!' }, meta);
  await db.updateTable('users').set({ email_checked_at: Date.now() }).execute();
  const load = async (id: string) =>
    ctxFor(await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
  nadia = await load(a.user.id);
  other = await load(b.user.id);
  const project = await projects.create(nadia, { name: 'AI launch posts', apiName: 'Hacker News Search' });
  await projects.saveSpec(nadia, project.id, hackerNews, { author: 'ai' });
  projectId = project.id;
});

afterAll(async () => {
  useTransportForTests(null);
  await t.close();
});

const run = () => runProject(nadia, projectId, { values: { take: 10 }, trigger: 'manual' });

describe('save modes', () => {
  it('adds new rows and skips repeats on the key', async () => {
    const dataset = await datasets.create(nadia, { projectId, name: 'AI launch posts' });
    expect(dataset.keyPath).toBe('objectID');
    expect(dataset.saveMode).toBe('append');
    const first = await run();
    const one = await datasets.saveRun(nadia, dataset.id, { runId: first.runId });
    expect(one).toMatchObject({ newRows: 10, skipped: 0, rows: 10, fromSample: false });
    const second = await run();
    const two = await datasets.saveRun(nadia, dataset.id, { runId: second.runId });
    expect(two).toMatchObject({ newRows: 8, skipped: 2, rows: 18 });
    const saved = await datasets.get(nadia, dataset.id);
    expect(saved).toMatchObject({ rows: 18, runs: 2, repeatsSkipped: 2 });
    expect(saved.bytes).toBeGreaterThan(0);
    expect(saved.perRun.map((r) => r.newRows)).toEqual([10, 8]);
    expect(saved.columns.map((c) => c.key)).toContain('author.name');
    const rows = await datasets.rows(nadia, dataset.id, { pageSize: 3 });
    expect(rows.total).toBe(18);
    expect(rows.rows[0].objectID).toBe('17'); // newest first
  });

  it('replaces all rows', async () => {
    const dataset = await datasets.create(nadia, { projectId, name: 'Latest only', saveMode: 'replace' });
    await datasets.saveRun(nadia, dataset.id, { runId: (await run()).runId });
    const again = await datasets.saveRun(nadia, dataset.id, { runId: (await run()).runId });
    expect(again.rows).toBe(10);
    expect((await datasets.get(nadia, dataset.id)).runs).toBe(2);
  });

  it('keeps each run side by side', async () => {
    const dataset = await datasets.create(nadia, { projectId, name: 'Every run', saveMode: 'keep' });
    await datasets.saveRun(nadia, dataset.id, { runId: (await run()).runId });
    const again = await datasets.saveRun(nadia, dataset.id, { runId: (await run()).runId });
    expect(again).toMatchObject({ newRows: 10, skipped: 0, rows: 20 });
  });

  it('saves straight from a run, and keeps other people out', async () => {
    const dataset = await datasets.create(nadia, { projectId, name: 'From the run' });
    const result = await runProject(nadia, projectId, {
      values: { take: 10 },
      trigger: 'manual',
      datasetId: dataset.id,
    });
    expect(result.datasetId).toBe(dataset.id);
    expect(result.newRows).toBe(10);
    await expect(datasets.get(other, dataset.id)).rejects.toMatchObject({ status: 404 });
    await expect(datasets.saveRun(other, dataset.id, { runId: result.runId })).rejects.toMatchObject({ status: 404 });
    expect(await datasets.list(other)).toEqual([]);
  });
});

describe('exports and the live link', () => {
  it('exports CSV, Excel and JSON', async () => {
    const dataset = (await datasets.list(nadia)).find((d) => d.name === 'AI launch posts')!;
    const source = { id: dataset.id, name: dataset.name, columns: JSON.stringify(dataset.columns) };

    const csv = await exportResponse(source, 'csv', null).text();
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(19);
    expect(lines[0]).toBe('Object id,Title,Points,Author name,Author karma,Tags');
    expect(lines[1]).toContain('"Post, ""number"" 0"');
    expect(lines[1]).toContain('"story, show_hn"');

    const picked = await exportResponse(source, 'csv', ['title', 'points']).text();
    expect(picked.split('\r\n')[0]).toBe('Title,Points');

    const json = JSON.parse(await exportResponse(source, 'json', null).text());
    expect(json).toHaveLength(18);
    expect(json[0].author).toEqual({ name: 'pg', karma: 1 });

    const res = exportResponse(source, 'xlsx', null);
    expect(res.headers.get('content-disposition')).toContain('ai-launch-posts.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.rowCount).toBe(19);
    expect(sheet.getRow(1).getCell(1).value).toBe('Object id');
    expect(sheet.getRow(2).getCell(3).value).toBe(100);
  });

  it('serves a live CSV link that turns off', async () => {
    const dataset = (await datasets.list(nadia)).find((d) => d.name === 'AI launch posts')!;
    const on = await datasets.csvLink(nadia, dataset.id, true);
    const token = on.csvUrl!.split('/csv/')[1];
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect((await datasets.byCsvToken(token))?.id).toBe(dataset.id);
    const renewed = await datasets.csvLink(nadia, dataset.id, true);
    expect(renewed.csvUrl).not.toBe(on.csvUrl);
    expect(await datasets.byCsvToken(token)).toBeNull();
    await datasets.csvLink(nadia, dataset.id, false);
    expect(await datasets.byCsvToken(renewed.csvUrl!.split('/csv/')[1])).toBeNull();
    expect(await datasets.byCsvToken('short')).toBeNull();
  });
});
