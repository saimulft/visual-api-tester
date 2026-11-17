// Adapted from dl-cms/cms/src/server/http/handle.ts
import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, errors } from '@/contracts/common';
import { loadSession } from '../auth/sessions';
import { ctxFor, sessionToken, type Ctx } from '../services/context';
import { clearSessionCookie, setSessionCookie, setsSessionCookie } from './cookies';
import { errorResponse } from './errors';

/**
 * Route plumbing. A route file is a few lines:
 *
 *   export const GET = route(({ ctx, params }) => projects.get(ctx, params.id));
 *
 * handle() checks Origin on requests that change state, loads the session from the cookie (renewing the
 * cookie when its expiry moved), runs the handler and turns the result into a response: a Response as is,
 * undefined as 204, anything else as JSON. ApiErrors keep their status; anything else is a logged 500.
 */
export type Params = Record<string, string>;
type NextContext = { params: Promise<Params> };

export type RouteArgs = {
  req: NextRequest;
  params: Params;
  query: URLSearchParams;
  ctx: Ctx;
  /** The raw cookie token (log out needs it). */
  token: string;
  /** The JSON body ({} when empty). Throws a 400 for invalid JSON. */
  body: () => Promise<Record<string, unknown>>;
  meta: { ip: string | null; userAgent: string | null };
};

export type PublicRouteArgs = Omit<RouteArgs, 'ctx' | 'token'> & { ctx: Ctx | null; token: string | null };

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_JSON_BYTES = 1024 * 1024;

function hostOf(url: string | undefined | null) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * CSRF guard for cookie-authenticated writes. A browser always sends Origin on cross-site requests; it must
 * be this app. Requests without Origin (curl, server to server) pass unless Sec-Fetch-Site says cross-site.
 */
export function checkOrigin(req: Request) {
  if (!UNSAFE.has(req.method)) return;
  const origin = req.headers.get('origin');
  if (!origin) {
    const fetchSite = req.headers.get('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')
      throw new ApiError('bad_origin', 'This request came from another site.', 403);
    return;
  }
  const allowed = new Set(
    [req.headers.get('x-forwarded-host'), req.headers.get('host'), hostOf(req.url), hostOf(process.env.APP_URL)].filter(
      Boolean,
    ),
  );
  const host = hostOf(origin);
  if (!host || !allowed.has(host)) throw new ApiError('bad_origin', 'This request came from another site.', 403);
}

/** Reads the body, stopping as soon as it passes maxBytes (a chunked request has no Content-Length). */
export async function readCapped(
  req: Request,
  maxBytes: number,
  message = 'The request is too large.',
): Promise<Buffer> {
  const tooLarge = () => new ApiError('too_large', message, 413);
  if (Number(req.headers.get('content-length') || 0) > maxBytes) throw tooLarge();
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: Request, maxBytes = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const text = (await readCapped(req, maxBytes)).toString('utf8');
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError('bad_request', 'The request body isn’t valid JSON.', 400);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError('bad_request', 'Send a JSON object.', 400);
  return value as Record<string, unknown>;
}

export function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (result === undefined) return new NextResponse(null, { status: 204 });
  return NextResponse.json(result);
}

/**
 * The client's IP for rate limits. Each proxy appends the address it saw to X-Forwarded-For, so only the
 * right-hand entries can be trusted. TRUSTED_PROXY_HOPS is how many proxies sit in front of the app
 * (default 0: the right-most entry, which the Next server itself adds).
 */
export function clientIp(req: Request): string | null {
  const hops = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean);
  if (!hops.length) return req.headers.get('x-real-ip')?.trim() || null;
  const trusted = Math.max(0, Math.floor(Number(process.env.TRUSTED_PROXY_HOPS) || 0));
  return hops[Math.max(0, hops.length - 1 - trusted)];
}

export function metaOf(req: Request) {
  return { ip: clientIp(req), userAgent: req.headers.get('user-agent') };
}

export async function handle(
  req: NextRequest,
  fn: (input: { ctx: Ctx | null; token: string | null }) => unknown,
  opts: { auth?: boolean } = {},
): Promise<Response> {
  const auth = opts.auth ?? true;
  const token = sessionToken(req);
  let stale = false;
  try {
    checkOrigin(req);
    const loaded = token ? await loadSession(token, { renew: true }) : null;
    stale = Boolean(token && !loaded);
    if (auth && !loaded) throw errors.unauthenticated();
    const res = toResponse(await fn({ ctx: loaded ? ctxFor(loaded.user) : null, token }));
    // The handler's own cookie wins: log in, log out and resets set or clear it.
    const handlerSetCookie = setsSessionCookie(res);
    if (loaded?.renewed && token && !handlerSetCookie) setSessionCookie(res, token, loaded.expiresAt);
    // A dead cookie goes away, unless the handler just set a new one (log in).
    if (stale && !handlerSetCookie) clearSessionCookie(res);
    return res;
  } catch (error) {
    const res = errorResponse(error);
    if (stale) clearSessionCookie(res);
    return res;
  }
}

/** A signed-in route. Every service call inside runs as the person. */
export function route(fn: (args: RouteArgs) => unknown) {
  return (req: NextRequest, context: NextContext) =>
    handle(req, async ({ ctx, token }) =>
      fn({
        req,
        params: (await context?.params) ?? {},
        query: req.nextUrl.searchParams,
        ctx: ctx!,
        token: token!,
        body: () => readJson(req),
        meta: metaOf(req),
      }),
    );
}

/** A route that also works logged out (sign up, log in, resets, health). */
export function publicRoute(fn: (args: PublicRouteArgs) => unknown) {
  return (req: NextRequest, context: NextContext) =>
    handle(
      req,
      async ({ ctx, token }) =>
        fn({
          req,
          params: (await context?.params) ?? {},
          query: req.nextUrl.searchParams,
          ctx,
          token,
          body: () => readJson(req),
          meta: metaOf(req),
        }),
      { auth: false },
    );
}
