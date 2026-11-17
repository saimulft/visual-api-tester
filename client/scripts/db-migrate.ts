// Adapted from dl-cms/cms/scripts/db-migrate.mjs
import { closeDb, dialect } from '../src/server/db';
import { migrate } from '../src/server/db/migrate';

/** npm run db:migrate: applies pending migrations to whichever DATABASE_URL is set (SQLite when unset). */
async function main() {
  console.log(`[db] migrating ${dialect}`);
  const applied = await migrate();
  console.log(applied ? `[db] ${applied} applied` : '[db] up to date');
}

main()
  .catch((error) => {
    console.error('[db] migration failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
