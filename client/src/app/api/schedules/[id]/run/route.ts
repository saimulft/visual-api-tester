import { ApiError } from '@/contracts/common';
import { db, now } from '@/server/db';
import { claim } from '@/server/db/claim';
import { MINUTE, rateLimit, route } from '@/server/http';
import { runSchedule } from '@/server/schedules/job';
import { runs, schedules } from '@/server/services';

/**
 * POST runs a schedule now, the way its time would: its values, its dataset, its credit limit and its
 * emails. It claims the schedule first, so it can't overlap a run the scheduler started.
 */
export const POST = route(async ({ ctx, params }) => {
  rateLimit(`schedule-run:${ctx.user.id}`, 10, MINUTE);
  const schedule = await schedules.get(ctx, params.id);
  const row = await db.selectFrom('schedules').selectAll().where('id', '=', schedule.id).executeTakeFirstOrThrow();
  const at = now();
  if (!(await claim('schedules', schedule.id, at + 3 * 60 * 60 * 1000, at)))
    throw new ApiError('already_running', 'This schedule is running right now.', 409);
  // Run now keeps the schedule's next time where it was.
  const result = await runSchedule(row, { keepNext: true });
  if (!result) throw new ApiError('not_started', 'The run couldn’t start. Check the project and try again.', 409);
  return { run: await runs.get(ctx, result.runId), schedule: await schedules.get(ctx, schedule.id) };
});
