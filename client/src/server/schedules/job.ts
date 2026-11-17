import { columnsOf, csvCell, flattenRecord } from '@/contracts/rows';
import type { RunResult } from '@/contracts/runs';
import { ValuesSchema } from '@/contracts/spec';
import { bool, db, now, parseJson } from '../db';
import { claim } from '../db/claim';
import type { JobSpec } from '../jobs';
import { escapeHtml, trySend, type Mail } from '../mail';
import { recallRecords } from '../runner/results';
import { startRun } from '../runner/run';
import { ctxFor } from '../services/context';
import { nextRunAfter } from './timing';

/**
 * The schedules-due job. Every minute it claims each due schedule with one conditional update (common.md ›
 * Claims), so two servers or two ticks never run one twice; runs it with the trigger "schedule", saving
 * to its dataset under its own credit limit; sets its next run; and emails the person (to alert_email,
 * unless muted): a failed run, a run stopped at the limit, and the CSV when asked for.
 */
const LOCK_MS = 3 * 60 * 60 * 1000;
/** How long one tick waits for its runs before letting them finish on their own. */
const TICK_WAIT_MS = 50_000;
const STALE_RUN_MS = 3 * 60 * 60 * 1000;

const appUrl = () => (process.env.APP_URL || 'http://localhost:3300').replace(/\/$/, '');

type ScheduleRow = Awaited<ReturnType<typeof dueRows>>[number];

async function dueRows(at: number) {
  return db
    .selectFrom('schedules')
    .selectAll()
    .where('status', '=', 'on')
    .where('next_run_at', 'is not', null)
    .where('next_run_at', '<=', at)
    .where((eb) => eb.or([eb('locked_until', 'is', null), eb('locked_until', '<', at)]))
    .orderBy('next_run_at')
    .limit(50)
    .execute();
}

