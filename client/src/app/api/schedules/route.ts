import { route } from '@/server/http';
import { schedules } from '@/server/services';

/** GET the person's schedules (?projectId); POST makes or changes one (an `id` changes it). */
export const GET = route(async ({ ctx, query }) => ({
  schedules: await schedules.list(ctx, { projectId: query.get('projectId') ?? undefined }),
}));

export const POST = route(async ({ ctx, body }) => {
  const input = await body();
  const schedule = await schedules.upsert(ctx, input);
  return Response.json({ schedule }, { status: input.id ? 200 : 201 });
});
