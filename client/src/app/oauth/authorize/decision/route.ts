// Adapted from dl-cms/cms/src/app/oauth/authorize/decision/route.ts
import type { NextRequest } from 'next/server';
import { loadSession } from '@/server/auth/sessions';
import { SESSION_COOKIE } from '@/server/http';
import {
  OAuthError,
  approve,
  authorizeQuery,
  baseUrl,
  checkClient,
  checkRequest,
  errorRedirect,
  resolveTarget,
} from '@/server/oauth';

const see = (url: string) => new Response(null, { status: 303, headers: { Location: url } });

function plain(message: string, status = 400) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** Allow or Deny from the consent page. Everything is checked again; the answer goes back to the app. */
export async function POST(request: NextRequest) {
  const base = baseUrl(request);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(base).origin) return plain('Cross-site form posts aren’t accepted.', 403);

  const form = await request.formData();
  const field = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value : null;
  };
  const q = authorizeQuery(field);

  let checked: Awaited<ReturnType<typeof checkClient>>;
  try {
    checked = await checkClient(q);
  } catch (error) {
    return plain(error instanceof Error ? error.message : 'This app can’t connect.');
  }
  const { client, redirectUri } = checked;
  const fail = (error: unknown) =>
    see(
      errorRedirect(
        redirectUri,
        error instanceof OAuthError ? error : new OAuthError('server_error', 'Something went wrong.'),
        q.state,
      ),
    );

  let checkedRequest: ReturnType<typeof checkRequest>;
  try {
    checkedRequest = checkRequest(q);
  } catch (error) {
    return fail(error);
  }

  const session = await loadSession(request.cookies.get(SESSION_COOKIE)?.value ?? null);
  if (!session) {
    const back = `/oauth/authorize?${new URLSearchParams(q as Record<string, string>)}`;
    return see(`${base}/log-in?next=${encodeURIComponent(back)}`);
  }
  if (field('decision') !== 'allow') return fail(new OAuthError('access_denied', 'The person denied access.'));

  try {
    const target = await resolveTarget(session.user.id, q.resource, base);
    return see(
      await approve({
        client,
        redirectUri,
        state: q.state,
        codeChallenge: checkedRequest.codeChallenge,
        scope: checkedRequest.scope,
        target,
        userId: session.user.id,
      }),
    );
  } catch (error) {
    if (!(error instanceof OAuthError)) console.error('[oauth] approve failed', error);
    return fail(error);
  }
}
