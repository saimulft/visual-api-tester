import type { Metadata } from 'next';
import { AccountSettings } from '@/components/settings/account-settings';
import { settings, users } from '@/server/services';
import { pageCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Account' };

/** Settings › Account. */
export default async function AccountSettingsPage() {
  const ctx = await pageCtx('/settings/account');
  const [me, counts] = await Promise.all([users.get(ctx), settings.counts(ctx)]);
  return <AccountSettings me={me} counts={counts} />;
}
