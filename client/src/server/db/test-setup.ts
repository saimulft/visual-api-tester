// Adapted from dl-cms/cms/src/server/db/testing.ts (PGlite in tests), now a Vitest setup file for both databases.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

/**
 * Runs before each test file's imports, so `dialect` and `db` see this file's own database:
 * - SQLite (default): a new file in the temp folder.
 * - TEST_DB=postgres: an in-memory PGlite served over a socket and reached through `pg`, the production driver.
 */
const cleanups: (() => Promise<void> | void)[] = [];

if (process.env.TEST_DB === 'postgres') {
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const pglite = await PGlite.create();
  const server = new PGLiteSocketServer({ db: pglite, port: 0, host: '127.0.0.1', maxConnections: 10 });
  await server.start();
  process.env.DATABASE_URL = `postgresql://postgres@${server.getServerConn()}/postgres`;
  cleanups.push(
    () => server.stop(),
    () => pglite.close(),
  );
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialed-test-'));
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
}

afterAll(async () => {
  const { closeDb } = await import('./index');
  await closeDb();
  for (const cleanup of cleanups) await cleanup();
});
