// Adapted from dl-cms/cms/src/app/oauth/authorize/page.tsx (restyled in Dialed's account layout)
import { Check, FlaskConical, KeyRound, Play, Plug } from 'lucide-react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthBox } from '@/components/auth/auth-box';
import { AuthFoot } from '@/components/auth/auth-foot';
import { AuthNote } from '@/components/auth/note';
import { Button, Logo } from '@/components/ui';
import {
  AUTHORIZE_PARAMS,
  OAuthError,
  authorizeQuery,
  baseUrlFrom,
  checkClient,
  checkRequest,
  errorRedirect,
  resolveTarget,
} from '@/server/oauth';
import { currentCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Connect an AI' };

/**
 * OAuth consent: the signed-in person sees which AI is asking and what it can do in Dialed, and allows or denies.
 * The answer posts to /oauth/authorize/decision, which checks everything again.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = authorizeQuery((key) => sp[key]);
  const base = baseUrlFrom(await headers());

  let checked: Awaited<ReturnType<typeof checkClient>>;
  try {
    checked = await checkClient(q);
  } catch (error) {
    return <Problem title="This AI can’t connect" message={messageOf(error)} />;
  }
  const { client, redirectUri } = checked;

  try {
    checkRequest(q);
  } catch (error) {
    const oauth = error instanceof OAuthError ? error : new OAuthError('server_error', 'Try again.');
    // A page, not a redirect: registration is open, so redirecting here would make this address send anyone anywhere.
    return (
      <Problem
        title="This AI can’t connect"
        message={oauth.message}
        back={errorRedirect(redirectUri, oauth, q.state)}
      />
    );
  }

  const ctx = await currentCtx();
  const here = `/oauth/authorize?${new URLSearchParams(q as Record<string, string>)}`;
  if (!ctx) redirect(`/log-in?next=${encodeURIComponent(here)}`);

  try {
    await resolveTarget(ctx.user.id, q.resource, base);
  } catch (error) {
    const oauth = error instanceof OAuthError ? error : new OAuthError('server_error', 'Try again.');
    return (
      <Problem
        title={`${client.client_name} can’t connect`}
        message={oauth.message}
        back={errorRedirect(redirectUri, oauth, q.state)}
      />
    );
  }

  return (
    <Frame>
      <form className="auth-form" method="post" action="/oauth/authorize/decision" aria-label="Connect an AI">
        <div>
          <span className="micro">Connect your AI</span>
          <h1 className="auth-title" style={{ marginTop: 10 }}>
            {client.client_name} wants to use your Dialed
          </h1>
          <p className="auth-sub">
            Signed in as {ctx.user.email}, in the {ctx.user.workspace} workspace.
          </p>
        </div>
        <AuthNote>
          Any app can call itself “{client.client_name}”, and we haven’t checked that name. This one sends you back to{' '}
          <strong style={{ wordBreak: 'break-all' }}>{hostOf(redirectUri)}</strong>. Allow it only if you started this
          from that app.
        </AuthNote>
        <ul className="olist consent-list">
          <Point icon={<Plug className="i i-sm" aria-hidden="true" />}>
            Lists your projects and creates new ones, reads API docs and sets up controls for you to watch.
          </Point>
          <Point icon={<FlaskConical className="i i-sm" aria-hidden="true" />}>
            Makes free test calls with your saved keys, without ever seeing the keys.
          </Point>
          <Point icon={<Play className="i i-sm" aria-hidden="true" />}>
            Runs projects, reads your data and schedules pulls. A run that costs credits waits for your yes.
          </Point>
          <Point icon={<KeyRound className="i i-sm" aria-hidden="true" />}>
            Access lasts until you disconnect it in Settings, or make a new address.
          </Point>
        </ul>
        {AUTHORIZE_PARAMS.map((key) =>
          q[key] !== undefined ? <input key={key} type="hidden" name={key} value={q[key]} /> : null,
        )}
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <Button
            type="submit"
            name="decision"
            value="allow"
            variant="primary"
            size="lg"
            tile={<Check className="i" />}
          >
            Allow
          </Button>
          <Button type="submit" name="decision" value="deny" variant="ghost" size="lg">
            Deny
          </Button>
        </div>
      </form>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <section className="auth-side" aria-label="Your account">
        <Logo href="/" />
        {children}
        <AuthFoot />
      </section>
      <AuthBox />
    </div>
  );
}

function Point({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li>
      <span className="consent-icon">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function Problem({ title, message, back }: { title: string; message: string; back?: string }) {
  return (
    <Frame>
      <div className="auth-form">
        <div>
          <span className="micro">Connect your AI</span>
          <h1 className="auth-title" style={{ marginTop: 10 }}>
            {title}
          </h1>
        </div>
        <AuthNote tone="err">{message}</AuthNote>
        {back && (
          <a className="btn btn-lg" href={back}>
            Back to the app
          </a>
        )}
      </div>
    </Frame>
  );
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Try again.');

function hostOf(uri: string) {
  try {
    const url = new URL(uri);
    return url.host || `${url.protocol}//`;
  } catch {
    return uri;
  }
}
