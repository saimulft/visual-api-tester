import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { claim, release } from './claim';
import {
  bool,
  createKysely,
  dialect,
  dialectOf,
  json,
  likePattern,
  newId,
  now,
  parseJson,
  sqlitePath,
  transaction,
} from './index';
import { createTestDb } from './testing';

const t = await createTestDb();
const person = (id: string, extra: { alerts_muted?: boolean } = {}) => ({
  id,
  email: `${id}@dialed.test`,
  name: 'Test',
  password_hash: null,
  email_checked_at: null,
  workspace: 'Test',
  timezone: 'UTC',
  mcp_handle: id,
  alert_email: null,
  alerts_muted: extra.alerts_muted ?? false,
  created_at: now(),
  updated_at: now(),
});

beforeAll(async () => {
  await t.db
    .insertInto('jobs')
    .values({ name: 'race', next_run_at: now(), created_at: now(), updated_at: now() })
    .execute();
});
afterAll(() => t.close());

describe('helpers', () => {
  it('picks the dialect from the URL', () => {
    expect(dialectOf(undefined)).toBe('sqlite');
    expect(dialectOf('file:./x.db')).toBe('sqlite');
    expect(dialectOf('postgres://a@b/c')).toBe('postgres');
    expect(dialectOf('postgresql://a@b/c')).toBe('postgres');
    expect(() => dialectOf('mysql://a')).toThrow(/DATABASE_URL/);
    expect(sqlitePath(undefined)).toBe('./.data/dialed.db');
    expect(sqlitePath('file:./.data/a.db')).toBe('./.data/a.db');
    expect(dialect).toBe(process.env.TEST_DB === 'postgres' ? 'postgres' : 'sqlite');
  });

  it('makes ids, times and JSON', () => {
    expect(newId()).not.toBe(newId());
    expect(now()).toBeGreaterThan(1.7e12);
    expect(json(undefined)).toBeNull();
    expect(json({ a: 1 })).toBe('{"a":1}');
    expect(parseJson(z.object({ a: z.number() }), '{"a":1}')).toEqual({ a: 1 });
    expect(parseJson(z.array(z.string()).nullable(), null)).toBeNull();
    expect(() => parseJson(z.object({ a: z.number() }), '{"a":"x"}')).toThrow();
    expect(likePattern('50%_off')).toBe('%50\\%\\_off%');
  });

  it('reads booleans the same on both databases', async () => {
    const id = newId();
    await t.db
      .insertInto('users')
      .values(person(id, { alerts_muted: true }))
      .execute();
    const row = await t.db
      .selectFrom('users')
      .select(['alerts_muted', 'created_at'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(bool(row.alerts_muted)).toBe(true);
    expect(typeof row.created_at).toBe('number');
    expect(bool(0)).toBe(false);
    expect(bool(false)).toBe(false);
  });

  it('rolls a transaction back, and db inside it is the transaction', async () => {
    const id = newId();
    await expect(
      transaction(async () => {
        await t.db.insertInto('users').values(person(id)).execute();
        // Nested calls join the outer transaction and see its rows.
        const inner = await transaction(() =>
          t.db.selectFrom('users').select('id').where('id', '=', id).executeTakeFirst(),
        );
        expect(inner?.id).toBe(id);
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    const after = await t.db.selectFrom('users').select('id').where('id', '=', id).executeTakeFirst();
    expect(after).toBeUndefined();
  });

  it('counts come back as numbers', async () => {
    const row = await t.db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    expect(typeof row.n).toBe('number');
  });
});

describe('claims', () => {
  it('lets exactly one of many racers win, across two connections', async () => {
    const other = createKysely(process.env.DATABASE_URL);
    try {
      const at = now();
      const racers = Array.from({ length: 10 }, (_, i) => claim('jobs', 'race', at + 60_000, at, i % 2 ? other : t.db));
      const wins = (await Promise.all(racers)).filter(Boolean);
      expect(wins).toHaveLength(1);
      // Still locked: a later claim before the lock runs out loses.
      expect(await claim('jobs', 'race', at + 120_000, at + 1_000)).toBe(false);
      // Once the lock has run out, the next claim wins.
      expect(await claim('jobs', 'race', at + 200_000, at + 61_000)).toBe(true);
      await release('jobs', 'race');
      expect(await claim('jobs', 'race', at + 300_000, at + 62_000)).toBe(true);
    } finally {
      await other.destroy();
    }
  });
});
