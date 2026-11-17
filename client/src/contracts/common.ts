// Adapted from dl-cms/cms/src/contracts/common.ts
import type { z } from 'zod';

/** A field-level problem: where it is (a dot path) and what's wrong, in plain words. */
export type Problem = { path: string; message: string };

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/** Errors from the API keep a stable code, the HTTP status and optional field problems. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly problems: Problem[];

  constructor(code: string, message: string, status = 400, problems: Problem[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.problems = problems;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** The JSON body every API error has: { error: { code, message, problems? } }. */
export type ErrorBody = { error: { code: string; message: string; problems?: Problem[] } };

/** Zod issues as problems, paths joined with dots ("endpoints.0.path"). */
export function problemsOf(error: z.ZodError): Problem[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/** Common errors, so the same thing reads the same everywhere. */
export const errors = {
  notFound: (what = 'That') => new ApiError('not_found', `${what} wasn't found.`, 404),
  invalid: (problems: Problem[], message = 'Some fields need a fix.') =>
    new ApiError('invalid', message, 422, problems),
  unauthenticated: () => new ApiError('unauthenticated', 'Log in to continue.', 401),
  emailUnchecked: () =>
    new ApiError('email_unchecked', 'Check your email to start. We sent you a link when you signed up.', 403),
  forbidden: (message = "You can't do that.") => new ApiError('forbidden', message, 403),
  conflict: (message = 'That already exists.') => new ApiError('conflict', message, 409),
  rateLimited: (retryAfterSeconds: number) =>
    new ApiError(
      'rate_limited',
      `Too many tries. Wait ${retryAfterSeconds < 120 ? `${retryAfterSeconds} seconds` : `${Math.ceil(retryAfterSeconds / 60)} minutes`} and try again.`,
      429,
    ),
};
