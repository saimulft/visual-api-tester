import type { Kysely } from 'kysely';
import { Migrator } from 'kysely/migration';
import { db as appDb } from './index';
import { migrations } from './migrations';

type Log = (line: string) => void;

/** Applies every pending migration. Throws (and logs which one) when one fails. */
export async function migrate(target: Kysely<unknown> = appDb as unknown as Kysely<unknown>, log: Log = console.log) {
  const migrator = new Migrator({
    db: target,
    provider: { getMigrations: async () => migrations },
    migrationTableName: 'kysely_migration',
    migrationLockTableName: 'kysely_migration_lock',
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const result of results ?? []) {
    if (result.status === 'Success') log(`[db] applied ${result.migrationName}`);
    if (result.status === 'Error') log(`[db] failed ${result.migrationName}`);
  }
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').length;
}
