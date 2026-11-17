import type { Metadata } from 'next';
import { ResetSetForm } from '@/components/auth/reset-forms';

export const metadata: Metadata = { title: 'Choose a new password', referrer: 'no-referrer', robots: { index: false } };

export default async function ResetSetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ResetSetForm token={token} />;
}
