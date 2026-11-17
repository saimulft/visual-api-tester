// Adapted from dl-cms/cms/src/server/jobs/index.ts (without per-site jobs; claims as in common.md)
import { claim } from '../db/claim';
import { db, now as nowMs } from '../db';
import { nextDailyRun } from './time';

/**
 * The job scheduler. Jobs register once; a one-minute tick (started from instrumentation.ts) runs the ones
 * that are due. Each job is a row in `jobs`. A server claims a due row with one conditional update on
 * locked_until (db/claim.ts), so two servers never run the same job, and a run cut off by a crash is picked
 * up again once its lock runs out.
 *
 *   registerJob({ name: 'sessions-prune', everyMinutes: 60 }, run)
 *   registerJob({ name: 'digest', dailyAt: { hour: 3, timeZone: 'UTC' } }, run)
 *
 * Schedules (chat B) register one job that runs every minute and claims each due schedule the same way.
 */
export type DailyTime = { hour: number; minute?: number; timeZone: string };

export type JobDef =
  | { name: string; everyMinutes: number; lockMinutes?: number }
  | { name: string; dailyAt: DailyTime; lockMinutes?: number };

export type JobContext = { name: string; now: Date };
export type JobRun = (context: JobContext) => Promise<void>;

/** A job with its run, as each feature's job list exports them (jobs/registry.ts). */
export type JobSpec = JobDef & { run: JobRun };

export const TICK_MS = 60_000;
const DEFAULT_LOCK_MINUTES = 30;

type Registered = { def: JobDef; run: JobRun };
type State = {
  jobs: Map<string, Registered>;
  timer: ReturnType<typeof setInterval> | null;
  ticking: Promise<void> | null;
};

const globals = globalThis as unknown as { __dialedJobs?: State };
const state: State = (globals.__dialedJobs ??= { jobs: new Map(), timer: null, ticking: null });

export function registerJob(def: JobDef, run: JobRun) {
  state.jobs.set(def.name, { def, run });
}

/** Forgets every job (tests). */
export function clearJobs() {
  state.jobs.clear();
}

export function registeredJobs(): string[] {
  return [...state.jobs.keys()];
}

/** When the job runs next after `now`. */
export function nextRun(def: JobDef, now: Date): Date {
  if ('everyMinutes' in def) return new Date(now.getTime() + def.everyMinutes * 60_000);
  return nextDailyRun(now, def.dailyAt.hour, def.dailyAt.minute ?? 0, def.dailyAt.timeZone);
}

const lockMs = (def: JobDef) => (def.lockMinutes ?? DEFAULT_LOCK_MINUTES) * 60_000;

/** Makes the row each registered job needs. A new job is due at once. */
async function ensureRows(at: number) {
  const existing = new Set((await db.selectFrom('jobs').select('name').execute()).map((r) => r.name));
  for (const name of state.jobs.keys())
    if (!existing.has(name))
      await db
        .insertInto('jobs')
        .values({ name, next_run_at: at, created_at: at, updated_at: at })
        .onConflict((oc) => oc.column('name').doNothing())
        .execute();
}

async function execute(name: string, opts: { keepSchedule: boolean }) {
  const job = state.jobs.get(name)!;
  const started = new Date();
  let error: string | null = null;
  try {
    await job.run({ name, now: started });
  } catch (e) {
    error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    console.error(`[jobs] ${name} failed`, e);
  }
  const at = nowMs();
  await db
    .updateTable('jobs')
    .set({
      locked_until: null,
      last_status: error ? 'failed' : 'ok',
      last_error: error,
      updated_at: at,
      ...(opts.keepSchedule ? {} : { next_run_at: nextRun(job.def, new Date(at)).getTime() }),
    })
    .where('name', '=', name)
    .execute();
  return { ok: !error, error };
}

/** Runs every due job once. One tick at a time per process. */
export function tickJobs(): Promise<void> {
  if (state.ticking) return state.ticking;
  state.ticking = (async () => {
    try {
      if (!state.jobs.size) return;
      const at = nowMs();
      await ensureRows(at);
      const due = await db
        .selectFrom('jobs')
        .select('name')
        .where('next_run_at', '<=', at)
        .where('name', 'in', [...state.jobs.keys()])
        .where((eb) => eb.or([eb('locked_until', 'is', null), eb('locked_until', '<', at)]))
        .orderBy('next_run_at')
        .execute();
      for (const { name } of due) {
        const job = state.jobs.get(name);
        if (!job) continue;
        const t = nowMs();
        if (!(await claim('jobs', name, t + lockMs(job.def), t))) continue;
        await execute(name, { keepSchedule: false });
      }
    } catch (error) {
      console.error('[jobs] tick failed', error);
    } finally {
      state.ticking = null;
    }
  })();
  return state.ticking;
}

export class JobBusyError extends Error {
  constructor(name: string) {
    super(`${name} is already running. Try again in a few minutes.`);
    this.name = 'JobBusyError';
  }
}

/**
 * Runs a job now, under the same lock as the schedule (it doesn't move the next scheduled run). Throws when
 * another run of it holds the lock, or when it fails.
 */
export async function runJobNow(name: string) {
  const job = state.jobs.get(name);
  if (!job) throw new Error(`No job "${name}" is registered.`);
  const at = nowMs();
  await ensureRows(at);
  if (!(await claim('jobs', name, at + lockMs(job.def), at))) throw new JobBusyError(name);
  const result = await execute(name, { keepSchedule: true });
  if (!result.ok) throw new Error(result.error ?? `${name} failed.`);
}

/** Registers every feature's jobs and starts the one-minute tick, once per process. */
export async function ensureJobs() {
  if (state.timer) return;
  const { allJobs } = await import('./registry');
  for (const { run, ...def } of allJobs()) registerJob(def as JobDef, run);
  if (process.env.VITEST) return;
  state.timer = setInterval(() => void tickJobs(), TICK_MS);
  state.timer.unref?.();
  setTimeout(() => void tickJobs(), 5_000).unref?.();
}

/** Stops the tick (tests). */
export function stopJobs() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

export { nextDailyRun, offsetAt, validTimeZone, zonedParts, zonedToUtc } from './time';
