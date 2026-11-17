// Adapted from dl-cms/cms/scripts/db-local.mjs
/**
 * A throwaway Postgres: in-process PGlite served over the normal Postgres protocol, so the app, pg and psql
 * connect to it like any server. Data stays in LOCAL_DB_DIR (delete the folder to start over, or use
 * "memory"). Nothing touches a real server.
 *
 *   npm run db:pg                                          # 127.0.0.1:5530, ./.pglite
 *   LOCAL_DB_PORT=5531 LOCAL_DB_DIR=.pglite-a npm run db:pg  # a chat's own copy
 *
 * Then: DATABASE_URL=postgresql://postgres@127.0.0.1:5531/postgres npm run db:migrate (the app also
 * migrates when it starts).
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.LOCAL_DB_PORT || 5530);
const dataDir = process.env.LOCAL_DB_DIR || './.pglite';

const db = await PGlite.create(dataDir === 'memory' ? undefined : dataDir);
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
await server.start();
console.log(`[db-pg] Postgres (PGlite) on postgresql://postgres@127.0.0.1:${port}/postgres  data: ${dataDir}`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
