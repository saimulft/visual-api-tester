import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ChangeForm } from '@/components/setup/change-form';
import { SetupScreen } from '@/components/setup/setup-screen';
import { isApiError } from '@/contracts/common';
import { aiKeys, mcpStatus, projects } from '@/server/services';
import { pageCtx } from '@/server/services/page-context';
import { setups } from '@/server/setup';

export const metadata: Metadata = { title: 'Setting up' };

/**
 * Screen 05: the AI sets up the API, live. ?change=1 asks the AI for changes to a set-up project (a new setup
 * that starts from its spec); a project without any setup gets the same form.
 */
export default async function SetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ change?: string }>;
}) {
  const { id } = await params;
  const { change } = await searchParams;
  const ctx = await pageCtx(`/projects/${id}/setup`);
  const project = await projects.get(ctx, id).catch((error) => {
    if (isApiError(error) && error.status === 404) notFound();
    throw error;
  });
  const latest = await setups.latestFor(ctx, id);
  const view = latest ? await setups.view(ctx, latest) : null;
  const active = view && (view.setup.status === 'running' || view.setup.status === 'waiting');

  if (change === '1' && !active) {
    const [ai, mcp] = await Promise.all([aiKeys.summary(ctx), mcpStatus(ctx)]);
    return (
      <ChangeForm
        projectId={id}
        projectName={project.name}
        hasSpec={Boolean(project.spec)}
        canBuiltin={ai.keys > 0}
        modelName={ai.modelName}
        mcpClient={mcp.connected ? mcp.clientName : null}
        defaultVia={project.setupVia}
      />
    );
  }
  if (!view) {
    if (project.spec) redirect(`/projects/${id}`);
    redirect(`/projects/${id}/setup?change=1`);
  }
  const events = await setups.events(ctx, view.setup.id);
  return (
    <SetupScreen key={view.setup.id} initial={view} initialEvents={events} timeZone={ctx.user.timezone || 'UTC'} />
  );
}
