import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { createTestDb } from '../db/testing';
import {
  clearJobs,
  JobBusyError,
  nextDailyRun,
  nextRun,
  registerJob,
  runJobNow,
  tickJobs,
  validTimeZone,
} from './index';

const t = await createTestDb();
afterAll(() => t.close());
beforeEach(async () => {
  clearJobs();
  await db.deleteFrom('jobs').execute();
});

describe('jobs', () => {
  it('runs a due job once per tick, then schedules it again', async () => {
    let runs = 0;
    registerJob({ name: 'count', everyMinutes: 10 }, async () => {
      runs++;
    });
    await Promise.all([tickJobs(), tickJobs()]);
    expect(runs).toBe(1);
    const row = await db.selectFrom('jobs').selectAll().where('name', '=', 'count').executeTakeFirstOrThrow();
    expect(row.last_status).toBe('ok');
    expect(row.locked_until).toBeNull();
    expect(row.next_run_at).toBeGreaterThan(Date.now() + 9 * 60_000);
    await tickJobs();
    expect(runs).toBe(1);
  });

  it('records a failure and keeps going', async () => {
    registerJob({ name: 'boom', everyMinutes: 5 }, async () => {
      throw new Error('it broke');
    });
    await tickJobs();
    const row = await db.selectFrom('jobs').selectAll().where('name', '=', 'boom').executeTakeFirstOrThrow();
    expect(row.last_status).toBe('failed');
    expect(row.last_error).toBe('it broke');
  });

  it('runJobNow refuses while another run holds the lock', async () => {
    let release: () => void = () => {};
    registerJob({ name: 'slow', everyMinutes: 60 }, () => new Promise<void>((resolve) => (release = resolve)));
    const first = runJobNow('slow');
    await new Promise((r) => setTimeout(r, 50));
    await expect(runJobNow('slow')).rejects.toBeInstanceOf(JobBusyError);
    release();
    await first;
  });

  it('works out daily times in a zone', () => {
    const now = new Date('2026-11-17T10:00:00Z'); // 21:00 in Sydney (UTC+11)
    expect(nextDailyRun(now, 9, 0, 'Australia/Sydney').toISOString()).toBe('2026-11-17T22:00:00.000Z');
    expect(nextRun({ name: 'x', dailyAt: { hour: 11, timeZone: 'UTC' } }, now).toISOString()).toBe(
      '2026-11-17T11:00:00.000Z',
    );
    expect(validTimeZone('Mars/Base')).toBeNull();
  });

  beforeAll(() => clearJobs());
});
