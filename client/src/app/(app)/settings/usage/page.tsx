import type { Metadata } from 'next';
import { UsageView } from '@/components/settings/usage-view';
import { usage } from '@/server/services';
import { pageCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Usage' };

/** Settings › Usage. */
export default async function UsageSettingsPage() {
  const ctx = await pageCtx('/settings/usage');
  return <UsageView usage={await usage.week(ctx)} />;
}
