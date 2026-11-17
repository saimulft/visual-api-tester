import { route } from '@/server/http';
import { aiKeys } from '@/server/services';

/** One AI key: PATCH its model, label or secret; DELETE removes it. */
export const PATCH = route(async ({ ctx, params, body }) => ({
  key: await aiKeys.update(ctx, params.id, await body()),
}));

export const DELETE = route(async ({ ctx, params }) => {
  await aiKeys.remove(ctx, params.id);
});
