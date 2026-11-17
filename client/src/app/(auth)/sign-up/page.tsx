import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { signupsOpen, SIGNUPS_CLOSED_MESSAGE } from '@/server/services/auth';
import { currentCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Sign up' };

export default async function SignUpPage() {
  if (await currentCtx()) redirect('/projects');
  return <SignUpForm open={signupsOpen()} closedMessage={SIGNUPS_CLOSED_MESSAGE} />;
}
