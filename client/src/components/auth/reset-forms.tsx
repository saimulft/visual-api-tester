'use client';

import { ArrowRight, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PASSWORD_MIN } from '@/contracts/auth';
import { Button, Field, Input, PasswordInput } from '@/components/ui';
import { api, problemFor } from './api';
import { AuthNote } from './note';

/** Ask for a reset link. It always answers the same, so it never says whether an email has an account. */
export function ResetRequestForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (sentTo)
    return (
      <div className="auth-form">
        <div>
          <h1 className="auth-title">Check your inbox.</h1>
          <p className="auth-sub">If {sentTo} has a Dialed account, a reset link is on its way. It works for 1 hour.</p>
        </div>
        <AuthNote tone="ok">
          <span className="row" style={{ gap: 8 }}>
            <MailCheck className="i i-sm" aria-hidden="true" />
            Nothing yet? Check spam, or send it again in a minute.
          </span>
        </AuthNote>
        <div className="auth-links">
          <button type="button" className="link-btn" onClick={() => setSentTo(null)}>
            Use another email
          </button>
          <Link href="/log-in">Back to log in</Link>
        </div>
      </div>
    );

  return (
    <form
      className="auth-form"
      aria-label="Reset your password"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
          setError('Enter the email you signed up with.');
          return;
        }
        setBusy(true);
        const result = await api<{ sentTo: string }>('/api/auth/request-reset', { email });
        setBusy(false);
        if (result.ok) setSentTo(result.data.sentTo);
        else setError(result.error.message);
      }}
    >
      <div>
        <h1 className="auth-title">Reset your password.</h1>
        <p className="auth-sub">We’ll email you a link to choose a new one.</p>
      </div>
      <Field label="Email" id="rp-email" error={error}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            large
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={invalid}
            aria-describedby={describedBy}
            required
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" block busy={busy}>
        Send the link
        <ArrowRight className="i" aria-hidden="true" />
      </Button>
      <p className="auth-alt">
        Remembered it? <Link href="/log-in">Log in</Link>
      </p>
    </form>
  );
}

/** Choose a new password from the link. Logs out every other device and logs this one in. */
export function ResetSetForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field?: string | null; form?: string | null }>({});
  return (
    <form
      className="auth-form"
      aria-label="Choose a new password"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (password.length < PASSWORD_MIN) {
          setError({ field: `Use ${PASSWORD_MIN} or more characters.` });
          return;
        }
        setBusy(true);
        const result = await api('/api/auth/reset-password', { token, password });
        if (result.ok) {
          router.push('/projects');
          router.refresh();
          return;
        }
        setBusy(false);
        setError({
          field: problemFor(result, 'password'),
          form: problemFor(result, 'password') ? null : result.error.message,
        });
      }}
    >
      <div>
        <h1 className="auth-title">Choose a new password.</h1>
        <p className="auth-sub">You’ll be logged out everywhere else, and logged in here.</p>
      </div>
      {error.form && (
        <AuthNote tone="err">
          {error.form} <Link href="/reset-password">Ask for a new link</Link>
        </AuthNote>
      )}
      <Field label="New password" id="rs-pass" error={error.field}>
        {({ id, describedBy, invalid }) => (
          <PasswordInput
            id={id}
            meter
            hintId={`${id}-meter`}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={invalid}
            aria-describedby={[describedBy, `${id}-meter`].filter(Boolean).join(' ')}
            required
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" block busy={busy}>
        Save and log in
        <ArrowRight className="i" aria-hidden="true" />
      </Button>
    </form>
  );
}
