import { createHash } from 'node:crypto';
import type { Selectable } from 'kysely';
import {
  AI_ERROR_MESSAGES,
  AiKeyCreateSchema,
  AiKeyOrderSchema,
  AiKeyUpdateSchema,
  AiModelsQuerySchema,
  MAX_AI_KEYS,
  type AiKey,
  type AiModelOption,
  type AiProvider,
  type AiSummary,
  type AiTestResult,
} from '@/contracts/ai';
import { ApiError, errors } from '@/contracts/common';
import { recordAttempt } from '../ai/chain';
import { walkChain, type StreamFn } from '../ai/fallback';
import { limitKeyChecks } from '../ai/limits';
import { listModels, defaultModel, modelName } from '../ai/models';
import { AiCallError } from '../ai/types';
import { bool, db, newId, transaction } from '../db';
import type { AiKeysTable } from '../db/schema';
import { checkBody } from '../http/inputs';
import { last4, seal, unseal } from '../secrets';
import { requireCheckedEmail, type Ctx } from './context';

/**
 * The built-in assistant's AI keys, tried from the top. Keys are sealed and scoped to the person; the browser
 * sees provider, model, label and the last four characters only. A key is checked with the provider (its model
 * list) before it's saved, so a key the provider rejects is never kept.
 */
type Row = Selectable<AiKeysTable>;

/** What "Test" names the AI as: "Claude replied in 1.2 s." */
const REPLIER: Record<AiProvider, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
};

const cacheKeyOf = (secret: string) => createHash('sha256').update(`models:${secret}`).digest('hex').slice(0, 32);

function toAiKey(row: Row, setups: number): AiKey {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    modelName: modelName(row.provider, row.model),
    label: row.label,
    last4: row.last4,
    position: row.position,
    lastTestAt: row.last_test_at,
    lastTestOk: row.last_test_ok === null ? null : bool(row.last_test_ok),
    lastTestMs: row.last_test_ms,
    setups,
    createdAt: row.created_at,
  };
}

async function row(ctx: Ctx, id: string): Promise<Row> {
  const found = await db
    .selectFrom('ai_keys')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .executeTakeFirst();
  if (!found) throw errors.notFound('That AI key');
  return found;
}

async function setupCounts(ctx: Ctx): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom('setups')
    .innerJoin('projects', 'projects.id', 'setups.project_id')
    .select(['setups.ai_key_id as keyId', (eb) => eb.fn.countAll<number>().as('n')])
    .where('projects.user_id', '=', ctx.user.id)
    .where('setups.ai_key_id', 'is not', null)
    .groupBy('setups.ai_key_id')
    .execute();
  return new Map(rows.map((r) => [String(r.keyId), Number(r.n)]));
}

/** The person's keys in the order they're tried. */
export async function list(ctx: Ctx): Promise<AiKey[]> {
  const [rows, counts] = await Promise.all([
    db
      .selectFrom('ai_keys')
      .selectAll()
      .where('user_id', '=', ctx.user.id)
      .orderBy('position')
      .orderBy('created_at')
      .execute(),
    setupCounts(ctx),
  ]);
  return rows.map((r) => toAiKey(r, counts.get(r.id) ?? 0));
}

export async function get(ctx: Ctx, id: string): Promise<AiKey> {
  const found = await row(ctx, id);
  return toAiKey(found, (await setupCounts(ctx)).get(id) ?? 0);
}

/** A provider's models with a key: one the person is pasting, or one they saved. */
export async function models(ctx: Ctx, input: unknown): Promise<{ models: AiModelOption[]; recommended: string }> {
  const query = checkBody(AiModelsQuerySchema, input);
  limitKeyChecks(ctx);
  let provider: AiProvider;
  let secret: string;
  if ('keyId' in query) {
    const found = await row(ctx, query.keyId);
    provider = found.provider;
    secret = unseal(found.secret);
  } else {
    provider = query.provider;
    secret = query.secret;
  }
  try {
    const list = await listModels(provider, secret, cacheKeyOf(secret));
    return { models: list, recommended: defaultModel(provider, list) };
  } catch (error) {
    throw keyError(error);
  }
}

/** A provider failure as a 422 people can act on. */
function keyError(error: unknown): ApiError {
  if (error instanceof AiCallError) {
    const message =
      error.kind === 'auth' ? 'The provider rejected that key. Check that you pasted all of it.' : error.message;
    return new ApiError(`ai_${error.kind}`, message, 422, [{ path: 'secret', message }]);
  }
  return new ApiError('ai_unavailable', AI_ERROR_MESSAGES.unavailable, 422);
}

/** Saves a key at the bottom of the list, after checking it with the provider. */
export async function create(ctx: Ctx, input: unknown): Promise<AiKey> {
  requireCheckedEmail(ctx);
  const data = checkBody(AiKeyCreateSchema, input);
  const count = await db
    .selectFrom('ai_keys')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('user_id', '=', ctx.user.id)
    .executeTakeFirstOrThrow();
  if (Number(count.n) >= MAX_AI_KEYS)
    throw errors.invalid([], `You can keep up to ${MAX_AI_KEYS} AI keys. Remove one first.`);
  limitKeyChecks(ctx);
  let available: AiModelOption[];
  try {
    available = await listModels(data.provider, data.secret, cacheKeyOf(data.secret));
  } catch (error) {
    throw keyError(error);
  }
  const model = data.model || defaultModel(data.provider, available);
  if (data.model && available.length && !available.some((m) => m.id === data.model))
    throw errors.invalid([{ path: 'model', message: 'Pick a model from the list.' }]);
  const id = newId();
  await transaction(async () => {
    const last = await db
      .selectFrom('ai_keys')
      .select((eb) => eb.fn.max('position').as('max'))
      .where('user_id', '=', ctx.user.id)
      .executeTakeFirst();
    await db
      .insertInto('ai_keys')
      .values({
        id,
        user_id: ctx.user.id,
        provider: data.provider,
        model,
        label: data.label,
        secret: seal(data.secret),
        last4: last4(data.secret),
        position: last?.max === null || last?.max === undefined ? 0 : Number(last.max) + 1,
        last_test_at: null,
        last_test_ok: null,
        last_test_ms: null,
        created_at: ctx.now,
        updated_at: ctx.now,
      })
      .execute();
  });
  return get(ctx, id);
}

