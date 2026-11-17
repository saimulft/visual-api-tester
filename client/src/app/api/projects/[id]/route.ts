import { route } from '@/server/http';
import { projects } from '@/server/services';

/** One project: GET it, PATCH its fields, DELETE archives it (its data stays). */
export const GET = route(async ({ ctx, params }) => ({ project: await projects.get(ctx, params.id) }));

export const PATCH = route(async ({ ctx, params, body }) => ({
  project: await projects.update(ctx, params.id, await body()),
}));

export const DELETE = route(async ({ ctx, params }) => ({ project: await projects.archive(ctx, params.id) }));
