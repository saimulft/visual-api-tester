// Adapted from dl-cms/cms/src/server/db/index.ts (pg driver and AsyncLocalStorage transactions), rebuilt on Kysely.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteDialect, type Transaction } from 'kysely';
import pg from 'pg';
import type { z } from 'zod';
import type { Database } from './schema';

/**
 * The database: SQLite (better-sqlite3) by default, Postgres (pg) when DATABASE_URL is a postgres URL.
 *
 * - `db` is a Kysely<Database>. Inside `transaction(fn)` it is that transaction, so services never pass a
 *   `trx` around. Nested calls join the outer transaction.
 * - `dialect` says which one runs. Migrations branch on it for the few spots that differ.
 * - Values are portable: ids are text from newId(), times are ms numbers from now(), JSON is text written
 *   with json() and read with parseJson(), and booleans are read with bool() (SQLite returns 0 or 1).
 */
export type Dialect = 'sqlite' | 'postgres';
export type Db = Kysely<Database>;

const DEFAULT_SQLITE = './.data/dialed.db';

/** Which database a URL means. Unset or `file:` is SQLite; postgres:// or postgresql:// is Postgres. */
export function dialectOf(url: string | undefined): Dialect {
  if (!url || url.startsWith('file:')) return 'sqlite';
  if (/^postgres(ql)?:\/\//.test(url)) return 'postgres';
  throw new Error('DATABASE_URL must be unset, a file: path or a postgres:// URL.');
}

export const dialect: Dialect = dialectOf(process.env.DATABASE_URL);

/** The SQLite file a `file:` URL (or no URL) points at. */
export function sqlitePath(url: string | undefined): string {
  const raw = url?.startsWith('file:') ? url.slice('file:'.length) : DEFAULT_SQLITE;
  return raw.replace(/^\/\/(?=\/)/, '') || DEFAULT_SQLITE;
}

// int8 (bigint columns, count(*)) comes back as a JS number. Times in ms and counts stay well under 2^53.
pg.types.setTypeParser(20, (value) => Number(value));

/** better-sqlite3 can't bind booleans: they go in as 1 or 0, like SQLite stores them. */
function sqliteValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function sqliteDatabase(file: string) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const raw = new BetterSqlite3(file);
  raw.pragma('journal_mode = WAL');
  raw.pragma('busy_timeout = 5000');
  raw.pragma('foreign_keys = ON');
  return {
    close: () => raw.close(),
    prepare(sql: string) {
      const statement = raw.prepare(sql);
      const params = (values: ReadonlyArray<unknown>) => values.map(sqliteValue);
      return {
        reader: statement.reader,
        all: (values: ReadonlyArray<unknown>) => statement.all(...params(values)),
        run: (values: ReadonlyArray<unknown>) => statement.run(...params(values)),
        iterate: (values: ReadonlyArray<unknown>) => statement.iterate(...params(values)),
      };
    },
  };
}

/** A new Kysely for a URL. The app uses `db`; scripts and the race tests open their own. */
export function createKysely(url: string | undefined = process.env.DATABASE_URL): Db {
  if (dialectOf(url) === 'sqlite') {
    return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqliteDatabase(sqlitePath(url)) }) });
  }
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX || 10) });
  pool.on('error', (error) => console.error('[db] idle client error', error.message));
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

const globals = globalThis as unknown as { __dialedDb?: Db | null };
const txStorage = new AsyncLocalStorage<Transaction<Database>>();

/** Created on first use, so builds never open a database they don't need. */
function root(): Db {
  if (!globals.__dialedDb) globals.__dialedDb = createKysely();
  return globals.__dialedDb;
}

/** The app's database, or the current transaction inside transaction(). */
export const db: Db = new Proxy({} as Db, {
  get(_target, property) {
    const target: object = txStorage.getStore() ?? root();
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

/** Runs fn in one transaction; `db` inside it is the transaction. Nested calls join the outer one. */
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (txStorage.getStore()) return fn();
  return root()
    .transaction()
    .execute((trx) => txStorage.run(trx, fn));
}

/** True inside transaction(). */
export function inTransaction(): boolean {
  return Boolean(txStorage.getStore());
}

/** Closes the database (scripts call it so the process can exit, tests between files). */
export async function closeDb() {
  const current = globals.__dialedDb;
  globals.__dialedDb = null;
  await current?.destroy();
}

/** A new id: random, URL-safe text made in the app (never by the database). */
export function newId(): string {
  return randomUUID();
}

/** Now in ms, the unit every *_at column uses. */
export function now(): number {
  return Date.now();
}

/** A JSON column value. undefined and null become SQL NULL, never the text "null". */
export function json(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/** Reads a JSON column through a schema. NULL reads as null, so make the schema nullable or give it a default. */
export function parseJson<S extends z.ZodType>(schema: S, text: string | null | undefined): z.output<S> {
  return schema.parse(text === null || text === undefined ? null : JSON.parse(text));
}

/** A boolean column: SQLite returns 0 or 1, Postgres true or false. */
export function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

/** A LIKE pattern for a search box, wildcards in the text matching literally. Use as `lower(col) like ?` with escape '\'. */
export function likePattern(text: string): string {
  return `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Rows changed by an update or delete result (Kysely gives a bigint). */
export function changed(result: { numUpdatedRows?: bigint; numDeletedRows?: bigint } | undefined): number {
  return Number(result?.numUpdatedRows ?? result?.numDeletedRows ?? 0);
}