/** Changes the model or label, or puts a new secret in place (checked first). */
export async function update(ctx: Ctx, id: string, input: unknown): Promise<AiKey> {
  const patch = checkBody(AiKeyUpdateSchema, input);
  const found = await row(ctx, id);
  if (patch.secret) {
    limitKeyChecks(ctx);
    try {
      await listModels(found.provider, patch.secret, cacheKeyOf(patch.secret));
    } catch (error) {
      throw keyError(error);
    }
  }
  await db
    .updateTable('ai_keys')
    .set({
      ...(patch.model !== undefined && { model: patch.model }),
      ...(patch.label !== undefined && { label: patch.label }),
      ...(patch.secret !== undefined && {
        secret: seal(patch.secret),
        last4: last4(patch.secret),
        last_test_at: null,
        last_test_ok: null,
        last_test_ms: null,
      }),
      updated_at: ctx.now,
    })
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .execute();
  return get(ctx, id);
}

/** Puts the keys in a new order: `ids` must be exactly the person's keys. */
export async function reorder(ctx: Ctx, input: unknown): Promise<AiKey[]> {
  const { ids } = checkBody(AiKeyOrderSchema, input);
  const own = await db.selectFrom('ai_keys').select('id').where('user_id', '=', ctx.user.id).execute();
  const ownIds = new Set(own.map((r) => r.id));
  if (ids.length !== ownIds.size || new Set(ids).size !== ids.length || ids.some((id) => !ownIds.has(id)))
    throw errors.invalid([{ path: 'ids', message: 'Send every one of your AI keys, each once.' }]);
  await transaction(async () => {
    for (const [position, id] of ids.entries())
      await db
        .updateTable('ai_keys')
        .set({ position, updated_at: ctx.now })
        .where('id', '=', id)
        .where('user_id', '=', ctx.user.id)
        .execute();
  });
  return list(ctx);
}

export async function remove(ctx: Ctx, id: string): Promise<void> {
  await row(ctx, id);
  await transaction(async () => {
    await db.updateTable('setups').set({ ai_key_id: null }).where('ai_key_id', '=', id).execute();
    await db.updateTable('ai_usage').set({ ai_key_id: null }).where('ai_key_id', '=', id).execute();
    await db.deleteFrom('ai_keys').where('id', '=', id).where('user_id', '=', ctx.user.id).execute();
    const rest = await db
      .selectFrom('ai_keys')
      .select('id')
      .where('user_id', '=', ctx.user.id)
      .orderBy('position')
      .orderBy('created_at')
      .execute();
    for (const [position, r] of rest.entries())
      await db.updateTable('ai_keys').set({ position }).where('id', '=', r.id).execute();
  });
}

/**
 * Sends one tiny message with this key only and times the answer: "Connected. Claude replied in 1.2 s." The
 * call counts in ai_usage (purpose "test"). `stream` is for tests.
 */
export async function test(ctx: Ctx, id: string, opts: { stream?: StreamFn } = {}): Promise<AiTestResult> {
  requireCheckedEmail(ctx);
  limitKeyChecks(ctx);
  const found = await row(ctx, id);
  let apiKey: string;
  try {
    apiKey = unseal(found.secret);
  } catch {
    return { ok: false, ms: 0, message: 'This key can’t be read any more. Replace it.' };
  }
  const started = Date.now();
  let ok = false;
  let message: string;
  try {
    for await (const event of walkChain(
      [{ keyId: found.id, provider: found.provider, model: found.model, apiKey, label: found.label }],
      {
        system: 'You check that an API key works. Reply with the single word OK.',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Say OK.' }] }],
        tools: [],
        maxOutput: 2_000,
      },
      {
        signal: AbortSignal.timeout(60_000),
        maxTries: 1,
        stream: opts.stream,
        onAttempt: (attempt) => recordAttempt(ctx, attempt, 'test'),
      },
    ))
      void event;
    ok = true;
    message = `Connected. ${REPLIER[found.provider]} replied in ${((Date.now() - started) / 1000).toFixed(1)} s.`;
  } catch (error) {
    message =
      error instanceof AiCallError
        ? error.kind === 'bad_request'
          ? `${error.message} ${found.model} may not be available to this key.`
          : error.message
        : AI_ERROR_MESSAGES.unavailable;
  }
  const ms = Date.now() - started;
  await db
    .updateTable('ai_keys')
    .set({ last_test_at: Date.now(), last_test_ok: ok, last_test_ms: ms, updated_at: Date.now() })
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .execute();
  return { ok, ms, message };
}

/** The first key's provider and model (the Projects KPI "Your AI" and the New project choice). */
export async function summary(ctx: Ctx): Promise<AiSummary> {
  const rows = await db
    .selectFrom('ai_keys')
    .select(['provider', 'model'])
    .where('user_id', '=', ctx.user.id)
    .orderBy('position')
    .orderBy('created_at')
    .execute();
  const first = rows[0];
  return {
    provider: first?.provider ?? null,
    model: first?.model ?? null,
    modelName: first ? modelName(first.provider, first.model) : null,
    keys: rows.length,
  };
}

/** For chat B (Projects KPI "Your AI"): the first key's provider and model. */
export const aiSummary = summary;
