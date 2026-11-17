// Adapted from dl-cms/cms/src/server/oauth/urls.ts (one resource per person: /mcp/u/<handle>, no aliases)
import { appUrl } from '../auth/tokens';

/**
 * The MCP address and the OAuth URLs around it. Each person has their own resource, /mcp/u/<handle>, and a
 * token works on that address only. "New address" gives a new handle, so every token for the old one stops.
 */
export const MCP_PREFIX = '/mcp/u';
export const MCP_SCOPE = 'mcp';
/** A handle: what users.randomHandle makes (12 easy-to-read characters), or a seed's readable one. */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,40}$/;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHost(hostname: string) {
  return LOOPBACK.has(hostname.toLowerCase());
}

const first = (value: string | null) => value?.split(',')[0]?.trim() || null;

/**
 * The public origin: APP_URL. When that's unset or a loopback URL (development, tests), the request's own
 * origin, so a dev server on any port hands out URLs that point back at itself.
 */
export function baseUrlFrom(headers: Headers, requestUrl?: string): string {
  const configured = appUrl();
  if (!isLoopbackHost(new URL(configured).hostname)) return configured;
  const host = first(headers.get('x-forwarded-host')) ?? first(headers.get('host'));
  const proto =
    first(headers.get('x-forwarded-proto')) ?? (requestUrl ? new URL(requestUrl).protocol.replace(/:$/, '') : 'http');
  if (host) return `${proto}://${host}`;
  return requestUrl ? new URL(requestUrl).origin : configured;
}

export function baseUrl(request: Request): string {
  return baseUrlFrom(request.headers, request.url);
}

/** A person's MCP address. */
export function resourceUrl(base: string, handle: string): string {
  return `${base}${MCP_PREFIX}/${handle}`;
}

/** RFC 9728 metadata URL: the well-known prefix goes in front of the resource's path. */
export function resourceMetadataUrl(base: string, handle: string): string {
  return `${base}/.well-known/oauth-protected-resource${MCP_PREFIX}/${handle}`;
}

export const authorizeUrl = (base: string) => `${base}/oauth/authorize`;
export const tokenUrl = (base: string) => `${base}/oauth/token`;
export const registerUrl = (base: string) => `${base}/oauth/register`;
export const revokeUrl = (base: string) => `${base}/oauth/revoke`;

function sameOrigin(a: URL, b: URL) {
  if (a.protocol !== b.protocol || a.port !== b.port) return false;
  if (a.hostname === b.hostname) return true;
  // localhost and 127.0.0.1 are the same server in development.
  return isLoopbackHost(a.hostname) && isLoopbackHost(b.hostname);
}

/** The handle a `resource` URL names, or null when it isn't an MCP address here. */
export function parseResource(value: string, base: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.search || url.hash || !sameOrigin(url, new URL(base))) return null;
  const path = url.pathname.replace(/\/+$/, '');
  const prefix = `${MCP_PREFIX}/`;
  if (!path.startsWith(prefix)) return null;
  const handle = path.slice(prefix.length);
  return HANDLE_PATTERN.test(handle) ? handle : null;
}
