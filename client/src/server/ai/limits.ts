// Adapted from dl-cms/cms/src/server/ai/limits.ts (one person, no organization budgets: fixed setup limits)
import { ApiError } from '@/contracts/common';
import { rateLimit } from '../http/rate-limit';
import type { Ctx } from '../services/context';

/**
 * What one AI setup may use, and how often a person may call the AI. The setup loop stops at any limit and
 * says which one in plain words.
 */
export const SETUP_LIMITS = {
  /** Docs pages and OpenAPI files read. */
  pages: 25,
  /** Tool calls in all. */
  toolCalls: 80,
  /** Wall-clock time. */
  ms: 15 * 60_000,
  /** The most one provider call may write. */
  maxOutput: 32_000,
} as const;

/** Setups a person may have running at once. */
export const MAX_RUNNING_SETUPS = 2;

/** Key tests and model lists: enough to try a few keys, not to hammer a provider. */
export function limitKeyChecks(ctx: Ctx) {
  try {
    rateLimit(`ai-check:${ctx.user.id}`, 20, 10 * 60_000);
  } catch {
    throw new ApiError(
      'rate_limited',
      'That’s a lot of key checks in a short time. Wait a few minutes and try again.',
      429,
    );
  }
}

/** Starting setups: a handful per hour per person. */
export function limitSetups(ctx: Ctx) {
  try {
    rateLimit(`setup:${ctx.user.id}`, 12, 60 * 60_000);
  } catch {
    throw new ApiError('rate_limited', 'That’s a lot of setups in an hour. Wait a while and try again.', 429);
  }
}
