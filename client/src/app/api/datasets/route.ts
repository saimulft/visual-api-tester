import { route } from '@/server/http';
import { datasets } from '@/server/services';

const DAY = 24 * 60 * 60 * 1000;
const SINCE: Record<string, number> = { day: DAY, week: 7 * DAY, month: 31 * DAY };

/** GET the person's datasets (?projectId, ?since=day|week|month, ?q); POST makes one (and saves ?runId). */
export const GET = route(async ({ ctx, query }) => {
  const since = SINCE[query.get('since') ?? ''];
  return {
    datasets: await datasets.list(ctx, {
      projectId: query.get('projectId') ?? undefined,
      q: query.get('q') ?? undefined,
      since: since ? ctx.now - since : undefined,
    }),
  };
});

export const POST = route(async ({ ctx, body }) =>
  Response.json({ dataset: await datasets.create(ctx, await body()) }, { status: 201 }),
);
