import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LogInForm } from '@/components/auth/log-in-form';
import { signupsOpen } from '@/server/services/auth';
import { currentCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Log in' };

export default async function LogInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; checked?: string }>;
}) {
  const { next, checked } = await searchParams;
  if (await currentCtx()) redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : '/projects');
  return (
    <LogInForm
      next={next}
      notice={checked ? 'Your email is checked. Log in to carry on.' : null}
      signupsOpen={signupsOpen()}
    />
  );
}
