import type { Metadata } from 'next';
import { AlertSettings } from '@/components/settings/alerts-settings';
import { schedules, users } from '@/server/services';
import { pageCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Alerts' };

/** Settings › Alerts. */
export default async function AlertSettingsPage() {
  const ctx = await pageCtx('/settings/alerts');
  const [me, list] = await Promise.all([users.get(ctx), schedules.list(ctx)]);
  return (
    <AlertSettings
      me={me}
      schedules={{
        emailOnFail: list.filter((s) => s.emailOnFail).length,
        emailCsv: list.filter((s) => s.emailCsv).length,
      }}
    />
  );
}
