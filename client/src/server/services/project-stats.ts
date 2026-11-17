import { sql } from 'kysely';
import { db, dialect } from '../db';
import type { Ctx } from './context';

/**
 * The Projects home's numbers: requests this week (and how many were retried), rows stored across
 * datasets, and the next pull. Per project: rows stored and its schedule, for the cards.
 */
export type ProjectStats = {
  requestsThisWeek: number;
  retriedThisWeek: number;
  rowsStored: number;
  datasets: number;
  nextPull: { at: number; projectId: string; projectName: string; timezone: string } | null;
  perProject: Record<
    string,
    {
      rows: number;
      schedule: {
        id: string;
        name: string;
        cadence: 'hourly' | 'daily' | 'weekly' | 'monthly';
        days: number[];
        dayOfMonth: number | null;
        time: string;
        timezone: string;
        status: 'on' | 'paused';
      } | null;
      lastStatus: string | null;
    }
  >;
};

const WEEK = 7 * 24 * 60 * 60 * 1000;

export async function forUser(ctx: Ctx): Promise<ProjectStats> {
  const since = ctx.now - WEEK;
  const length =
    dialect === 'postgres' ? sql<number>`json_array_length(requests::json)` : sql<number>`json_array_length(requests)`;
  const week = await db
    .selectFrom('runs')
    .select((eb) => [eb.fn.sum<number>(length).as('calls'), eb.fn.sum<number>('retries').as('retries')])
    .where('user_id', '=', ctx.user.id)
    .where('started_at', '>=', since)
    .executeTakeFirst();
  const retriedRuns = await db
    .selectFrom('runs')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('user_id', '=', ctx.user.id)
    .where('started_at', '>=', since)
    .where('retries', '>', 0)
    .executeTakeFirst();

  const datasetRows = await db
    .selectFrom('datasets')
    .select(['project_id', (eb) => eb.fn.sum<number>('rows').as('rows'), (eb) => eb.fn.countAll<number>().as('n')])
    .where('user_id', '=', ctx.user.id)
    .groupBy('project_id')
    .execute();

  const schedules = await db
    .selectFrom('schedules')
    .innerJoin('projects', 'projects.id', 'schedules.project_id')
    .leftJoin('runs', 'runs.id', 'schedules.last_run_id')
    .select([
      'schedules.id',
      'schedules.project_id',
      'schedules.name',
      'schedules.cadence',
      'schedules.days',
      'schedules.day_of_month',
      'schedules.time',
      'schedules.timezone',
      'schedules.status',
      'schedules.next_run_at',
      'projects.name as project_name',
      'runs.status as last_status',
    ])
    .where('schedules.user_id', '=', ctx.user.id)
    .where('projects.archived_at', 'is', null)
    .orderBy('schedules.created_at')
    .execute();

  const lastRuns = await db
    .selectFrom('runs')
    .select(['project_id', 'status', 'started_at'])
    .where('user_id', '=', ctx.user.id)
    .where('trigger', '!=', 'test')
    .orderBy('started_at', 'desc')
    .limit(200)
    .execute();

  const perProject: ProjectStats['perProject'] = {};
  const entry = (id: string) => (perProject[id] ??= { rows: 0, schedule: null, lastStatus: null });
  for (const d of datasetRows) entry(d.project_id).rows = Number(d.rows ?? 0);
  for (const run of lastRuns)
    if (entry(run.project_id).lastStatus === null) entry(run.project_id).lastStatus = run.status;
  let nextPull: ProjectStats['nextPull'] = null;
  for (const s of schedules) {
    const e = entry(s.project_id);
    if (!e.schedule || (e.schedule.status === 'paused' && s.status === 'on'))
      e.schedule = {
        id: s.id,
        name: s.name,
        cadence: s.cadence,
        days: JSON.parse(s.days || '[]'),
        dayOfMonth: s.day_of_month,
        time: s.time,
        timezone: s.timezone,
        status: s.status,
      };
    if (s.status === 'on' && s.next_run_at !== null && (!nextPull || Number(s.next_run_at) < nextPull.at))
      nextPull = {
        at: Number(s.next_run_at),
        projectId: s.project_id,
        projectName: s.project_name,
        timezone: s.timezone,
      };
  }

  return {
    requestsThisWeek: Number(week?.calls ?? 0),
    retriedThisWeek: Number(retriedRuns?.n ?? 0),
    rowsStored: datasetRows.reduce((sum, d) => sum + Number(d.rows ?? 0), 0),
    datasets: datasetRows.reduce((sum, d) => sum + Number(d.n ?? 0), 0),
    nextPull,
    perProject,
  };
}

/** Who set a project up, for the workspace's AI card: the newest finished setup. */
export type SetupSummary = {
  via: 'builtin' | 'mcp';
  /** "Claude", "ChatGPT", "your AI". */
  who: string;
  pagesRead: number;
  controlsBuilt: number;
  at: number | null;
};

function aiName(model: string | null): string {
  const m = (model ?? '').toLowerCase();
  if (m.includes('claude')) return 'Claude';
  if (m.includes('gpt') || /^o\d/.test(m)) return 'ChatGPT';
  if (m.includes('gemini')) return 'Gemini';
  return model || 'your AI';
}

export async function setupOf(
  ctx: Ctx,
  projectId: string,
  mcpClient: string | null = null,
): Promise<SetupSummary | null> {
  const found = await db
    .selectFrom('setups')
    .innerJoin('projects', 'projects.id', 'setups.project_id')
    .select([
      'setups.via',
      'setups.model',
      'setups.pages_read',
      'setups.controls_built',
      'setups.finished_at',
      'setups.created_at',
    ])
    .where('projects.user_id', '=', ctx.user.id)
    .where('setups.project_id', '=', projectId)
    .where('setups.status', '=', 'done')
    .orderBy('setups.created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!found) return null;
  return {
    via: found.via,
    who: found.via === 'mcp' ? (mcpClient ?? 'your AI') : aiName(found.model),
    pagesRead: Number(found.pages_read),
    controlsBuilt: Number(found.controls_built),
    at: found.finished_at === null ? Number(found.created_at) : Number(found.finished_at),
  };
}

/** The values each project last ran with, for the cards' mini strip. */
export async function latestValues(ctx: Ctx): Promise<Record<string, string>> {
  const rows = await db
    .selectFrom('runs')
    .select(['project_id', 'values'])
    .where('user_id', '=', ctx.user.id)
    .where('trigger', '!=', 'test')
    .orderBy('started_at', 'desc')
    .limit(300)
    .execute();
  const out: Record<string, string> = {};
  for (const row of rows) if (!(row.project_id in out)) out[row.project_id] = row.values;
  return out;
}
