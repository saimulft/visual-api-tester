import type { Metadata } from 'next';
import { SchedulesScreen } from '@/components/schedules/schedules-screen';
import { datasets, projects, runs, schedules } from '@/server/services';
import { costOf } from '@/server/services/schedules';
import { pageCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Schedules' };

/** Screen 09: schedules, the editor (When, Each run), Run now, pause and resume, and recent runs. */
export default async function SchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; project?: string }>;
}) {
  const { id, project } = await searchParams;
  const ctx = await pageCtx('/schedules');
  const [list, projectList, datasetList] = await Promise.all([
    schedules.list(ctx),
    projects.list(ctx),
    datasets.list(ctx),
  ]);
  const ready = await Promise.all(
    projectList.filter((p) => p.status === 'ready' && p.specVersion > 0).map((p) => projects.get(ctx, p.id)),
  );
  const selected = list.find((s) => s.id === id) ?? (project ? null : list[0]) ?? null;
  const history = selected ? await runs.list(ctx, { scheduleId: selected.id, limit: 5 }) : [];
  return (
    <SchedulesScreen
      schedules={list}
      projects={ready
        .filter((p) => p.spec)
        .map((p) => {
          const cost = costOf(p.spec);
          return { id: p.id, name: p.name, monogram: p.monogram, perRecord: cost.perRecord, unit: cost.unit, keyed: p.spec!.api.auth.type !== 'none' };
        })}
      datasets={datasetList.map((d) => ({ id: d.id, projectId: d.projectId, name: d.name, saveMode: d.saveMode }))}
      initialId={selected?.id ?? null}
      newFor={!selected && project ? project : null}
      initialHistory={history}
      timezone={ctx.user.timezone}
    />
  );
}
