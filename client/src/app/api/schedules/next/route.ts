import { z } from 'zod';
import { CADENCES } from '@/contracts/schedules';
import { checkBody, route } from '@/server/http';
import { schedules } from '@/server/services';

const TimingSchema = z.object({
  cadence: z.enum(CADENCES),
  days: z.array(z.number().int().min(0).max(6)).default([]),
  dayOfMonth: z.number().int().min(1).max(28).nullable().default(null),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).max(64),
});

/** POST timing (saved or not): the next three runs, for the editor's live list. */
export const POST = route(async ({ ctx, body }) => ({
  next: await schedules.nextRuns(ctx, checkBody(TimingSchema, await body())),
}));
