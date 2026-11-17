// Adapted from dl-cms/cms/src/server/http/cookies.ts
/**
 * The session cookie: httpOnly, SameSite=Lax, path /, 30 days and sliding, and Secure when APP_URL is https.
 */
export const SESSION_COOKIE = 'dialed_session';

export function secureCookies() {
  return (process.env.APP_URL ?? '').startsWith('https://');
}

function serialize(value: string, expiresAt: number) {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (secureCookies()) parts.push('Secure');
  return parts.join('; ');
}

export function setSessionCookie(res: Response, token: string, expiresAt: number) {
  res.headers.append('set-cookie', serialize(token, expiresAt));
  return res;
}

export function clearSessionCookie(res: Response) {
  res.headers.append('set-cookie', serialize('', 0));
  return res;
}

/** True when the response already sets the session cookie (sign in and sign out set their own). */
export function setsSessionCookie(res: Response) {
  return res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`));
}
