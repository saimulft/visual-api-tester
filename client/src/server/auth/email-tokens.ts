// Adapted from dl-cms/cms/src/server/auth/resets.ts (one table for the email check, resets and email changes)
import { ApiError } from '@/contracts/common';
import { changed, db, newId, now, transaction } from '../db';
import type { EmailTokenPurpose } from '../db/schema';
import { randomToken, sha256 } from './tokens';

/** How long each kind of link works. */
export const TOKEN_MINUTES: Record<EmailTokenPurpose, number> = { check: 24 * 60, reset: 60, 'email-change': 24 * 60 };

const MESSAGES: Record<EmailTokenPurpose, { invalid: string; expired: string }> = {
  check: {
    invalid: 'This link isn’t valid any more. Log in and send a new one.',
    expired: 'This link ran out. Log in and send a new one.',
  },
  reset: {
    invalid: 'This reset link isn’t valid any more. Ask for a new one.',
    expired: 'This reset link ran out. Ask for a new one.',
  },
  'email-change': {
    invalid: 'This link isn’t valid any more. Change your email again in Settings.',
    expired: 'This link ran out. Change your email again in Settings.',
  },
};

/** Makes a link token. Earlier unused links of the same kind stop working. Returns the token once. */
export async function createEmailToken(userId: string, purpose: EmailTokenPurpose, newEmail: string | null = null) {
  const token = randomToken();
  const at = now();
  await transaction(async () => {
    await db
      .deleteFrom('email_tokens')
      .where('user_id', '=', userId)
      .where('purpose', '=', purpose)
      .where('used_at', 'is', null)
      .execute();
    await db
      .insertInto('email_tokens')
      .values({
        id: newId(),
        user_id: userId,
        purpose,
        token_hash: sha256(token),
        new_email: newEmail,
        expires_at: at + TOKEN_MINUTES[purpose] * 60_000,
        used_at: null,
        created_at: at,
      })
      .execute();
  });
  return token;
}

/**
 * Uses up a link. Throws when it's unknown, used, expired or of another kind. The use is one conditional
 * update, so two clicks can't both use it.
 */
export async function consumeEmailToken(token: string, purpose: EmailTokenPurpose) {
  const hash = sha256(token);
  const row = await db
    .selectFrom('email_tokens')
    .select(['id', 'user_id', 'new_email', 'expires_at', 'used_at', 'purpose'])
    .where('token_hash', '=', hash)
    .executeTakeFirst();
  const messages = MESSAGES[purpose];
  if (!row || row.purpose !== purpose || row.used_at) throw new ApiError('invalid_token', messages.invalid, 400);
  const at = now();
  if (row.expires_at <= at) throw new ApiError('expired', messages.expired, 410);
  const used = await db
    .updateTable('email_tokens')
    .set({ used_at: at })
    .where('id', '=', row.id)
    .where('used_at', 'is', null)
    .executeTakeFirst();
  if (changed(used) !== 1) throw new ApiError('invalid_token', messages.invalid, 400);
  return { userId: row.user_id, newEmail: row.new_email };
}
