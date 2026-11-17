import { checkQuery, route } from '@/server/http';
import { presets } from '@/server/services';
import { z } from 'zod';

/** GET ?projectId: a project's presets; POST { projectId, name, values } saves one. */
export const GET = route(async ({ ctx, query }) => {
  const { projectId } = checkQuery(z.object({ projectId: z.string().min(1) }), query);
  return { presets: await presets.list(ctx, projectId) };
});

export const POST = route(async ({ ctx, body }) =>
  Response.json({ preset: await presets.create(ctx, await body()) }, { status: 201 }),
);
