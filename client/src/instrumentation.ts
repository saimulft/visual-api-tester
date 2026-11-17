// Adapted from dl-cms/cms/src/instrumentation.ts
/**
 * Runs once when the server starts, on the Node runtime only: applies pending migrations, then registers the
 * jobs and starts the one-minute tick (src/server/jobs).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { migrate } = await import('./server/db/migrate');
  await migrate(undefined, (line) => console.log(line));
  const { ensureJobs } = await import('./server/jobs');
  await ensureJobs();
}
