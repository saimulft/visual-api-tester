import { authJobs } from '../auth/jobs';
import type { JobSpec } from './index';

/** Every feature's scheduled jobs. Add a feature's list with one import and one spread; each feature owns its file. */
export function allJobs(): JobSpec[] {
  return [...authJobs];
}
