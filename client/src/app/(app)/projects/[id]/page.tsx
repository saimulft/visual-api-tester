import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Workspace } from '@/components/workspace/workspace';
import { isApiError } from '@/contracts/common';
import { apiKeys, datasets, presets, projects, projectStats, runs, schedules } from '@/server/services';
import { mcpStatus } from '@/server/services/mcp-status';
import { pageCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Project' };

/** Screen 06: the project workspace (controls, Run, results). */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await pageCtx(`/projects/${id}`);
  const project = await projects.get(ctx, id).catch((error) => {
    if (isApiError(error) && error.status === 404) notFound();
    throw error;
  });
  if (!project.spec) redirect(`/projects/${id}/setup`);

  const [presetList, lastRun, scheduleList, datasetList, keyList, mcp] = await Promise.all([
    presets.list(ctx, id),
    runs.latest(ctx, id),
    schedules.list(ctx, { projectId: id }),
    datasets.list(ctx, { projectId: id }),
    apiKeys.list(ctx),
    mcpStatus(ctx).catch(() => null),
  ]);
  const setup = await projectStats.setupOf(ctx, id, mcp?.clientName ?? null);
  const host = new URL(project.spec.api.baseUrl).host;
  const key =
    project.spec.api.auth.type === 'none'
      ? null
      : (keyList.find((k) => k.id === project.apiKeyId) ??
        keyList.find((k) => k.apiSlug === project.spec!.api.slug && k.host === host) ??
        null);

  return (
    <Workspace
      project={{ ...project, spec: project.spec }}
      presets={presetList}
      lastRun={lastRun}
      schedule={scheduleList.find((s) => s.status === 'on') ?? scheduleList[0] ?? null}
      datasets={datasetList}
      apiKey={
        key
          ? { id: key.id, last4: key.last4, masked: key.masked, ok: key.lastTestOk, creditsLeft: key.creditsLeft }
          : null
      }
      setup={setup}
      timezone={ctx.user.timezone}
    />
  );
}
