// Adapted from dl-cms/cms/src/server/auth/passwords.ts
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// OWASP's scrypt setting that keeps memory at 16 MB per hash (N=2^14, r=8, p=5), so parallel log-ins can't
// run a small server out of memory. Older hashes keep their own parameters and still verify.
const N = 16384;
const R = 8;
const P = 5;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** scrypt (Node crypto, no native dependency). Stored as scrypt$N$r$p$salt$hash. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // Same work as a real check, so a missing account doesn't answer faster.
    await derive(password, randomBytes(16), { N, r: R, p: P });
    return false;
  }
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
