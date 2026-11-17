import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ConnectAi, OnboardingTop } from '@/components/onboarding/connect-ai';
import { baseUrlFrom, resourceUrl } from '@/server/oauth';
import { aiKeys, mcpStatus } from '@/server/services';
import { pageCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Connect your AI' };

/** Screen 02: Connect your AI, step 2 of 3. */
export default async function ConnectAiPage() {
  const ctx = await pageCtx('/welcome/ai');
  const [summary, status] = await Promise.all([aiKeys.summary(ctx), mcpStatus(ctx)]);
  const address = resourceUrl(baseUrlFrom(await headers()), ctx.user.mcpHandle);
  return (
    <>
      <OnboardingTop step={2} />
      <ConnectAi summary={summary} address={address} mcp={status} />
    </>
  );
}
