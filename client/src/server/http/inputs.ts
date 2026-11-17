// Adapted from dl-cms/cms/src/server/http/inputs.ts
import type { z } from 'zod';
import { ApiError, problemsOf } from '@/contracts/common';

/** Checks input against a schema. Problems come back with field paths; the first one is the message. */
export function check<S extends z.ZodType>(schema: S, input: unknown, status = 422): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const problems = problemsOf(result.error);
  const first = problems[0];
  throw new ApiError(
    status === 400 ? 'bad_request' : 'invalid',
    first?.message ?? 'Check the request.',
    status,
    problems,
  );
}

/** A JSON body against a schema: a 422 with field problems when it doesn't fit. */
export function checkBody<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  return check(schema, input, 422);
}

/** A query string against a schema (lists come as repeated keys). A 400 when it doesn't fit. */
export function checkQuery<S extends z.ZodType>(schema: S, query: URLSearchParams, lists: string[] = []): z.output<S> {
  const input: Record<string, unknown> = {};
  for (const key of new Set(query.keys())) input[key] = lists.includes(key) ? query.getAll(key) : query.get(key);
  return check(schema, input, 400);
}
