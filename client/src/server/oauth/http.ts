// Adapted from dl-cms/cms/src/server/oauth/http.ts
import { OAuthError } from './errors';

/**
 * CORS for the MCP endpoints, OAuth endpoints and metadata: browser-based clients (MCP Inspector, web
 * apps) call them cross-origin. Bearer tokens, not cookies, so a wildcard origin is safe.
 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

export function withCors(headers: HeadersInit = {}): Headers {
  const out = new Headers(headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) out.set(key, value);
  return out;
}

export function corsJson(data: unknown, init: { status?: number; headers?: HeadersInit } = {}) {
  const headers = withCors(init.headers);
  headers.set('Cache-Control', 'no-store');
  return Response.json(data, { status: init.status ?? 200, headers });
}

export function corsEmpty(status = 204) {
  return new Response(null, { status, headers: withCors() });
}

export function oauthErrorResponse(error: unknown) {
  if (error instanceof OAuthError) return corsJson(error.toJSON(), { status: error.status });
  console.error('[oauth]', error);
  return corsJson({ error: 'server_error', error_description: 'Something went wrong on the server.' }, { status: 500 });
}

/** Token, register and revoke bodies: form-encoded per RFC 6749, JSON accepted too. */
export async function readParams(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('content-type') ?? '';
  const text = await request.text();
  if (type.includes('application/json')) {
    let body: unknown;
    try {
      body = JSON.parse(text || '{}');
    } catch {
      throw new OAuthError('invalid_request', "The body isn't valid JSON.");
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new OAuthError('invalid_request', 'Send a JSON object.');
    return Object.fromEntries(
      Object.entries(body).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
    );
  }
  return Object.fromEntries(new URLSearchParams(text));
}
