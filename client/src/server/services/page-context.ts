import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loadSession } from '../auth/sessions';
import { SESSION_COOKIE } from '../http/cookies';
import { ctxFor, type Ctx } from './context';

/**
 * The signed-in person for a server component or page, or null. Pages can't set cookies, so this reads the
 * session without renewing it; API calls renew it.
 */
export async function currentCtx(): Promise<Ctx | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  const loaded = await loadSession(token);
  return loaded ? ctxFor(loaded.user) : null;
}

/** The signed-in person, or a redirect to /log-in (back to `next` afterwards). */
export async function pageCtx(next?: string): Promise<Ctx> {
  const ctx = await currentCtx();
  if (!ctx) redirect(next ? `/log-in?next=${encodeURIComponent(next)}` : '/log-in');
  return ctx;
}
