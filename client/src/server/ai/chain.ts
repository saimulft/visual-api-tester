// Adapted from dl-cms/cms/src/server/ai/chain.ts (one level: the person's keys in ai_keys order)
import { AI_PROVIDER_LABELS } from '@/contracts/ai';
import { db, newId } from '../db';
import { unseal } from '../secrets';
import type { Ctx } from '../services/context';
import type { Attempt, Credential } from './fallback';

/**
 * The keys the built-in assistant tries, in the order the person set (position). A key that can't be unsealed
 * (APP_SECRET changed) is skipped with a warning; it never stops the others.
 */
export async function resolveChain(ctx: Ctx): Promise<Credential[]> {
  const rows = await db
    .selectFrom('ai_keys')
    .selectAll()
    .where('user_id', '=', ctx.user.id)
    .orderBy('position')
    .orderBy('created_at')
    .execute();
  const chain: Credential[] = [];
  for (const row of rows) {
    let apiKey: string;
    try {
      apiKey = unseal(row.secret);
    } catch {
      console.warn(`[ai] key ${row.id} couldn't be unsealed (was APP_SECRET changed?)`);
      continue;
    }
    chain.push({
      keyId: row.id,
      provider: row.provider,
      model: row.model,
      apiKey,
      label: row.label || `${AI_PROVIDER_LABELS[row.provider]} key`,
    });
  }
  return chain;
}

/** One ai_usage row per provider call. Usage stays when a key is removed (ai_key_id goes null). */
export async function recordAttempt(ctx: Ctx, attempt: Attempt, purpose: 'setup' | 'test') {
  const { credential: c } = attempt;
  const at = Date.now();
  const keyExists = await db
    .selectFrom('ai_keys')
    .select('id')
    .where('id', '=', c.keyId)
    .where('user_id', '=', ctx.user.id)
    .executeTakeFirst();
  await db
    .insertInto('ai_usage')
    .values({
      id: newId(),
      user_id: ctx.user.id,
      ai_key_id: keyExists ? c.keyId : null,
      provider: c.provider,
      model: c.model,
      purpose,
      tokens_in: Math.max(0, Math.round(attempt.inputTokens)),
      tokens_out: Math.max(0, Math.round(attempt.outputTokens)),
      ok: attempt.ok,
      error: attempt.errorKind ? `${attempt.errorKind}: ${attempt.message ?? ''}`.slice(0, 200) : null,
      at,
      created_at: at,
    })
    .execute();
}
