import { SqliteAdapter, type ColumnDefinitionBuilder, type CreateTableBuilder, type Kysely } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Builder = CreateTableBuilder<any, any>;

/** Which database a migration runs on, read from the Kysely it gets. */
export function migrationDialect(db: Kysely<unknown>): 'sqlite' | 'postgres' {
  return db.getExecutor().adapter instanceof SqliteAdapter ? 'sqlite' : 'postgres';
}

/**
 * An auto id column, the one kind of id the database makes: `integer primary key` on SQLite (the rowid) and
 * `bigserial primary key` on Postgres.
 */
export function autoId(db: Kysely<unknown>, table: Builder, column = 'id'): Builder {
  if (migrationDialect(db) === 'sqlite') return table.addColumn(column, 'integer', (c) => c.primaryKey());
  return table.addColumn(column, 'bigserial', (c) => c.primaryKey());
}

/** created_at and updated_at, both ms. */
export function stamps(table: Builder, updated = true): Builder {
  const withCreated = table.addColumn('created_at', 'bigint', (c) => c.notNull());
  return updated ? withCreated.addColumn('updated_at', 'bigint', (c) => c.notNull()) : withCreated;
}

/** A required text column with a default. */
export const textDefault = (value: string) => (c: ColumnDefinitionBuilder) => c.notNull().defaultTo(value);
