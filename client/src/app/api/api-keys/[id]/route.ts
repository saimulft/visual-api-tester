import { route } from '@/server/http';
import { apiKeys } from '@/server/services';

/** One saved key: PUT a new secret in its place (same id, so projects keep it); DELETE removes it. */
export const PUT = route(async ({ ctx, params, body }) => ({
  key: await apiKeys.replace(ctx, params.id, await body()),
}));

export const DELETE = route(async ({ ctx, params }) => {
  await apiKeys.remove(ctx, params.id);
});
