import type { Metadata } from 'next';
import { NewProject } from '@/components/new-project/new-project';
import { GENERAL_BRIEFS } from '@/server/discovery/directory';
import { aiKeys, apiKeys, mcpStatus } from '@/server/services';
import { pageCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'New project' };

/** Screen 04: New project (also step 3 of 3 after Connect your AI). */
export default async function NewProjectPage() {
  const ctx = await pageCtx('/projects/new');
  const [ai, mcp, keys] = await Promise.all([aiKeys.summary(ctx), mcpStatus(ctx), apiKeys.list(ctx)]);
  return (
    <NewProject
      emailChecked={ctx.user.emailChecked}
      ai={ai}
      mcp={mcp}
      savedKeys={keys}
      generalBriefs={GENERAL_BRIEFS}
    />
  );
}
