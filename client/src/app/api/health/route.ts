import { sql } from 'kysely';
import { NextResponse } from 'next/server';
import { db, dialect } from '@/server/db';
import packageJson from '../../../../package.json';

/** The health check: pings the database and returns the version. 503 when the database doesn't answer. */
export async function GET() {
  const started = Date.now();
  try {
    await sql`select 1`.execute(db);
    return NextResponse.json(
      { ok: true, version: packageJson.version, database: dialect, ms: Date.now() - started },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    console.error('[health] database check failed', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { ok: false, version: packageJson.version, database: dialect },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
