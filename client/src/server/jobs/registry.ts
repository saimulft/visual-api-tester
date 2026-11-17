import { authJobs } from '../auth/jobs';
import { setupJobs } from '../setup/jobs';
import { scheduleJobs } from '../schedules/job';
import type { JobSpec } from './index';

/** Every feature's scheduled jobs. Add a feature's list with one import and one spread; each feature owns its file. */
export function allJobs(): JobSpec[] {
  return [...authJobs, ...setupJobs, ...scheduleJobs];
}
