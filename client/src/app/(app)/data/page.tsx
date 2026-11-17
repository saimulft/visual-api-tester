import type { Metadata } from 'next';
import { SavedData } from '@/components/data/saved-data';
import { datasets, projects } from '@/server/services';
import { pageCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'Saved data' };

/** Screen 08: saved data, with the preview, the detail panel, exports and the live CSV link. */
export default async function DataPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const ctx = await pageCtx('/data');
  const [list, projectList] = await Promise.all([datasets.list(ctx), projects.list(ctx)]);
  const selectedId = list.find((d) => d.id === id)?.id ?? list[0]?.id ?? null;
  const [detail, rows] = selectedId
    ? await Promise.all([datasets.get(ctx, selectedId), datasets.rows(ctx, selectedId, { pageSize: 50 })])
    : [null, null];
  return (
    <SavedData
      datasets={list}
      projects={projectList.map((p) => ({ id: p.id, name: p.name }))}
      initial={detail && rows ? { dataset: detail, rows } : null}
      timezone={ctx.user.timezone}
    />
  );
}
