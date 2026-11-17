import { pageCtx } from '@/server/services/page-context';

/** The onboarding steps after the account: a page of their own, without the rail. Signed in only. */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  await pageCtx('/welcome/ai');
  return <div className="onb">{children}</div>;
}