function card(title: string, lines: string[], button?: { label: string; url: string }) {
  const p = (t: string) =>
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#0b1f1c">${escapeHtml(t)}</p>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f6f5;font-family:'Plus Jakarta Sans',Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:28px;border-radius:20px;background:#ffffff;border:1px solid #e1e6e4">
<p style="margin:0 0 18px;font-weight:700;font-size:18px;color:#0b1f1c">dialed</p>
<h1 style="margin:0 0 14px;font-size:22px;color:#0b1f1c">${escapeHtml(title)}</h1>
${lines.map(p).join('\n')}${
    button
      ? `<p style="margin:22px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#0c8577;color:#ffffff;font-weight:600;text-decoration:none">${escapeHtml(button.label)}</a></p>`
      : ''
  }
<p style="margin:18px 0 0;font-size:13px;color:#55625f">Turn these emails off in Settings, under Alerts.</p>
</div></body></html>`;
  const text = [
    title,
    '',
    ...lines,
    ...(button ? ['', `${button.label}: ${button.url}`] : []),
    '',
    'Turn these emails off in Settings, under Alerts.',
  ].join('\n');
  return { html, text };
}

/** The mail for a failed or stopped run. */
export function alertMail(to: string, schedule: { id: string; name: string }, result: RunResult): Mail {
  const stopped = result.status === 'stopped';
  const title = stopped ? `${schedule.name} stopped before spending` : `${schedule.name} didn’t finish`;
  const { html, text } = card(
    title,
    [
      result.error?.text ?? (stopped ? 'It would have passed its credit limit.' : 'The run failed.'),
      stopped
        ? 'Nothing was spent. Raise the limit or ask for fewer records, and it runs again at its next time.'
        : 'It tries again at its next time. Run it now from Schedules once it’s fixed.',
    ],
    { label: 'Open the schedule', url: `${appUrl()}/schedules?id=${schedule.id}` },
  );
  return { to, subject: title, text, html };
}

/** The CSV of a run's rows, as an attachment. */
export function csvOf(records: unknown[]): string {
  const rows = records.map((r) => flattenRecord(r));
  const columns = columnsOf(rows.slice(0, 500));
  return [
    columns.map((c) => csvCell(c.label)).join(','),
    ...rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(',')),
  ].join('\r\n');
}

export function csvMail(
  to: string,
  schedule: { id: string; name: string },
  result: RunResult,
  records: unknown[],
): Mail & { attachments: { filename: string; content: string; contentType: string }[] } {
  const title = `New rows from ${schedule.name}`;
  const fileName = `${
    schedule.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'rows'
  }.csv`;
  const { html, text } = card(
    title,
    [
      `${result.rows.toLocaleString('en-US')} rows came back${result.datasetId ? `, ${result.newRows.toLocaleString('en-US')} of them new` : ''}. The CSV is attached as ${fileName}.`,
    ],
    { label: 'Open saved data', url: `${appUrl()}/data${result.datasetId ? `?id=${result.datasetId}` : ''}` },
  );
  return {
    to,
    subject: title,
    text,
    html,
    attachments: [{ filename: fileName, content: csvOf(records), contentType: 'text/csv' }],
  };
}

/** Runs one claimed schedule and settles it. Returns the run's result. */
export async function runSchedule(schedule: ScheduleRow, opts: { keepNext?: boolean } = {}): Promise<RunResult | null> {
  const user = await db.selectFrom('users').selectAll().where('id', '=', schedule.user_id).executeTakeFirst();
  if (!user) return null;
  const ctx = ctxFor(user);
  let result: RunResult | null = null;
  try {
    const { runId, done } = await startRun(ctx, schedule.project_id, {
      values: parseJson(ValuesSchema.catch({}), schedule.values),
      presetId: schedule.preset_id,
      trigger: 'schedule',
      datasetId: schedule.dataset_id,
      scheduleId: schedule.id,
      creditLimit: Number(schedule.credit_limit),
    });
    await db.updateTable('schedules').set({ last_run_id: runId }).where('id', '=', schedule.id).execute();
    result = await done;
  } catch (error) {
    // A run that couldn't start at all (the project was set up again, the daily cap): note it and move on.
    console.error(`[schedules] ${schedule.id} couldn’t start`, error instanceof Error ? error.message : error);
  } finally {
    const at = now();
    const next = opts.keepNext
      ? schedule.next_run_at
      : nextRunAfter(
          {
            cadence: schedule.cadence,
            days: JSON.parse(schedule.days || '[]'),
            dayOfMonth: schedule.day_of_month,
            time: schedule.time,
            timezone: schedule.timezone,
          },
          Math.max(at, Number(schedule.next_run_at ?? 0)),
        );
    await db
      .updateTable('schedules')
      .set({ locked_until: null, next_run_at: next, updated_at: at })
      .where('id', '=', schedule.id)
      .execute();
  }

  if (result && !bool(user.alerts_muted)) {
    const to = user.alert_email || user.email;
    const named = { id: schedule.id, name: schedule.name };
    if ((result.status === 'failed' && bool(schedule.email_on_fail)) || result.status === 'stopped')
      await trySend(alertMail(to, named, result));
    if (bool(schedule.email_csv) && result.rows > 0 && result.status !== 'failed') {
      const records = recallRecords(user.id, result.runId) ?? result.sample;
      await trySend(csvMail(to, named, result, records) as Mail);
    }
  }
  return result;
}

/** Claims and runs every due schedule. With `wait`, settles only when all of them have (tests). */
export async function runDueSchedules(opts: { wait?: boolean; at?: number } = {}): Promise<string[]> {
  const at = opts.at ?? now();
  await db
    .updateTable('runs')
    .set({
      status: 'failed',
      error_code: 'interrupted',
      error_text: 'The server restarted during this run.',
      finished_at: at,
    })
    .where('status', '=', 'running')
    .where('started_at', '<', at - STALE_RUN_MS)
    .execute();

  const started: Promise<RunResult | null>[] = [];
  const ids: string[] = [];
  for (const schedule of await dueRows(at)) {
    if (!(await claim('schedules', schedule.id, at + LOCK_MS, at))) continue;
    ids.push(schedule.id);
    started.push(runSchedule(schedule).catch(() => null));
  }
  const all = Promise.allSettled(started);
  if (opts.wait) await all;
  else await Promise.race([all, new Promise((resolve) => setTimeout(resolve, TICK_WAIT_MS).unref?.())]);
  return ids;
}

export const scheduleJobs: JobSpec[] = [
  {
    name: 'schedules-due',
    everyMinutes: 1,
    lockMinutes: 5,
    run: async () => {
      await runDueSchedules();
    },
  },
];
