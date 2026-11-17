'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Field, Input, PasswordInput } from '@/components/ui';
import { api } from './api';
import { AuthNote } from './note';

/** Log in, in the sign-up layout. `next` is where to go afterwards (only paths inside the app). */
export function LogInForm({
  next,
  notice,
  signupsOpen,
}: {
  next?: string;
  notice?: string | null;
  signupsOpen: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/projects';

  return (
    <form
      className="auth-form"
      aria-label="Log in"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!email.trim() || !password) {
          setError('Enter your email and password.');
          return;
        }
        setBusy(true);
        const result = await api('/api/auth/log-in', { email, password });
        if (result.ok) {
          router.push(target);
          router.refresh();
          return;
        }
        setBusy(false);
        setError(result.error.message);
      }}
    >
      <div>
        <h1 className="auth-title">Welcome back.</h1>
        <p className="auth-sub">Log in to dial in your APIs, run them and keep the data.</p>
      </div>
      {notice && !error && <AuthNote tone="ok">{notice}</AuthNote>}
      {error && <AuthNote tone="err">{error}</AuthNote>}
      <Field label="Email" id="li-email">
        {({ id }) => (
          <Input
            id={id}
            large
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        )}
      </Field>
      <Field label="Password" id="li-pass" hint={<Link href="/reset-password">Forgot your password?</Link>}>
        {({ id, describedBy }) => (
          <PasswordInput
            id={id}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={describedBy}
            required
          />
        )}
      </Field>
      <Button type="submit" variant="primary" size="lg" block busy={busy}>
        Log in
        <ArrowRight className="i" aria-hidden="true" />
      </Button>
      {signupsOpen && (
        <p className="auth-alt">
          New to Dialed? <Link href="/sign-up">Create an account</Link>
        </p>
      )}
    </form>
  );
}
