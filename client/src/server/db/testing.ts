// Adapted from dl-cms/cms/src/server/db/testing.ts
import { closeDb, db } from './index';
import { migrate } from './migrate';

/**
 * Each test file gets a fresh database of either kind (test-setup.ts picks it from TEST_DB before the file
 * loads). Call createTestDb() in beforeAll: it applies every migration. `npm test` runs SQLite and
 * `npm run test:pg` runs Postgres.
 */
export async function createTestDb() {
  await migrate(undefined, () => {});
  return {
    db,
    /** Empties the tables a test wrote to, children first. */
    async clear(...tables: Parameters<typeof db.deleteFrom>[0][]) {
      for (const table of tables) await db.deleteFrom(table).execute();
    },
    close: closeDb,
  };
}
