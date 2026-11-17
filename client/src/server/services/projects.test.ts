import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import coresignal from '../seed/specs/coresignal.json';
import { db } from '../db';
import { createTestDb } from '../db/testing';
import { resetRateLimits } from '../http/rate-limit';
import { seal, unseal } from '../secrets';
import * as apiKeys from './api-keys';
import * as auth from './auth';
import { ctxFor, type Ctx } from './context';
import * as projects from './projects';

const t = await createTestDb();
afterAll(() => t.close());

let nadia: Ctx;
let other: Ctx;
const meta = { ip: '203.0.113.10', userAgent: 'vitest' };

beforeAll(async () => {
  resetRateLimits();
  const a = await auth.signUp({ email: 'nadia@brightfield.com.au', password: 'field-notes-2026!' }, meta);
  const b = await auth.signUp({ email: 'sam@tidepool.io', password: 'field-notes-2026!' }, meta);
  await db.updateTable('users').set({ email_checked_at: Date.now() }).where('id', '=', a.user.id).execute();
  const row = async (id: string) =>
    ctxFor(await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
  nadia = await row(a.user.id);
  other = await row(b.user.id);
});

describe('secrets', () => {
  it('seals and unseals, differently each time', () => {
    const a = seal('sk-test-1234');
    expect(a).not.toContain('sk-test');
    expect(seal('sk-test-1234')).not.toBe(a);
    expect(unseal(a)).toBe('sk-test-1234');
    const [v, iv, tag, data] = a.split('.');
    expect(() => unseal([v, iv, tag, `${data.slice(0, -2)}AA`].join('.'))).toThrow();
  });
});

describe('api keys', () => {
  it('saves a key masked, and sends it only to its own host', async () => {
    const key = await apiKeys.create(nadia, {
      apiSlug: 'coresignal',
      apiName: 'CoreSignal',
      host: 'https://api.coresignal.com/cdapi/v2',
      secret: 'cs-live-abcdef9876',
    });
    expect(key.host).toBe('api.coresignal.com');
    expect(key.masked).toBe('••••9876');
    expect(JSON.stringify(await apiKeys.list(nadia))).not.toContain('abcdef');
    const stored = await db.selectFrom('api_keys').select('secret').where('id', '=', key.id).executeTakeFirstOrThrow();
    expect(stored.secret).not.toContain('abcdef');

    expect(await apiKeys.secretFor(nadia, key.id, 'https://api.coresignal.com/cdapi/v2/company')).toBe(
      'cs-live-abcdef9876',
    );
    await expect(apiKeys.secretFor(nadia, key.id, 'https://evil.example.com')).rejects.toMatchObject({
      code: 'wrong_host',
    });
    await expect(apiKeys.get(other, key.id)).rejects.toMatchObject({ status: 404 });

    const tested = await apiKeys.markTested(nadia, key.id, { ok: true, creditsLeft: 11480 });
    expect(tested.creditsLeft).toBe(11480);
    expect(tested.lastTestOk).toBe(true);
    const replaced = await apiKeys.replace(nadia, key.id, { secret: 'cs-live-new-key-5555' });
    expect(replaced.last4).toBe('5555');
    expect(replaced.lastTestOk).toBeNull();
  });

  it('needs a checked email to use a key', async () => {
    const key = await apiKeys.create(other, { apiSlug: 'x', apiName: 'X', host: 'api.x.com', secret: 'xxxxxxxx1111' });
    await expect(apiKeys.secretFor(other, key.id, 'api.x.com')).rejects.toMatchObject({ code: 'email_unchecked' });
    await apiKeys.remove(other, key.id);
    expect(await apiKeys.list(other)).toEqual([]);
  });
});

describe('projects', () => {
  it('starts empty, then creates, lists, updates and archives, scoped to the person', async () => {
    expect(await projects.list(nadia)).toEqual([]);
    const project = await projects.create(nadia, {
      name: 'AU software companies',
      apiName: 'CoreSignal',
      apiSlug: 'coresignal',
      docsUrl: 'https://docs.coresignal.com',
    });
    expect(project.status).toBe('draft');
    expect(project.monogram).toBe('CO');
    expect(project.creditLimit).toBe(1000);
    expect(await projects.list(other)).toEqual([]);
    await expect(projects.get(other, project.id)).rejects.toMatchObject({ status: 404 });
    await expect(projects.update(other, project.id, { name: 'Mine now' })).rejects.toMatchObject({ status: 404 });

    const updated = await projects.update(nadia, project.id, { name: 'AU SaaS', status: 'waiting', creditLimit: 500 });
    expect(updated).toMatchObject({ name: 'AU SaaS', status: 'waiting', creditLimit: 500 });
    await expect(projects.update(nadia, project.id, { name: '' })).rejects.toMatchObject({ status: 422 });

    const saved = await projects.saveSpec(nadia, project.id, coresignal, { author: 'ai', note: 'First setup' });
    expect(saved.status).toBe('ready');
    expect(saved.specVersion).toBe(1);
    expect(saved.spec?.api.slug).toBe('coresignal');
    const [summary] = await projects.list(nadia);
    expect(summary.controls).toBe(5);
    await expect(projects.saveSpec(nadia, project.id, { version: 1 })).rejects.toMatchObject({ code: 'invalid_spec' });

    await projects.archive(nadia, project.id);
    expect(await projects.list(nadia)).toEqual([]);
    expect(await projects.list(nadia, { archived: true })).toHaveLength(1);
  });

  it('refuses another person’s key', async () => {
    const key = await apiKeys.create(other, { apiSlug: 'x', apiName: 'X', host: 'api.x.com', secret: 'xxxxxxxx2222' });
    await expect(projects.create(nadia, { name: 'Sneaky', apiKeyId: key.id })).rejects.toMatchObject({ status: 422 });
  });
});
