// Adapted from dl-cms/cms/src/server/auth/tokens.ts (tokens and hashes; the sealing part is in ../secrets.ts)
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { appSecret } from '../secrets';

/** A random URL-safe token (32 bytes = 43 characters). Only its hash is ever stored. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** HMAC-SHA256 keyed with APP_SECRET, for values a leaked table mustn't reveal (client addresses). */
export function keyedHash(value: string): string {
  return createHmac('sha256', appSecret()).update(value).digest('hex');
}

/** Compares two hex digests in constant time. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Where a request came from, kept only as a keyed hash. */
export function ipHash(ip: string | null | undefined): string | null {
  return ip ? keyedHash(`ip:${ip}`).slice(0, 32) : null;
}

/** An absolute URL for links in emails, OAuth and MCP: APP_URL plus the path. */
export function appUrl(path = ''): string {
  const base = (process.env.APP_URL || 'http://localhost:3300').replace(/\/$/, '');
  return `${base}${path}`;
}
