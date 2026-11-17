// Adapted from dl-cms/cms/src/server/services/context.ts
import { errors } from '@/contracts/common';
import { initialsOf, type Me } from '@/contracts/auth';
import { loadSession, type LoadedSession, type UserRow } from '../auth/sessions';
import { bool, now } from '../db';
import { SESSION_COOKIE } from '../http/cookies';

/**
 * What every service call gets first: the signed-in person and the time the request started. Route handlers
 * build it with requireUser; pages with currentCtx (src/server/services/page-context.ts).
 */
export type Ctx = { user: Me; now: number };

export function toMe(row: UserRow): Me {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    initials: initialsOf(row.name, row.email),
    workspace: row.workspace,
    timezone: row.timezone,
    emailChecked: row.email_checked_at !== null,
    mcpHandle: row.mcp_handle,
    alertEmail: row.alert_email,
    alertsMuted: bool(row.alerts_muted),
    createdAt: row.created_at,
  };
}

export function ctxFor(row: UserRow): Ctx {
  return { user: toMe(row), now: now() };
}

/** The session cookie's token from a request. */
export function sessionToken(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/** The session behind a request, or null. */
export async function sessionOf(request: Request, opts: { renew?: boolean } = {}): Promise<LoadedSession | null> {
  return loadSession(sessionToken(request), opts);
}

/** The signed-in person's Ctx. Throws a 401 when nobody is logged in. */
export async function requireUser(request: Request): Promise<Ctx> {
  const loaded = await sessionOf(request);
  if (!loaded) throw errors.unauthenticated();
  return ctxFor(loaded.user);
}

/** Stops anyone whose email isn't checked: everything that calls an API or an AI goes through this. */
export function requireCheckedEmail(ctx: Ctx): Ctx {
  if (!ctx.user.emailChecked) throw errors.emailUnchecked();
  return ctx;
}
