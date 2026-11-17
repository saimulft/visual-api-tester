import type { ApiKey } from '@/contracts/api-keys';
import { deleteUserSessions } from '../auth/sessions';
import { db } from '../db';
import { directoryEntry } from '../discovery/directory';
import { guardedFetch, GuardError } from '../net/guarded-fetch';
import { testCall } from '../runner';
import * as apiKeys from './api-keys';
import { requireCheckedEmail, type Ctx } from './context';
import * as projects from './projects';
import * as users from './users';

/**
 * Settings (screen 10): the profile and alert fields on users, signing out everywhere, the API key vault as
 * Settings shows it (with the projects using each key), and "Test" for a saved API key.
 */
export const updateProfile = users.update;

/** Ends every session but this one. */
export async function signOutEverywhere(ctx: Ctx, keepToken: string): Promise<void> {
  await deleteUserSessions(ctx.user.id, keepToken);
}

export type ApiKeyRow = ApiKey & { projects: number; monogram: string; needsNoKey?: false };
/** An API a project uses without a key ("No key needed · 1 project"). */
export type KeylessApi = { apiSlug: string; apiName: string; monogram: string; projects: number };

/** The vault as Settings shows it: each key with the projects using it, then the APIs that need no key. */
export async function apiKeyRows(ctx: Ctx): Promise<{ keys: ApiKeyRow[]; keyless: KeylessApi[] }> {
  const [keys, list] = await Promise.all([apiKeys.list(ctx), projects.list(ctx)]);
  const rows = keys.map((key) => ({
    ...key,
    projects: list.filter((p) => p.apiKeyId === key.id).length,
    monogram:
      directoryEntry(key.apiSlug)?.monogram ??
      list.find((p) => p.apiKeyId === key.id)?.monogram ??
      key.apiName.slice(0, 2).toUpperCase(),
  }));
  const keyless = new Map<string, KeylessApi>();
  for (const p of list) {
    if (p.apiKeyId || !p.apiSlug) continue;
    const entry = directoryEntry(p.apiSlug);
    if (entry && entry.key.in !== 'none') continue;
    if (!entry && p.status !== 'ready') continue;
    const seen = keyless.get(p.apiSlug);
    if (seen) seen.projects++;
    else
      keyless.set(p.apiSlug, { apiSlug: p.apiSlug, apiName: p.apiName || p.name, monogram: p.monogram, projects: 1 });
  }
  return { keys: rows, keyless: [...keyless.values()] };
}

export type KeyTestOutcome = { ok: boolean; message: string; key: ApiKey };

/**
 * "Test" on a saved API key: a free test call on a set-up project that uses it, else the directory's free
 * check for that API. Nothing is spent either way.
 */
export async function testApiKey(ctx: Ctx, id: string): Promise<KeyTestOutcome> {
  requireCheckedEmail(ctx);
  const key = await apiKeys.get(ctx, id);
  const list = await projects.list(ctx);
  for (const summary of list.filter((p) => p.apiKeyId === id && p.status === 'ready')) {
    const project = await projects.get(ctx, summary.id);
    const free = project.spec?.endpoints.find((e) => e.free);
    if (!project.spec || !free) continue;
    const result = await testCall(ctx, project.id, free.id, {});
    return {
      ok: result.ok,
      message: result.ok
        ? `It works. ${key.apiName} answered in ${(result.ms / 1000).toFixed(1)} s.`
        : (result.error?.text ?? `${key.apiName} didn’t accept the call.`),
      key: await apiKeys.get(ctx, id),
    };
  }
  const entry = directoryEntry(key.apiSlug);
  const check = entry?.keyTest;
  if (entry && check && (entry.key.in === 'header' || entry.key.in === 'query')) {
    const secret = await apiKeys.secretFor(ctx, id, check.url);
    const url = new URL(check.url);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (entry.key.in === 'header') headers[entry.key.name] = `${entry.key.prefix ?? ''}${secret}`;
    else url.searchParams.set(entry.key.name, secret);
    if (check.body !== undefined) headers['content-type'] = 'application/json';
    let ok = false;
    let message: string;
    let creditsLeft: number | null = null;
    try {
      const res = await guardedFetch(
        url,
        { method: check.method, headers, body: check.body === undefined ? null : JSON.stringify(check.body) },
        { timeoutMs: 20_000, maxBytes: 2 * 1024 * 1024, maxRedirects: 0, secretHeaders: Object.keys(headers) },
      );
      ok = res.ok;
      const credits = check.creditsHeader ? Number(res.headers.get(check.creditsHeader)) : NaN;
      creditsLeft = Number.isFinite(credits) ? credits : null;
      message = ok
        ? `It works. ${entry.name} answered in ${(res.ms / 1000).toFixed(1)} s.`
        : res.status === 401 || res.status === 403
          ? `${entry.name} didn’t accept this key. Replace it with a new one.`
          : `${entry.name} answered ${res.status}.`;
    } catch (error) {
      message = error instanceof GuardError ? error.message : `${entry.name} couldn’t be reached.`;
    }
    const updated = await apiKeys.markTested(ctx, id, { ok, creditsLeft });
    return { ok, message, key: updated };
  }
  return {
    ok: true,
    message: 'There’s no free way to test this key yet. Your first run checks it.',
    key,
  };
}

/** How many of each thing the person has, for the delete warning. */
export async function counts(ctx: Ctx) {
  const n = async (table: 'projects' | 'datasets' | 'schedules') =>
    Number(
      (
        await db
          .selectFrom(table)
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('user_id', '=', ctx.user.id)
          .executeTakeFirstOrThrow()
      ).n,
    );
  return { projects: await n('projects'), datasets: await n('datasets'), schedules: await n('schedules') };
}
