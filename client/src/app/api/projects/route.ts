import { route } from '@/server/http';
import { projects } from '@/server/services';

/** GET the person's projects (?archived=1 for archived ones); POST creates one. */
export const GET = route(async ({ ctx, query }) => ({
  projects: await projects.list(ctx, { archived: query.get('archived') === '1' }),
}));

export const POST = route(async ({ ctx, body }) =>
  Response.json({ project: await projects.create(ctx, await body()) }, { status: 201 }),
);
