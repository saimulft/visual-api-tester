// Adapted from dl-cms/cms/src/server/auth/tokens.ts (the AES-256-GCM part)
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Saved API and AI keys are sealed with AES-256-GCM, keyed from APP_SECRET. Only the server unseals them,
 * and only to make a call. Never log, print or return an unsealed value.
 */
let warned = false;

/** APP_SECRET. Production refuses to start without it; development falls back to a fixed value and warns. */
export function appSecret(): string {
  const secret = process.env.APP_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production')
    throw new Error('APP_SECRET is not set (32 random bytes, see .env.example).');
  if (!warned) {
    warned = true;
    console.warn('[secrets] APP_SECRET is not set; using a development secret.');
  }
  return 'dialed-development-secret-change-me';
}

function key() {
  return createHash('sha256').update(`seal:${appSecret()}`).digest();
}

const VERSION = 'v1';

/** Seals text. Output: v1.iv.tag.ciphertext (base64url). Each call gives a different output. */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, ...[iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url'))].join('.');
}

/** Opens sealed text. Throws when it was tampered with or sealed under another APP_SECRET. */
export function unseal(sealed: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('That sealed value is not readable.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** The last four characters, for "••••1234". */
export function last4(secret: string): string {
  return secret.trim().slice(-4);
}

/** A key as people may see it: "••••1234". */
export function masked(lastFour: string): string {
  return `••••${lastFour}`;
}
