import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { createTestDb } from '../db/testing';
import { resetRateLimits } from '../http/rate-limit';
import { AiCallError, type ProviderEvent } from '../ai/types';
import * as aiKeys from './ai-keys';
import * as auth from './auth';
import { ctxFor, type Ctx } from './context';

vi.mock('../ai/models', async (original) => {
  const real = await original<typeof import('../ai/models')>();
  return {
    ...real,
    // The provider's list: a key starting "bad" is rejected, as a provider would.
    listModels: vi.fn(async (provider: string, secret: string) => {
      if (secret.startsWith('bad')) throw new AiCallError('auth', { status: 401 });
      return provider === 'anthropic'
        ? [
            { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
            { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
            { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
          ]
        : [{ id: 'gpt-6-luna', name: 'gpt-6-luna' }];
    }),
  };
});

const t = await createTestDb();
afterAll(() => t.close());

let nadia: Ctx;
let sam: Ctx;
const meta = { ip: '203.0.113.20', userAgent: 'vitest' };

beforeAll(async () => {
  resetRateLimits();
  const a = await auth.signUp({ email: 'nadia@brightfield.com.au', password: 'field-notes-2026!' }, meta);
  const b = await auth.signUp({ email: 'sam@tidepool.io', password: 'field-notes-2026!' }, meta);
  await db.updateTable('users').set({ email_checked_at: Date.now() }).execute();
  const row = async (id: string) =>
    ctxFor(await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
  nadia = await row(a.user.id);
  sam = await row(b.user.id);
});

const okStream = () =>
  (async function* (): AsyncGenerator<ProviderEvent> {
    yield { type: 'usage', inputTokens: 30, outputTokens: 0 };
    yield { type: 'text', delta: 'OK' };
    yield { type: 'usage', inputTokens: 30, outputTokens: 2 };
    yield { type: 'done', stop: 'end' };
  })();

describe('AI keys', () => {
  it('checks a key with the provider before saving it, and keeps it sealed', async () => {
    await expect(aiKeys.create(nadia, { provider: 'anthropic', secret: 'bad-key-000000000000' })).rejects.toMatchObject(
      { status: 422, code: 'ai_auth' },
    );
    expect(await aiKeys.list(nadia)).toHaveLength(0);

    const key = await aiKeys.create(nadia, { provider: 'anthropic', secret: 'sk-ant-api03-real-key-Hq2' });
    // The newest Sonnet is the default.
    expect(key).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5', last4: '-Hq2', position: 0 });
    expect(key.modelName).toBe('Claude Sonnet 5.5');
    const stored = await db.selectFrom('ai_keys').select('secret').where('id', '=', key.id).executeTakeFirstOrThrow();
    expect(stored.secret).not.toContain('real-key');
    expect(JSON.stringify(await aiKeys.list(nadia))).not.toContain('real-key');
  });

  it('refuses a model the provider doesn’t list', async () => {
    await expect(
      aiKeys.create(nadia, { provider: 'openai', secret: 'sk-proj-other-key-0001', model: 'gpt-imaginary' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('adds keys at the bottom, reorders them, and re-packs on remove', async () => {
    const openai = await aiKeys.create(nadia, { provider: 'openai', secret: 'sk-proj-second-key-0002' });
    const third = await aiKeys.create(nadia, { provider: 'openai', secret: 'sk-proj-third-key-0003' });
    let keys = await aiKeys.list(nadia);
    expect(keys.map((k) => k.position)).toEqual([0, 1, 2]);
    const [first] = keys;

    await expect(aiKeys.reorder(nadia, { ids: [openai.id, first.id] })).rejects.toMatchObject({ status: 422 });
    keys = await aiKeys.reorder(nadia, { ids: [third.id, first.id, openai.id] });
    expect(keys.map((k) => k.id)).toEqual([third.id, first.id, openai.id]);
    expect((await aiKeys.summary(nadia)).provider).toBe('openai');

    await aiKeys.remove(nadia, third.id);
    keys = await aiKeys.list(nadia);
    expect(keys.map((k) => [k.id, k.position])).toEqual([
      [first.id, 0],
      [openai.id, 1],
    ]);
    expect(await aiKeys.summary(nadia)).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5', keys: 2 });
  });

  it('keeps each person’s keys to themselves', async () => {
    const [mine] = await aiKeys.list(nadia);
    expect(await aiKeys.list(sam)).toEqual([]);
    await expect(aiKeys.update(sam, mine.id, { model: 'claude-opus-5-5' })).rejects.toMatchObject({ status: 404 });
    await expect(aiKeys.remove(sam, mine.id)).rejects.toMatchObject({ status: 404 });
    expect(await aiKeys.summary(sam)).toEqual({ provider: null, model: null, modelName: null, keys: 0 });
  });

  it('tests a key with one tiny call, timed, and meters it', async () => {
    const [key] = await aiKeys.list(nadia);
    const result = await aiKeys.test(nadia, key.id, { stream: okStream });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/^Connected\. Claude replied in \d+\.\d s\.$/);
    const after = await aiKeys.get(nadia, key.id);
    expect(after.lastTestOk).toBe(true);
    const usage = await db.selectFrom('ai_usage').selectAll().where('user_id', '=', nadia.user.id).execute();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ purpose: 'test', tokens_in: 30, tokens_out: 2, ai_key_id: key.id });

    const failing = await aiKeys.test(nadia, key.id, {
      stream: () =>
        (async function* (): AsyncGenerator<ProviderEvent> {
          throw new AiCallError('auth', { status: 401 });
        })(),
    });
    expect(failing).toMatchObject({ ok: false, message: 'The provider rejected the key.' });
    expect((await aiKeys.get(nadia, key.id)).lastTestOk).toBe(false);
  });

  it('changes the model and replaces a secret only after the provider accepts it', async () => {
    const [key] = await aiKeys.list(nadia);
    expect((await aiKeys.update(nadia, key.id, { model: 'claude-opus-5-5' })).model).toBe('claude-opus-5-5');
    await expect(aiKeys.update(nadia, key.id, { secret: 'bad-replacement-0000' })).rejects.toMatchObject({
      status: 422,
    });
    const replaced = await aiKeys.update(nadia, key.id, { secret: 'sk-ant-api03-new-key-Zz9' });
    expect(replaced).toMatchObject({ last4: '-Zz9', lastTestOk: null });
  });
});
