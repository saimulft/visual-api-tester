import type { Metadata } from 'next';
import { ConfirmEmail } from '@/components/auth/check-email';
import { currentCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Confirm your email', referrer: 'no-referrer', robots: { index: false } };

export default async function ConfirmEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ change?: string }>;
}) {
  const [{ token }, { change }, ctx] = await Promise.all([params, searchParams, currentCtx()]);
  return <ConfirmEmail token={token} change={change === '1'} signedIn={Boolean(ctx)} />;
}
