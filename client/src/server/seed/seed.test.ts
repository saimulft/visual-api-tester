import { afterAll, describe, expect, it } from 'vitest';
import { db } from '../db';
import { createTestDb } from '../db/testing';
import { ctxFor } from '../services/context';
import * as projects from '../services/projects';
import { assertLocalDatabase, seed } from './index';

const t = await createTestDb();
afterAll(() => t.close());

describe('seed', () => {
  it('refuses a remote database', () => {
    expect(() => assertLocalDatabase('postgres://u:p@5.189.129.139:5432/db')).toThrow(/local database/);
    expect(() => assertLocalDatabase('postgresql://postgres@127.0.0.1:5530/postgres')).not.toThrow();
    expect(() => assertLocalDatabase(undefined)).not.toThrow();
  });

  it('loads two people and three ready projects, and runs again safely', async () => {
    const ids = await seed('seed-password-1234', () => {});
    await seed('seed-password-1234', () => {});
    const nadia = await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', ids['nadia@dialed.test'])
      .executeTakeFirstOrThrow();
    expect(nadia.workspace).toBe('Brightfield');
    expect(nadia.email_checked_at).not.toBeNull();
    const fresh = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', 'new@dialed.test')
      .executeTakeFirstOrThrow();
    expect(fresh.email_checked_at).toBeNull();
    const list = await projects.list(ctxFor(nadia));
    expect(list.map((p) => p.name).sort()).toEqual(['AI launch posts', 'AU software companies', 'Store weather']);
    for (const summary of list) {
      const project = await projects.get(ctxFor(nadia), summary.id);
      expect(project.status).toBe('ready');
      expect(project.spec).not.toBeNull();
      expect(project.apiKeyId).toBeNull();
    }
  });
});
