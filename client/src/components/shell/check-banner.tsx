'use client';

import { MailWarning } from 'lucide-react';
import { useState } from 'react';
import { Button, toast } from '@/components/ui';
import { api } from '@/components/auth/api';
import { useShell } from './shell-context';

/** "Check your email to start", with Resend, until the email is checked. */
export function CheckBanner() {
  const { user } = useShell();
  const [busy, setBusy] = useState(false);
  if (user.emailChecked) return null;
  return (
    <div className="check-banner" role="status">
      <MailWarning className="i" aria-hidden="true" />
      <span>
        <strong>Check your email to start.</strong> We sent a link to {user.email}. Until then you can look around, but
        nothing calls an API or an AI.
      </span>
      <Button
        size="sm"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          const result = await api<{ sentTo: string | null }>('/api/auth/resend-check', {});
          setBusy(false);
          if (result.ok)
            toast.success(
              result.data.sentTo ? `Sent again to ${result.data.sentTo}` : 'Your email is already checked.',
            );
          else toast.error(result.error.message);
        }}
      >
        Resend
      </Button>
    </div>
  );
}
