import { checkBody, MINUTE, rateLimit, route } from '@/server/http';
import { RunStartSchema } from '@/contracts/workspace';
import { startRun } from '@/server/runner';
import { runs } from '@/server/services';

/** How long POST waits for a run before answering "still running" (the page then polls GET /api/runs/[id]). */
const WAIT_MS = 25_000;

/** GET the person's runs (?projectId, ?scheduleId, ?limit); POST starts a manual run. */
export const GET = route(async ({ ctx, query }) => ({
  runs: await runs.list(ctx, {
    projectId: query.get('projectId') ?? undefined,
    scheduleId: query.get('scheduleId') ?? undefined,
    limit: Number(query.get('limit')) || undefined,
  }),
}));

export const POST = route(async ({ ctx, body }) => {
  rateLimit(`runs:${ctx.user.id}`, 20, MINUTE);
  const input = checkBody(RunStartSchema, await body());
  const { runId, done } = await startRun(ctx, input.projectId, {
    values: input.values,
    presetId: input.presetId ?? null,
    datasetId: input.datasetId ?? null,
    confirmCredits: input.confirmCredits,
    trigger: 'manual',
  });
  const finished = await Promise.race([done, new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS))]);
  if (finished) return { run: await runs.get(ctx, finished.runId) };
  return Response.json({ run: await runs.get(ctx, runId) }, { status: 202 });
});
