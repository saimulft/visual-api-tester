import { db } from '../db';
import { zonedParts } from '../jobs/time';
import type { Ctx } from './context';

/**
 * Settings › Usage: this week's API requests, rows stored, credits used and AI tokens, per day in the person's
 * time zone, from runs, dataset_rows and ai_usage.
 */
export type UsageDay = {
  /** "2026-11-17", the person's local date. */
  date: string;
  requests: number;
  rows: number;
  credits: number;
  aiTokens: number;
};

export type UsageWeek = {
  days: UsageDay[];
  totals: Omit<UsageDay, 'date'> & { runs: number; setups: number };
  /** AI tokens by purpose: setups and key tests. */
  ai: { setup: number; test: number };
};

const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (at: number, tz: string) => {
  const p = zonedParts(at, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

/** How many HTTP requests a run made (its request log is a JSON list). */
function requestCount(text: string | null): number {
  if (!text) return 0;
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

export async function week(ctx: Ctx): Promise<UsageWeek> {
  const tz = ctx.user.timezone || 'UTC';
  const since = ctx.now - 7 * DAY_MS;
  const keys = Array.from({ length: 7 }, (_, i) => dayKey(ctx.now - (6 - i) * DAY_MS, tz));
  const days = new Map<string, UsageDay>(
    keys.map((date) => [date, { date, requests: 0, rows: 0, credits: 0, aiTokens: 0 }]),
  );
  const add = (at: number, field: keyof Omit<UsageDay, 'date'>, n: number) => {
    const day = days.get(dayKey(at, tz));
    if (day) day[field] += n;
  };

  const [runRows, rowRows, aiRows, setupCount] = await Promise.all([
    db
      .selectFrom('runs')
      .select(['started_at', 'credits', 'requests'])
      .where('user_id', '=', ctx.user.id)
      .where('started_at', '>=', since)
      .execute(),
    db
      .selectFrom('dataset_rows')
      .innerJoin('datasets', 'datasets.id', 'dataset_rows.dataset_id')
      .select(['dataset_rows.created_at as at'])
      .where('datasets.user_id', '=', ctx.user.id)
      .where('dataset_rows.created_at', '>=', since)
      .execute(),
    db
      .selectFrom('ai_usage')
      .select(['at', 'tokens_in', 'tokens_out', 'purpose'])
      .where('user_id', '=', ctx.user.id)
      .where('at', '>=', since)
      .execute(),
    db
      .selectFrom('setups')
      .innerJoin('projects', 'projects.id', 'setups.project_id')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('projects.user_id', '=', ctx.user.id)
      .where('setups.created_at', '>=', since)
      .executeTakeFirstOrThrow(),
  ]);

  const ai = { setup: 0, test: 0 };
  for (const r of runRows) {
    add(Number(r.started_at), 'requests', requestCount(r.requests));
    add(Number(r.started_at), 'credits', Number(r.credits));
  }
  for (const r of rowRows) add(Number(r.at), 'rows', 1);
  for (const r of aiRows) {
    const tokens = Number(r.tokens_in) + Number(r.tokens_out);
    add(Number(r.at), 'aiTokens', tokens);
    ai[r.purpose] += tokens;
  }
  const list = [...days.values()];
  const sum = (field: keyof Omit<UsageDay, 'date'>) => list.reduce((n, d) => n + d[field], 0);
  return {
    days: list,
    totals: {
      requests: sum('requests'),
      rows: sum('rows'),
      credits: sum('credits'),
      aiTokens: sum('aiTokens'),
      runs: runRows.length,
      setups: Number(setupCount.n),
    },
    ai,
  };
}
