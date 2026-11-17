import { z } from 'zod';
import { EXPORT_FORMATS } from '@/contracts/datasets';
import { recordsResponse } from '@/server/datasets/export';
import { checkQuery, route } from '@/server/http';
import { recallRecords } from '@/server/runner';
import { runs } from '@/server/services';

/** GET ?format=csv|xlsx|json: one run's rows as a file. */
export const GET = route(async ({ ctx, params, query }) => {
  const { format } = checkQuery(z.object({ format: z.enum(EXPORT_FORMATS).default('csv') }), query);
  const run = await runs.get(ctx, params.id);
  const records = recallRecords(ctx.user.id, run.runId) ?? run.sample;
  const day = new Date(run.startedAt).toISOString().slice(0, 10);
  return recordsResponse(`${run.projectName} ${day}`, records, format);
});
