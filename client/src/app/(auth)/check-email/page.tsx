import type { Metadata } from 'next';
import { CheckEmailPanel } from '@/components/auth/check-email';
import { currentCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Check your email' };

export default async function CheckEmailPage() {
  const ctx = await currentCtx();
  return <CheckEmailPanel email={ctx?.user.email ?? null} checked={Boolean(ctx?.user.emailChecked)} />;
}
