import { route } from '@/server/http';
import { presets } from '@/server/services';

/** One preset: PATCH renames it or saves new values; DELETE removes it. */
export const PATCH = route(async ({ ctx, params, body }) => ({
  preset: await presets.update(ctx, params.id, await body()),
}));

export const DELETE = route(async ({ ctx, params }) => {
  await presets.remove(ctx, params.id);
});
