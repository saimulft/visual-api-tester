// Adapted from dl-cms/cms/src/server/auth/sessions.ts
import { db, now } from '../db';
import type { Selectable } from 'kysely';
import type { UsersTable } from '../db/schema';
import { randomToken, sha256 } from './tokens';

/** Sessions: the token goes in the cookie, only its SHA-256 is stored (sessions.id). 30 days, sliding. */
export const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const SESSION_MS = SESSION_DAYS * DAY;
/** Sliding expiry moves forward at most once a day, so most requests don't write. */
const RENEW_AFTER = DAY;
const SEEN_EVERY = 5 * 60 * 1000;

/** Starts a session. Returns the token for the cookie (once) and when it expires. */
export async function createSession(userId: string, userAgent?: string | null, ip?: string | null) {
  const token = randomToken();
  const at = now();
  const expiresAt = at + SESSION_MS;
  await db
    .insertInto('sessions')
    .values({
      id: sha256(token),
      user_id: userId,
      expires_at: expiresAt,
      last_seen_at: at,
      user_agent: userAgent?.slice(0, 300) ?? null,
      ip: ip?.slice(0, 64) ?? null,
      created_at: at,
    })
    .execute();
  return { token, expiresAt };
}

export type UserRow = Selectable<UsersTable>;

export type LoadedSession = {
  user: UserRow;
  sessionId: string;
  expiresAt: number;
  /** True when the expiry moved: set the cookie again with the new Max-Age. */
  renewed: boolean;
};

/**
 * Looks a cookie token up. Null when unknown or expired. With `renew` (route handlers), moves the 30-day
 * expiry forward once a day while the session is used; pages can't set cookies, so they read only.
 */
export async function loadSession(
  token: string | null | undefined,
  opts: { renew?: boolean } = {},
): Promise<LoadedSession | null> {
  if (!token || token.length > 200) return null;
  const id = sha256(token);
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .selectAll('users')
    .select(['sessions.expires_at as session_expires_at', 'sessions.last_seen_at as session_seen_at'])
    .where('sessions.id', '=', id)
    .executeTakeFirst();
  if (!row) return null;
  const at = now();
  if (row.session_expires_at <= at) return null;
  const { session_expires_at, session_seen_at, ...user } = row;
  let expiresAt = session_expires_at;
  let renewed = false;
  const renew = opts.renew && SESSION_MS - (session_expires_at - at) > RENEW_AFTER;
  if (renew || at - session_seen_at > SEEN_EVERY) {
    if (renew) {
      expiresAt = at + SESSION_MS;
      renewed = true;
    }
    await db.updateTable('sessions').set({ expires_at: expiresAt, last_seen_at: at }).where('id', '=', id).execute();
  }
  return { user: user as UserRow, sessionId: id, expiresAt, renewed };
}

/** Logging out ends the session behind a token. */
export async function deleteSession(token: string | null | undefined) {
  if (!token) return;
  await db.deleteFrom('sessions').where('id', '=', sha256(token)).execute();
}

/** Logs a person out everywhere (after a reset), or everywhere but the session behind keepToken. */
export async function deleteUserSessions(userId: string, keepToken?: string) {
  let query = db.deleteFrom('sessions').where('user_id', '=', userId);
  if (keepToken) query = query.where('id', '<>', sha256(keepToken));
  await query.execute();
}
