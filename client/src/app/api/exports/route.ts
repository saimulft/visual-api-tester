import { z } from 'zod';
import { EXPORT_FORMATS } from '@/contracts/datasets';
import { exportResponse } from '@/server/datasets/export';
import { checkQuery, MINUTE, rateLimit, route } from '@/server/http';
import { datasets } from '@/server/services';

const ExportQuery = z.object({
  datasetId: z.string().min(1),
  format: z.enum(EXPORT_FORMATS).default('csv'),
  columns: z.string().optional(),
});

/** GET ?datasetId&format=csv|xlsx|json&columns=a,b: the dataset as a file, streamed. */
export const GET = route(async ({ ctx, query }) => {
  rateLimit(`exports:${ctx.user.id}`, 30, MINUTE);
  const input = checkQuery(ExportQuery, query);
  const dataset = await datasets.get(ctx, input.datasetId);
  const keys = input.columns ? input.columns.split(',').filter(Boolean) : null;
  return exportResponse(
    { id: dataset.id, name: dataset.name, columns: JSON.stringify(dataset.columns) },
    input.format,
    keys,
  );
});
