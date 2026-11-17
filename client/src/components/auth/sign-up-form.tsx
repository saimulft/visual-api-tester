'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PASSWORD_MIN } from '@/contracts/auth';
import { Button, Field, Input, PasswordInput } from '@/components/ui';
import { api, problemFor } from './api';
import { AuthNote } from './note';

/** 01 Sign up: work email and a password with the strength line. The workspace is named from the domain. */
export function SignUpForm({ open, closedMessage }: { open: boolean; closedMessage: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null; form?: string | null }>({});

  if (!open)
    return (
      <div className="auth-form">
        <div>
          <h1 className="auth-title">Get data from any API. No code.</h1>
          <p className="auth-sub">Create your free account. You bring your own AI and your API keys.</p>
        </div>
        <AuthNote>{closedMessage}</AuthNote>
        <p className="auth-alt">
          Already have an account? <Link href="/log-in">Log in</Link>
        </p>
      </div>
    );

  return (
    <form
      className="auth-form"
      aria-label="Sign up"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const next: typeof errors = {};
        if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = 'Enter your work email.';
        if (password.length < PASSWORD_MIN) next.password = `Use ${PASSWORD_MIN} or more characters.`;
        setErrors(next);
        if (next.email || next.password) return;
        setBusy(true);
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const result = await api('/api/auth/sign-up', { email, password, timezone });
        if (result.ok) {
          router.push('/check-email');
          router.refresh();
          return;
        }
        setBusy(false);
        setErrors({
          email: problemFor(result, 'email'),
          password: problemFor(result, 'password'),
          form: problemFor(result, 'email') || problemFor(result, 'password') ? null : result.error.message,
        });
      }}
    >
      <div>
        <h1 className="auth-title">Get data from any API. No code.</h1>
        <p className="auth-sub">Create your free account. You bring your own AI and your API keys.</p>
      </div>
      {errors.form && <AuthNote tone="err">{errors.form}</AuthNote>}
      <Field label="Work email" id="su-email" error={errors.email}>
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
      <Field label="Password" id="su-pass" error={errors.password}>
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
        Create account
        <ArrowRight className="i" aria-hidden="true" />
      </Button>
      <p className="auth-alt">
        Already have an account? <Link href="/log-in">Log in</Link>
      </p>
    </form>
  );
}
