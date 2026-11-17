import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '../auth/sessions';
import { db, newId } from '../db';
import { createTestDb } from '../db/testing';
import { resetRateLimits } from '../http/rate-limit';
import * as apiKeys from './api-keys';
import * as auth from './auth';
import { ctxFor, type Ctx } from './context';
import * as projects from './projects';
import * as settings from './settings';
import * as usage from './usage';
import * as users from './users';

const t = await createTestDb();
afterAll(() => t.close());

let nadia: Ctx;

beforeAll(async () => {
  resetRateLimits();
  const a = await auth.signUp(
    { email: 'nadia@brightfield.com.au', password: 'field-notes-2026!' },
    {
      ip: '203.0.113.60',
      userAgent: 'vitest',
    },
  );
  await db.updateTable('users').set({ email_checked_at: Date.now(), timezone: 'Australia/Sydney' }).execute();
  nadia = ctxFor(await db.selectFrom('users').selectAll().where('id', '=', a.user.id).executeTakeFirstOrThrow());
});

describe('Settings', () => {
  it('saves the profile and alert fields', async () => {
    const me = await settings.updateProfile(nadia, {
      name: 'Nadia Rahman',
      workspace: 'Brightfield',
      alertEmail: 'Alerts@Brightfield.com.au',
      alertsMuted: true,
    });
    expect(me).toMatchObject({
      name: 'Nadia Rahman',
      workspace: 'Brightfield',
      alertEmail: 'alerts@brightfield.com.au',
      alertsMuted: true,
    });
    await expect(settings.updateProfile(nadia, { alertEmail: 'not an email' })).rejects.toMatchObject({ status: 422 });
    expect((await settings.updateProfile(nadia, { alertEmail: null })).alertEmail).toBeNull();
  });

  it('signs out every other session and keeps this one', async () => {
    const here = await createSession(nadia.user.id);
    await createSession(nadia.user.id);
    await settings.signOutEverywhere(nadia, here.token);
    const left = await db.selectFrom('sessions').select('id').where('user_id', '=', nadia.user.id).execute();
    expect(left).toHaveLength(1);
  });

  it('lists vault keys with the projects using them, and APIs that need no key', async () => {
    const key = await apiKeys.create(nadia, {
      apiSlug: 'coresignal',
      apiName: 'CoreSignal',
      host: 'api.coresignal.com',
      secret: 'cs-live-abcdef9876',
    });
    await projects.create(nadia, {
      name: 'AU software companies',
      apiName: 'CoreSignal',
      apiSlug: 'coresignal',
      apiKeyId: key.id,
    });
    await projects.create(nadia, { name: 'Store weather', apiName: 'Open-Meteo', apiSlug: 'open-meteo' });
    const rows = await settings.apiKeyRows(nadia);
    expect(rows.keys).toMatchObject([{ apiName: 'CoreSignal', projects: 1, monogram: 'CS', last4: '9876' }]);
    expect(JSON.stringify(rows)).not.toContain('abcdef');
    expect(rows.keyless).toEqual([{ apiSlug: 'open-meteo', apiName: 'Open-Meteo', monogram: 'OM', projects: 1 }]);
  });

  it('counts this week’s AI tokens per day in the person’s time zone', async () => {
    const at = Date.now();
    await db
      .insertInto('ai_usage')
      .values([
        {
          id: newId(),
          user_id: nadia.user.id,
          ai_key_id: null,
          provider: 'anthropic',
          model: 'claude-sonnet-5-5',
          purpose: 'setup',
          tokens_in: 1200,
          tokens_out: 300,
          ok: true,
          error: null,
          at,
          created_at: at,
        },
        {
          id: newId(),
          user_id: nadia.user.id,
          ai_key_id: null,
          provider: 'anthropic',
          model: 'claude-sonnet-5-5',
          purpose: 'test',
          tokens_in: 30,
          tokens_out: 2,
          ok: true,
          error: null,
          at,
          created_at: at,
        },
        // Older than a week: left out.
        {
          id: newId(),
          user_id: nadia.user.id,
          ai_key_id: null,
          provider: 'anthropic',
          model: 'claude-sonnet-5-5',
          purpose: 'setup',
          tokens_in: 9999,
          tokens_out: 1,
          ok: true,
          error: null,
          at: at - 9 * 86_400_000,
          created_at: at,
        },
      ])
      .execute();
    const week = await usage.week({ ...nadia, now: at });
    expect(week.days).toHaveLength(7);
    expect(week.totals.aiTokens).toBe(1532);
    expect(week.ai).toEqual({ setup: 1500, test: 32 });
    expect(week.days.at(-1)!.aiTokens).toBe(1532);
    expect(week.totals).toMatchObject({ requests: 0, rows: 0, credits: 0 });
  });

  it('counts what an account deletion removes', async () => {
    expect(await settings.counts(nadia)).toEqual({ projects: 2, datasets: 0, schedules: 0 });
    expect((await users.get(nadia)).email).toBe('nadia@brightfield.com.au');
  });
});
