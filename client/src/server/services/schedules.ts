import type { Selectable } from 'kysely';
import { ApiError, errors } from '@/contracts/common';
import { ScheduleUpsertSchema, type NextRun, type Schedule } from '@/contracts/schedules';
import { allControls, ValuesSchema, type ApiSpec, type Values } from '@/contracts/spec';
import { defaultValues } from '@/contracts/values';
import type { RunSummary } from '@/contracts/workspace';
import { bool, db, json, newId, parseJson } from '../db';
import type { SchedulesTable } from '../db/schema';
import { checkBody } from '../http/inputs';
import { validTimeZone } from '../jobs/time';
import { describeNext, nextRunAfter, nextRuns as timingRuns } from '../schedules/timing';
import type { Ctx } from './context';
import * as projects from './projects';
import * as runs from './runs';

/**
 * Schedules: a project's run on a cadence, in a time zone, with a credit limit per run and email alerts.
 * The schedules-due job (server/schedules/job.ts) runs them; this keeps them, scoped to the person.
 */
type Row = Selectable<SchedulesTable>;
const ValuesOrEmpty = ValuesSchema.catch({});

function daysOf(text: string): number[] {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  } catch {
    return [];
  }
}

/** What one record costs on the project's run, and in what unit. */
export function costOf(spec: ApiSpec | null): { perRecord: number; unit: string } {
  if (!spec) return { perRecord: 0, unit: 'credits' };
  const run = spec.run;
  const endpoint = spec.endpoints.find((e) => e.id === (run.mode === 'searchThenCollect' ? run.collectId : run.endpointId));
  if (!endpoint) return { perRecord: 0, unit: 'credits' };
  return {
    perRecord: endpoint.cost.perRecord + (run.mode === 'searchThenCollect' ? endpoint.cost.perCall : 0),
    unit: endpoint.cost.unit,
  };
}

const CADENCE_WORD = { hourly: 'Hourly', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' } as const;

/** "Weekly: AU software companies", "Daily: store weather". */
export function defaultName(cadence: keyof typeof CADENCE_WORD, projectName: string): string {
  const first = projectName.split(/\s+/)[0] ?? '';
  const keep = first.length > 1 && first === first.toUpperCase();
  const rest = keep ? projectName : projectName.charAt(0).toLowerCase() + projectName.slice(1);
  return `${CADENCE_WORD[cadence]}: ${rest}`;
}

function baseQuery(ctx: Ctx) {
  return db
    .selectFrom('schedules')
    .innerJoin('projects', 'projects.id', 'schedules.project_id')
    .leftJoin('presets', 'presets.id', 'schedules.preset_id')
    .leftJoin('datasets', 'datasets.id', 'schedules.dataset_id')
    .selectAll('schedules')
    .select([
      'projects.name as project_name',
      'projects.api_name',
      'projects.monogram',
      'projects.spec as project_spec',
      'presets.name as preset_name',
      'datasets.name as dataset_name',
      'datasets.save_mode as dataset_mode',
    ])
    .where('schedules.user_id', '=', ctx.user.id);
}
type FullRow = Awaited<ReturnType<ReturnType<typeof baseQuery>['execute']>>[number];

async function lastRuns(ctx: Ctx, ids: (string | null)[]): Promise<Map<string, RunSummary>> {
  return runs.byIds(
    ctx,
    ids.filter((id): id is string => Boolean(id)),
  );
}

function specOf(text: string | null): ApiSpec | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as ApiSpec;
  } catch {
    return null;
  }
}

