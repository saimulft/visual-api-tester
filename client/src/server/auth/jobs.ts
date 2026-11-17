import { db, now } from '../db';
import type { JobSpec } from '../jobs';

const DAY = 24 * 60 * 60 * 1000;

/** Housekeeping: expired sessions, and email links that were used or ran out over a week ago. */
export const authJobs: JobSpec[] = [
  {
    name: 'auth-prune',
    everyMinutes: 60,
    lockMinutes: 10,
    run: async () => {
      const at = now();
      await db.deleteFrom('sessions').where('expires_at', '<', at).execute();
      await db
        .deleteFrom('email_tokens')
        .where((eb) => eb.or([eb('expires_at', '<', at - 7 * DAY), eb('used_at', '<', at - 7 * DAY)]))
        .execute();
      await db.deleteFrom('oauth_codes').where('expires_at', '<', at).execute();
    },
  },
];
