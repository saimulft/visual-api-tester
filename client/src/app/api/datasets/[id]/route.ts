import { route } from '@/server/http';
import { datasets } from '@/server/services';

/** One dataset: GET it, PATCH its name or save mode, DELETE it and its rows. */
export const GET = route(async ({ ctx, params }) => ({ dataset: await datasets.get(ctx, params.id) }));

export const PATCH = route(async ({ ctx, params, body }) => ({
  dataset: await datasets.update(ctx, params.id, await body()),
}));

export const DELETE = route(async ({ ctx, params }) => {
  await datasets.remove(ctx, params.id);
});
