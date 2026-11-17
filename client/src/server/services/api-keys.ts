import { ApiError, errors } from '@/contracts/common';
import { ApiKeyCreateSchema, ApiKeyReplaceSchema, hostOf, type ApiKey } from '@/contracts/api-keys';
import { bool, db, newId } from '../db';
import type { Selectable } from 'kysely';
import type { ApiKeysTable } from '../db/schema';
import { checkBody } from '../http/inputs';
import { last4, masked, seal, unseal } from '../secrets';
import { requireCheckedEmail, type Ctx } from './context';

/**
 * The API key vault. Keys are sealed (secrets.ts) and scoped to the person. The browser and MCP only ever
 * see the masked form; secretFor unseals a key for one call, and only for the key's own host.
 */
function toApiKey(row: Selectable<ApiKeysTable>): ApiKey {
  return {
    id: row.id,
    apiSlug: row.api_slug,
    apiName: row.api_name,
    host: row.host,
    label: row.label,
    last4: row.last4,
    masked: masked(row.last4),
    creditsLeft: row.credits_left,
    creditsCheckedAt: row.credits_checked_at,
    lastTestAt: row.last_test_at,
    lastTestOk: row.last_test_ok === null ? null : bool(row.last_test_ok),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function row(ctx: Ctx, id: string) {
  const found = await db
    .selectFrom('api_keys')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .executeTakeFirst();
  if (!found) throw errors.notFound('That API key');
  return found;
}

export async function create(ctx: Ctx, input: unknown): Promise<ApiKey> {
  const data = checkBody(ApiKeyCreateSchema, input);
  const id = newId();
  await db
    .insertInto('api_keys')
    .values({
      id,
      user_id: ctx.user.id,
      api_slug: data.apiSlug,
      api_name: data.apiName,
      host: data.host,
      label: data.label,
      secret: seal(data.secret),
      last4: last4(data.secret),
      credits_left: null,
      credits_checked_at: null,
      last_test_at: null,
      last_test_ok: null,
      created_at: ctx.now,
      updated_at: ctx.now,
    })
    .execute();
  return get(ctx, id);
}

/** The person's keys, masked, newest first. */
export async function list(ctx: Ctx, filter: { apiSlug?: string } = {}): Promise<ApiKey[]> {
  let query = db.selectFrom('api_keys').selectAll().where('user_id', '=', ctx.user.id);
  if (filter.apiSlug) query = query.where('api_slug', '=', filter.apiSlug);
  return (await query.orderBy('created_at', 'desc').execute()).map(toApiKey);
}

export async function get(ctx: Ctx, id: string): Promise<ApiKey> {
  return toApiKey(await row(ctx, id));
}

/** Puts a new secret in place of the old one (same id, so projects keep pointing at it). */
export async function replace(ctx: Ctx, id: string, input: unknown): Promise<ApiKey> {
  const data = checkBody(ApiKeyReplaceSchema, input);
  await row(ctx, id);
  await db
    .updateTable('api_keys')
    .set({
      secret: seal(data.secret),
      last4: last4(data.secret),
      ...(data.label !== undefined && { label: data.label }),
      last_test_at: null,
      last_test_ok: null,
      updated_at: ctx.now,
    })
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .execute();
  return get(ctx, id);
}

/** Deletes a key. Projects that used it keep going without one until a new key is picked. */
export async function remove(ctx: Ctx, id: string): Promise<void> {
  await row(ctx, id);
  await db.deleteFrom('api_keys').where('id', '=', id).where('user_id', '=', ctx.user.id).execute();
}

/** Records a test call's outcome, and the credits left when the API reported them. */
export async function markTested(
  ctx: Ctx,
  id: string,
  result: { ok: boolean; creditsLeft?: number | null },
): Promise<ApiKey> {
  await row(ctx, id);
  await db
    .updateTable('api_keys')
    .set({
      last_test_at: ctx.now,
      last_test_ok: result.ok,
      ...(typeof result.creditsLeft === 'number' && { credits_left: result.creditsLeft, credits_checked_at: ctx.now }),
      updated_at: ctx.now,
    })
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .execute();
  return get(ctx, id);
}

/**
 * The plain secret, for one outbound call to `host` (a host or a URL). Throws unless the host is the key's
 * own, so a spec pointed somewhere else can never receive the key. Needs a checked email.
 */
export async function secretFor(ctx: Ctx, keyId: string, host: string): Promise<string> {
  requireCheckedEmail(ctx);
  const found = await row(ctx, keyId);
  const target = hostOf(host);
  if (!target || target !== found.host)
    throw new ApiError(
      'wrong_host',
      `This key is saved for ${found.host}, so it can’t be sent to ${target ?? 'that address'}.`,
      403,
    );
  return unseal(found.secret);
}