function toSchedule(row: FullRow, last: RunSummary | null): Schedule {
  const cost = costOf(specOf(row.project_spec));
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    apiName: row.api_name,
    monogram: row.monogram,
    presetId: row.preset_id,
    presetName: row.preset_name ?? null,
    values: parseJson(ValuesOrEmpty, row.values),
    datasetId: row.dataset_id,
    datasetName: row.dataset_name ?? null,
    datasetMode: row.dataset_mode ?? null,
    name: row.name,
    cadence: row.cadence,
    days: daysOf(row.days),
    dayOfMonth: row.day_of_month,
    time: row.time,
    timezone: row.timezone,
    creditLimit: Number(row.credit_limit),
    creditsPerRecord: cost.perRecord,
    creditUnit: cost.unit,
    emailOnFail: bool(row.email_on_fail),
    emailCsv: bool(row.email_csv),
    status: row.status,
    state: row.status === 'paused' ? 'paused' : last?.status === 'failed' ? 'failed' : 'on',
    pausedAt: row.paused_at === null ? null : Number(row.paused_at),
    nextRunAt: row.status === 'on' && row.next_run_at !== null ? Number(row.next_run_at) : null,
    lastRun: last,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/** The person's schedules, soonest first; paused ones last. */
export async function list(ctx: Ctx, filter: { projectId?: string } = {}): Promise<Schedule[]> {
  let query = baseQuery(ctx);
  if (filter.projectId) query = query.where('schedules.project_id', '=', filter.projectId);
  const rows = await query.orderBy('schedules.created_at').execute();
  const last = await lastRuns(
    ctx,
    rows.map((r) => r.last_run_id),
  );
  return rows
    .map((r) => toSchedule(r, r.last_run_id ? (last.get(r.last_run_id) ?? null) : null))
    .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
}

export async function get(ctx: Ctx, id: string): Promise<Schedule> {
  const found = await baseQuery(ctx).where('schedules.id', '=', id).executeTakeFirst();
  if (!found) throw errors.notFound('That schedule');
  const last = found.last_run_id ? (await lastRuns(ctx, [found.last_run_id])).get(found.last_run_id) : null;
  return toSchedule(found, last ?? null);
}

async function own(ctx: Ctx, table: 'presets' | 'datasets', id: string | null | undefined, projectId: string) {
  if (!id) return;
  const found =
    table === 'presets'
      ? await db.selectFrom('presets').select('project_id').where('id', '=', id).executeTakeFirst()
      : await db
          .selectFrom('datasets')
          .select('project_id')
          .where('id', '=', id)
          .where('user_id', '=', ctx.user.id)
          .executeTakeFirst();
  if (!found || found.project_id !== projectId)
    throw errors.invalid([
      { path: table === 'presets' ? 'presetId' : 'datasetId', message: `Pick one of this project’s ${table}.` },
    ]);
}

/**
 * Makes or changes a schedule. Values come from the preset when one is picked (a copy, so the schedule
 * keeps working if the preset goes), else from the input, else the spec's defaults.
 */
export async function upsert(ctx: Ctx, input: unknown): Promise<Schedule> {
  const data = checkBody(ScheduleUpsertSchema, input);
  const timezone = validTimeZone(data.timezone);
  if (!timezone) throw errors.invalid([{ path: 'timezone', message: 'Pick a time zone from the list.' }]);
  const project = await projects.get(ctx, data.projectId);
  if (!project.spec) throw new ApiError('no_spec', 'Set this project up before scheduling it.', 409);
  await own(ctx, 'presets', data.presetId, project.id);
  await own(ctx, 'datasets', data.datasetId, project.id);

  // The values: given ones; else the preset's (a copy); else what an existing schedule had; else the
  // project's last run; else the spec's defaults.
  let values: Values = { ...defaultValues(project.spec) };
  const existingValues = data.id
    ? await db.selectFrom('schedules').select('values').where('id', '=', data.id).where('user_id', '=', ctx.user.id).executeTakeFirst()
    : undefined;
  const lastRun = await db
    .selectFrom('runs')
    .select('values')
    .where('user_id', '=', ctx.user.id)
    .where('project_id', '=', project.id)
    .where('trigger', '!=', 'test')
    .orderBy('started_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  const preset = data.presetId
    ? await db.selectFrom('presets').select('values').where('id', '=', data.presetId).executeTakeFirst()
    : undefined;
  if (data.values) values = { ...values, ...data.values };
  else if (preset) values = { ...values, ...parseJson(ValuesOrEmpty, preset.values) };
  else if (existingValues) values = { ...values, ...parseJson(ValuesOrEmpty, existingValues.values) };
  else if (lastRun) values = { ...values, ...parseJson(ValuesOrEmpty, lastRun.values) };
  const known = new Set(allControls(project.spec).map((c) => c.id));
  values = Object.fromEntries(Object.entries(values).filter(([k]) => known.has(k)));

  const timing = {
    cadence: data.cadence,
    days: data.cadence === 'weekly' ? data.days : [],
    dayOfMonth: data.cadence === 'monthly' ? (data.dayOfMonth ?? 1) : null,
    time: data.time,
    timezone,
  };
  const next = data.status === 'on' ? nextRunAfter(timing, ctx.now) : null;
  const name = data.name?.trim() || defaultName(data.cadence, project.name);
  const fields = {
    project_id: project.id,
    preset_id: data.presetId ?? null,
    values: json(values) ?? '{}',
    dataset_id: data.datasetId ?? null,
    name,
    cadence: timing.cadence,
    days: json(timing.days) ?? '[]',
    day_of_month: timing.dayOfMonth,
    time: timing.time,
    timezone,
    credit_limit: data.creditLimit,
    email_on_fail: data.emailOnFail,
    email_csv: data.emailCsv,
    status: data.status,
    next_run_at: next,
    updated_at: ctx.now,
  };

  if (data.id) {
    const existing = await db
      .selectFrom('schedules')
      .select(['id', 'status', 'paused_at'])
      .where('id', '=', data.id)
      .where('user_id', '=', ctx.user.id)
      .executeTakeFirst();
    if (!existing) throw errors.notFound('That schedule');
    await db
      .updateTable('schedules')
      .set({
        ...fields,
        paused_at: data.status === 'paused' ? (existing.status === 'paused' ? existing.paused_at : ctx.now) : null,
      })
      .where('id', '=', data.id)
      .where('user_id', '=', ctx.user.id)
      .execute();
    return get(ctx, data.id);
  }
  const id = newId();
  await db
    .insertInto('schedules')
    .values({
      id,
      user_id: ctx.user.id,
      ...fields,
      paused_at: data.status === 'paused' ? ctx.now : null,
      locked_until: null,
      last_run_id: null,
      created_at: ctx.now,
    })
    .execute();
  return get(ctx, id);
}

/** Pauses or resumes a schedule. Resuming picks the next run from now. */
export async function setStatus(ctx: Ctx, id: string, status: 'on' | 'paused'): Promise<Schedule> {
  const current = await get(ctx, id);
  await db
    .updateTable('schedules')
    .set({
      status,
      paused_at: status === 'paused' ? ctx.now : null,
      next_run_at: status === 'on' ? nextRunAfter(current, ctx.now) : null,
      updated_at: ctx.now,
    })
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .execute();
  return get(ctx, id);
}

export async function remove(ctx: Ctx, id: string): Promise<void> {
  await get(ctx, id);
  await db.deleteFrom('schedules').where('id', '=', id).where('user_id', '=', ctx.user.id).execute();
}

/** The next three runs of a schedule, or of timing that isn't saved yet (the editor's live list). */
export async function nextRuns(
  ctx: Ctx,
  timing: { cadence: Schedule['cadence']; days: number[]; dayOfMonth: number | null; time: string; timezone: string },
  count = 3,
): Promise<NextRun[]> {
  const zone = validTimeZone(timing.timezone) ?? ctx.user.timezone;
  return timingRuns({ ...timing, timezone: zone }, ctx.now, count).map((at) => describeNext(at, ctx.now, zone));
}
