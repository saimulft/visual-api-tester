// Adapted from dl-cms/cms/src/server/http/errors.ts
import { NextResponse } from 'next/server';
import { ApiError, type ErrorBody } from '@/contracts/common';

/**
 * Every API error has one shape: { error: { code, message, problems? } } with the ApiError's status.
 * Anything that isn't an ApiError is logged and becomes a 500 without details.
 */
export function asApiError(error: unknown): ApiError | null {
  if (error instanceof ApiError) return error;
  // A second copy of the class (another bundle) still counts: same fields.
  const e = error as Partial<ApiError> | null;
  if (e && typeof e === 'object' && e.name === 'ApiError' && typeof e.code === 'string' && typeof e.status === 'number')
    return new ApiError(e.code, e.message ?? '', e.status, e.problems ?? []);
  // Unique violations a service didn't turn into a friendlier error: Postgres 23505, SQLite SQLITE_CONSTRAINT_UNIQUE.
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
  if (code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE')
    return new ApiError('conflict', 'That already exists.', 409);
  return null;
}

export function errorBody(error: ApiError): ErrorBody {
  return {
    error: { code: error.code, message: error.message, ...(error.problems.length ? { problems: error.problems } : {}) },
  };
}

export function errorResponse(error: unknown, headers?: HeadersInit): Response {
  const known = asApiError(error);
  if (known) return NextResponse.json(errorBody(known), { status: known.status, headers });
  console.error('[api] unexpected error', error);
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'Something went wrong on our side. Try again.' } },
    { status: 500, headers },
  );
}
