import { route } from '@/server/http';
import { datasets } from '@/server/services';

/** POST { runId, mode? }: saves a finished run's rows into this dataset. */
export const POST = route(async ({ ctx, params, body }) => ({
  saved: await datasets.saveRun(ctx, params.id, await body()),
  dataset: await datasets.get(ctx, params.id),
}));
