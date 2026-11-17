import type { Metadata } from 'next';
import { stripOf } from '@/components/projects/cards';
import { ProjectsHome, type ProjectCard } from '@/components/projects/projects-home';
import { ValuesSchema } from '@/contracts/spec';
import { defaultValues } from '@/contracts/values';
import { aiSummary, mcpStatus, projects, projectStats, runs } from '@/server/services';
import { pageCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Projects' };

/** Screen 03: Projects, with the KPI strip, the project cards and recent runs. */
export default async function ProjectsPage() {
  const ctx = await pageCtx('/projects');
  const [summaries, stats, recent, latest, mcp, ai] = await Promise.all([
    projects.list(ctx),
    projectStats.forUser(ctx),
    runs.list(ctx, { limit: 200 }),
    projectStats.latestValues(ctx),
    mcpStatus(ctx).catch(() => null),
    aiSummary(ctx).catch(() => null),
  ]);
  const full = await Promise.all(summaries.map((p) => projects.get(ctx, p.id)));

  const cards: ProjectCard[] = full.map((project) => {
    const spec = project.spec;
    const per = stats.perProject[project.id];
    let values = spec ? defaultValues(spec) : {};
    if (spec && latest[project.id]) {
      const parsed = ValuesSchema.safeParse(JSON.parse(latest[project.id]));
      if (parsed.success) values = { ...values, ...parsed.data };
    }
    const { strip, chips } = spec ? stripOf(spec, values) : { strip: null, chips: [] };
    const endpoints = spec?.endpoints.length ?? 0;
    const apiLine = spec
      ? [
          project.apiName || spec.api.name,
          spec.endpoints.find((e) => e.id === (spec.run.mode === 'searchThenCollect' ? spec.run.searchId : spec.run.endpointId))
            ?.label,
          spec.api.auth.type === 'none' ? 'no key needed' : `${endpoints} ${endpoints === 1 ? 'endpoint' : 'endpoints'}`,
        ]
          .filter(Boolean)
          .join(' · ')
      : project.status === 'failed'
        ? 'Setup failed'
        : 'Not set up yet';
    return {
      id: project.id,
      name: project.name,
      monogram: project.monogram,
      keyed: Boolean(spec && spec.api.auth.type !== 'none'),
      apiLine,
      ready: Boolean(spec),
      status: project.status,
      strip,
      chips,
      rows: per?.rows ?? 0,
      schedule: per?.schedule ?? null,
      lastStatus: per?.lastStatus ?? null,
    };
  });

  return (
    <ProjectsHome
      cards={cards}
      stats={{ ...stats, perProject: {} }}
      recent={recent.filter((run, i) => recent.findIndex((r) => r.projectId === run.projectId) === i).slice(0, 5)}
      ai={{
        mcp: mcp?.connected ? (mcp.clientName ?? 'Your AI') : null,
        model: ai?.modelName ?? null,
        provider: ai?.provider ?? null,
      }}
      timezone={ctx.user.timezone}
    />
  );
}
