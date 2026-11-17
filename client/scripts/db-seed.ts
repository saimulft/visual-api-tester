import { closeDb } from '../src/server/db';
import { migrate } from '../src/server/db/migrate';
import { assertLocalDatabase, seed } from '../src/server/seed';

/**
 * npm run db:seed: nadia@dialed.test and new@dialed.test with SEED_PASSWORD, and three ready projects.
 * Refuses anything but a local database (unset, a file, or 127.0.0.1). Runs migrations first.
 */
async function main() {
  assertLocalDatabase();
  const password = process.env.SEED_PASSWORD;
  if (!password) throw new Error('Set SEED_PASSWORD (in .env) first.');
  await migrate(undefined, (line) => console.log(line));
  await seed(password);
}

main()
  .catch((error) => {
    console.error('[seed] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
