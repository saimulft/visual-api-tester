import { changed, db, type Db } from './index';

/**
 * Claims a row with a lock until `until` (ms). One update, `where id = ? and (locked_until is null or
 * locked_until < now)`, then exactly one changed row means this caller won. Works the same on SQLite and
 * Postgres, so two servers (or two ticks) never run the same job or schedule twice.
 */
export async function claim(
  table: 'jobs' | 'schedules',
  id: string,
  until: number,
  at: number = Date.now(),
  on: Db = db,
): Promise<boolean> {
  if (table === 'jobs') {
    const result = await on
      .updateTable('jobs')
      .set({ locked_until: until, last_run_at: at, last_status: 'running', updated_at: at })
      .where('name', '=', id)
      .where((eb) => eb.or([eb('locked_until', 'is', null), eb('locked_until', '<', at)]))
      .executeTakeFirst();
    return changed(result) === 1;
  }
  const result = await on
    .updateTable('schedules')
    .set({ locked_until: until, updated_at: at })
    .where('id', '=', id)
    .where((eb) => eb.or([eb('locked_until', 'is', null), eb('locked_until', '<', at)]))
    .executeTakeFirst();
  return changed(result) === 1;
}

/** Lets go of a claim. */
export async function release(table: 'jobs' | 'schedules', id: string) {
  if (table === 'jobs') await db.updateTable('jobs').set({ locked_until: null }).where('name', '=', id).execute();
  else await db.updateTable('schedules').set({ locked_until: null }).where('id', '=', id).execute();
}
