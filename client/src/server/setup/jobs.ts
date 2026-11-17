import type { JobSpec } from '../jobs';
import { failStale } from '../services/setups';

/** A built-in setup that hasn't moved for 20 minutes stopped with the server: it ends with Try again. */
export const setupJobs: JobSpec[] = [
  {
    name: 'setup-stale',
    everyMinutes: 5,
    lockMinutes: 4,
    run: () => failStale(20 * 60_000),
  },
];
