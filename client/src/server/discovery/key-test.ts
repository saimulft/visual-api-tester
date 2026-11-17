import { z } from 'zod';
import { ApiError } from '@/contracts/common';
import { checkBody } from '../http/inputs';
import { guardedFetch, GuardError } from '../net/guarded-fetch';
import type { Ctx } from '../services/context';
import { requireCheckedEmail } from '../services/context';
import { directoryEntry } from './directory';
import { limitDiscovery } from './fetch';

/**
 * "Test it with one free search before saving" on New project: one call the directory knows is free, with the
 * key in the place the API wants it, before the key goes in the vault. The key is sent only to the API's own
 * host and never comes back in the answer.
 */
const KeyTestSchema = z.object({
  slug: z.string().trim().min(1).max(48),
  secret: z.string().trim().min(4, 'Paste the key.').max(4000),
});

export type ApiKeyTestResult = {
  ok: boolean;
  status: number | null;
  message: string;
  creditsLeft: number | null;
  /** False when the directory has no free test for this API (the setup's own test call checks it). */
  tested: boolean;
};

export async function testApiKey(ctx: Ctx, input: unknown): Promise<ApiKeyTestResult> {
  requireCheckedEmail(ctx);
  const { slug, secret } = checkBody(KeyTestSchema, input);
  limitDiscovery(ctx.user.id);
  const entry = directoryEntry(slug);
  const test = entry?.keyTest;
  const key = entry?.key;
  if (!entry || !test || !key || key.in === 'none' || key.in === 'unknown')
    return {
      ok: true,
      status: null,
      message: 'There’s no free test for this API, so the AI checks the key with its test call.',
      creditsLeft: null,
      tested: false,
    };
  const url = new URL(test.url);
  if (url.host !== entry.apiHost) throw new ApiError('wrong_host', 'That test points at another host.', 500);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (key.in === 'header') headers[key.name] = `${key.prefix ?? ''}${secret}`;
  else url.searchParams.set(key.name, secret);
  if (test.body !== undefined) headers['content-type'] = 'application/json';
  try {
    const res = await guardedFetch(
      url,
      { method: test.method, headers, body: test.body === undefined ? null : JSON.stringify(test.body) },
      { timeoutMs: 20_000, maxBytes: 2 * 1024 * 1024, maxRedirects: 0, secretHeaders: Object.keys(headers) },
    );
    const credits = test.creditsHeader ? Number(res.headers.get(test.creditsHeader)) : NaN;
    const creditsLeft = Number.isFinite(credits) ? credits : null;
    if (res.ok)
      return {
        ok: true,
        status: res.status,
        message: `It works. ${entry.name} answered in ${(res.ms / 1000).toFixed(1)} s${creditsLeft !== null ? `, with ${creditsLeft.toLocaleString('en')} credits left` : ''}.`,
        creditsLeft,
        tested: true,
      };
    const message =
      res.status === 401 || res.status === 403
        ? `${entry.name} didn’t accept that key. Check that you pasted all of it.`
        : res.status === 402
          ? `${entry.name} says the account is out of credits.`
          : res.status === 429
            ? `${entry.name} said slow down. Try again in a minute.`
            : `${entry.name} answered ${res.status}.`;
    return { ok: false, status: res.status, message, creditsLeft, tested: true };
  } catch (error) {
    const message = error instanceof GuardError ? error.message : 'The API couldn’t be reached.';
    return { ok: false, status: null, message, creditsLeft: null, tested: true };
  }
}
