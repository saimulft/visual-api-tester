import { checkSpec, type ApiSpec } from '@/contracts/spec';
import { hashPassword } from '../auth/passwords';
import { db, dialect, dialectOf, newId, now } from '../db';
import { ctxFor } from '../services/context';
import * as projects from '../services/projects';
import { freeHandle } from '../services/users';
import coresignal from './specs/coresignal.json';
import hackerNews from './specs/hacker-news.json';
import openMeteo from './specs/open-meteo.json';

/**
 * The seed: two people and three ready projects, each from a worked spec in ./specs. Safe to run again: it
 * updates the people and adds only the projects that are missing. Chat B adds runs, datasets and schedules on
 * top with scripts/seed-data.ts.
 */
export const SEED_PEOPLE = [
  {
    email: 'nadia@dialed.test',
    name: 'Nadia Rahman',
    workspace: 'Brightfield',
    timezone: 'Australia/Sydney',
    checked: true,
  },
  { email: 'new@dialed.test', name: '', workspace: 'Dialed', timezone: 'Australia/Sydney', checked: false },
] as const;

export const SEED_PROJECTS: { name: string; monogram: string; brief: string; creditLimit: number; spec: unknown }[] = [
  {
    name: 'Store weather',
    monogram: 'OM',
    brief: 'The daily forecast for our Sydney, Melbourne and Brisbane stores: highs, lows and rain for the week ahead.',
    creditLimit: 0,
    spec: openMeteo,
  },
  {
    name: 'AI launch posts',
    monogram: 'HN',
    brief: 'Show HN posts about AI launches with at least 50 points, newest first.',
    creditLimit: 0,
    spec: hackerNews,
  },
  {
    name: 'AU software companies',
    monogram: 'CS',
    brief: 'Australian software companies with 50 to 200 people. Keep the name, website, size and city.',
    creditLimit: 1000,
    spec: coresignal,
  },
];

/** Refuses anything but a local database: unset, a file, or Postgres on 127.0.0.1 or localhost. */
export function assertLocalDatabase(url: string | undefined = process.env.DATABASE_URL) {
  if (dialectOf(url) === 'sqlite') return;
  const host = new URL(url!).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1' && host !== '[::1]')
    throw new Error(`The seed only runs on a local database (a file or 127.0.0.1), not ${host}.`);
}

export async function seed(password: string, log: (line: string) => void = console.log) {
  assertLocalDatabase();
  if (password.length < 12) throw new Error('SEED_PASSWORD must be 12 or more characters.');
  const passwordHash = await hashPassword(password);
  const at = now();
  const ids: Record<string, string> = {};
  for (const person of SEED_PEOPLE) {
    const existing = await db.selectFrom('users').select('id').where('email', '=', person.email).executeTakeFirst();
    const values = {
      name: person.name,
      password_hash: passwordHash,
      email_checked_at: person.checked ? at : null,
      workspace: person.workspace,
      timezone: person.timezone,
      updated_at: at,
    };
    if (existing) {
      await db.updateTable('users').set(values).where('id', '=', existing.id).execute();
      ids[person.email] = existing.id;
    } else {
      const id = newId();
      await db
        .insertInto('users')
        .values({
          id,
          email: person.email,
          mcp_handle: await freeHandle(),
          alert_email: null,
          alerts_muted: false,
          created_at: at,
          ...values,
        })
        .execute();
      ids[person.email] = id;
    }
    log(`[seed] ${person.email}${person.checked ? '' : ' (email not checked)'}`);
  }

  const nadia = await db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', ids['nadia@dialed.test'])
    .executeTakeFirstOrThrow();
  const ctx = ctxFor(nadia);
  const have = new Set((await projects.list(ctx)).map((p) => p.name));
  for (const item of SEED_PROJECTS) {
    const checked = checkSpec(item.spec);
    if (!checked.ok)
      throw new Error(`${item.name}: ${checked.problems.map((p) => `${p.path} ${p.message}`).join('; ')}`);
    if (have.has(item.name)) {
      log(`[seed] project "${item.name}" is already there`);
      continue;
    }
    const spec: ApiSpec = checked.spec;
    const project = await projects.create(ctx, {
      name: item.name,
      apiName: spec.api.name,
      apiSlug: spec.api.slug,
      monogram: item.monogram,
      docsUrl: spec.api.docsUrl,
      brief: item.brief,
      setupVia: 'builtin',
      creditLimit: item.creditLimit,
    });
    await projects.saveSpec(ctx, project.id, spec, { author: 'ai', note: 'Seed: worked example' });
    log(`[seed] project "${item.name}" (${spec.api.name}), ready`);
  }
  log(`[seed] done on ${dialect}`);
  return ids;
}
