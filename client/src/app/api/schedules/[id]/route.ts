import { z } from 'zod';
import { checkBody, route } from '@/server/http';
import { schedules } from '@/server/services';

/** One schedule: GET it, PATCH { status } pauses or resumes it, DELETE removes it. */
export const GET = route(async ({ ctx, params }) => ({ schedule: await schedules.get(ctx, params.id) }));

export const PATCH = route(async ({ ctx, params, body }) => {
  const { status } = checkBody(z.object({ status: z.enum(['on', 'paused']) }), await body());
  return { schedule: await schedules.setStatus(ctx, params.id, status) };
});

export const DELETE = route(async ({ ctx, params }) => {
  await schedules.remove(ctx, params.id);
});
