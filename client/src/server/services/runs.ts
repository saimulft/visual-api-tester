import type { Selectable } from 'kysely';
import { z } from 'zod';
import { errors } from '@/contracts/common';
import { RunRequestLogSchema, type RecordRow, type RunResult } from '@/contracts/runs';
import { ValuesSchema } from '@/contracts/spec';
import type { RunDetail, RunSummary } from '@/contracts/workspace';
import { db, parseJson } from '../db';
import type { RunsTable } from '../db/schema';
import type { Ctx } from './context';

/**
 * The run history. The runner (server/runner) writes runs; this reads them, scoped to the person.
 * Test calls (trigger "test") stay out of lists unless asked for.
 */
type Row = Selectable<RunsTable>;

const LogsSchema = z.array(RunRequestLogSchema).catch([]);
const SampleSchema = z.array(z.record(z.string(), z.unknown())).nullable().catch(null);
const ValuesOrEmpty = ValuesSchema.catch({});

export function toRunResult(row: Row): RunResult {
  return {
    runId: row.id,
    projectId: row.project_id,
    status: row.status,
    trigger: row.trigger,
    matches: row.matches === null ? null : Number(row.matches),
    rows: Number(row.rows),
    newRows: Number(row.new_rows),
    credits: Number(row.credits),
    httpStatus: row.http_status,
    retries: Number(row.retries),
    datasetId: row.dataset_id,
    error: row.error_code ? { code: row.error_code, text: row.error_text ?? '' } : null,
    requests: parseJson(LogsSchema, row.requests),
    sample: (parseJson(SampleSchema, row.sample) ?? []) as RecordRow[],
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
  };
}

const summaryColumns = [
  'runs.id',
  'runs.project_id',
  'runs.trigger',
  'runs.status',
  'runs.matches',
  'runs.rows',
  'runs.new_rows',
  'runs.credits',
  'runs.http_status',
  'runs.retries',
  'runs.error_code',
  'runs.error_text',
  'runs.dataset_id',
  'runs.schedule_id',
  'runs.preset_id',
  'runs.started_at',
  'runs.finished_at',
  'projects.name as project_name',
  'projects.api_name',
  'projects.monogram',
  'datasets.name as dataset_name',
  'schedules.name as schedule_name',
] as const;

function summaryQuery(ctx: Ctx) {
  return db
    .selectFrom('runs')
    .innerJoin('projects', 'projects.id', 'runs.project_id')
    .leftJoin('datasets', 'datasets.id', 'runs.dataset_id')
    .leftJoin('schedules', 'schedules.id', 'runs.schedule_id')
    .select(summaryColumns)
    .where('runs.user_id', '=', ctx.user.id);
}

type SummaryRow = Awaited<ReturnType<ReturnType<typeof summaryQuery>['execute']>>[number];

function toSummary(row: SummaryRow): RunSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    apiName: row.api_name,
    monogram: row.monogram,
    trigger: row.trigger,
    status: row.status,
    matches: row.matches === null ? null : Number(row.matches),
    rows: Number(row.rows),
    newRows: Number(row.new_rows),
    credits: Number(row.credits),
    httpStatus: row.http_status,
    retries: Number(row.retries),
    error: row.error_code ? { code: row.error_code, text: row.error_text ?? '' } : null,
    datasetId: row.dataset_id,
    datasetName: row.dataset_name ?? null,
    scheduleId: row.schedule_id,
    scheduleName: row.schedule_name ?? null,
    presetId: row.preset_id,
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
  };
}

export type RunListFilter = {
  projectId?: string;
  scheduleId?: string;
  limit?: number;
  /** Include test calls. */
  tests?: boolean;
  /** Only runs started at or after (ms). */
  since?: number;
};

/** The person's runs, newest first. */
export async function list(ctx: Ctx, filter: RunListFilter = {}): Promise<RunSummary[]> {
  let query = summaryQuery(ctx);
  if (filter.projectId) query = query.where('runs.project_id', '=', filter.projectId);
  if (filter.scheduleId) query = query.where('runs.schedule_id', '=', filter.scheduleId);
  if (!filter.tests) query = query.where('runs.trigger', '!=', 'test');
  if (filter.since !== undefined) query = query.where('runs.started_at', '>=', filter.since);
  const rows = await query
    .orderBy('runs.started_at', 'desc')
    .limit(Math.min(Math.max(filter.limit ?? 20, 1), 200))
    .execute();
  return rows.map(toSummary);
}

/** Runs by id (a schedule's last run, a dataset's runs), as summaries. */
export async function byIds(ctx: Ctx, ids: string[]): Promise<Map<string, RunSummary>> {
  const out = new Map<string, RunSummary>();
  const wanted = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < wanted.length; i += 200) {
    const rows = await summaryQuery(ctx)
      .where('runs.id', 'in', wanted.slice(i, i + 200))
      .execute();
    for (const row of rows) out.set(row.id, toSummary(row));
  }
  return out;
}

/** One run in full: its rows sample, request log and values. */
export async function get(ctx: Ctx, id: string): Promise<RunDetail> {
  const row = await db
    .selectFrom('runs')
    .innerJoin('projects', 'projects.id', 'runs.project_id')
    .selectAll('runs')
    .select(['projects.name as project_name', 'projects.api_name'])
    .where('runs.id', '=', id)
    .where('runs.user_id', '=', ctx.user.id)
    .executeTakeFirst();
  if (!row) throw errors.notFound('That run');
  return {
    ...toRunResult(row),
    values: parseJson(ValuesOrEmpty, row.values),
    projectName: row.project_name,
    apiName: row.api_name,
  };
}

/** The newest finished run of a project (the workspace's "Last run"), or null. */
export async function latest(ctx: Ctx, projectId: string): Promise<RunDetail | null> {
  const row = await db
    .selectFrom('runs')
    .select('id')
    .where('user_id', '=', ctx.user.id)
    .where('project_id', '=', projectId)
    .where('trigger', '!=', 'test')
    .orderBy('started_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? get(ctx, row.id) : null;
}
