'use client';

import { ArrowRight, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Input, PasswordInput } from '@/components/ui';
import { api, problemFor } from './api';
import { AuthNote } from './note';

/** /check-email: where the link went, Resend, and a fix for a wrong address. */
export function CheckEmailPanel({ email, checked }: { email: string | null; checked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [fixing, setFixing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fixErrors, setFixErrors] = useState<{ email?: string | null; password?: string | null }>({});

  if (checked)
    return (
      <div className="auth-form">
        <div>
          <h1 className="auth-title">Your email is checked.</h1>
          <p className="auth-sub">Next, connect your AI so it can read API docs for you.</p>
        </div>
        <Button variant="primary" size="lg" block onClick={() => router.push('/welcome/ai')}>
          Connect your AI
          <ArrowRight className="i" aria-hidden="true" />
        </Button>
      </div>
    );

  if (!email)
    return (
      <div className="auth-form">
        <div>
          <h1 className="auth-title">Check your email.</h1>
          <p className="auth-sub">
            Open the link we sent you to start. Log in first if the link has run out, and we’ll send a new one.
          </p>
        </div>
        <Link className="btn btn-primary btn-lg btn-block" href="/log-in?next=/check-email">
          Log in
          <ArrowRight className="i" aria-hidden="true" />
        </Link>
      </div>
    );

  return (
    <div className="auth-form">
      <div>
        <h1 className="auth-title">Check your email.</h1>
        <p className="auth-sub">
          We sent a link to <strong>{email}</strong>. Open it to start: then you’ll connect your AI.
        </p>
      </div>
      {note && <AuthNote tone={note.tone}>{note.text}</AuthNote>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          size="lg"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            const result = await api<{ sentTo: string | null }>('/api/auth/resend-check', {});
            setBusy(false);
            setNote(
              result.ok
                ? { tone: 'ok', text: `Sent again to ${result.data.sentTo ?? email}. It works for 24 hours.` }
                : { tone: 'err', text: result.error.message },
            );
          }}
        >
          <MailCheck className="i" aria-hidden="true" />
          Resend the link
        </Button>
        <Link className="btn btn-lg btn-ghost" href="/projects">
          Look around first
        </Link>
      </div>
      {!fixing ? (
        <p className="auth-alt">
          Wrong address?{' '}
          <button type="button" className="link-btn" onClick={() => setFixing(true)}>
            Use a different email
          </button>
        </p>
      ) : (
        <form
          className="auth-form"
          aria-label="Use a different email"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const result = await api<{ sentTo: string }>('/api/auth/change-email', { email: newEmail, password });
            setBusy(false);
            if (result.ok) {
              setFixing(false);
              setNote({ tone: 'ok', text: `We sent a link to ${result.data.sentTo}. Open it to use that address.` });
              return;
            }
            setFixErrors({
              email: problemFor(result, 'email') ?? (problemFor(result, 'password') ? null : result.error.message),
              password: problemFor(result, 'password'),
            });
          }}
        >
          <Field label="The right email" id="ce-email" error={fixErrors.email}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                large
                type="email"
                autoComplete="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <Field label="Your password" id="ce-pass" error={fixErrors.password}>
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <div className="row">
            <Button type="submit" variant="primary" busy={busy}>
              Send the link there
            </Button>
            <Button variant="ghost" onClick={() => setFixing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * The link from an email. It asks for one click instead of acting on load, so mail scanners that open
 * links can't use it up. `change` confirms a new email instead of the sign-up check.
 */
export function ConfirmEmail({ token, change, signedIn }: { token: string; change: boolean; signedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="auth-form">
      <div>
        <h1 className="auth-title">{change ? 'Use your new email.' : 'Confirm your email.'}</h1>
        <p className="auth-sub">
          {change ? 'One click and your account uses this address.' : 'One click and you’re in. Then connect your AI.'}
        </p>
      </div>
      {error && <AuthNote tone="err">{error}</AuthNote>}
      <Button
        variant="primary"
        size="lg"
        block
        busy={busy}
        onClick={async () => {
          setBusy(true);
          const result = await api(change ? '/api/auth/confirm-email-change' : '/api/auth/check-email', { token });
          if (result.ok) {
            router.push(change ? '/settings/account' : signedIn ? '/welcome/ai' : '/log-in?checked=1&next=/welcome/ai');
            router.refresh();
            return;
          }
          setBusy(false);
          setError(result.error.message);
        }}
      >
        {change ? 'Use this email' : 'Confirm my email'}
        <ArrowRight className="i" aria-hidden="true" />
      </Button>
      <p className="auth-alt">
        <Link href="/log-in">Back to log in</Link>
      </p>
    </div>
  );
}
