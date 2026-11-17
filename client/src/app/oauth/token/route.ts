// Adapted from dl-cms/cms/src/app/oauth/token/route.ts
import { clientIp, rateLimit } from '@/server/http';
import { corsEmpty, corsJson, oauthErrorResponse, readParams, token } from '@/server/oauth';

/** Authorization code (with PKCE) or refresh token in, a rotating token pair out. */
export async function POST(request: Request) {
  try {
    rateLimit(`oauth-token:${clientIp(request) ?? 'unknown'}`, 120, 60 * 60 * 1000);
    return corsJson(await token(await readParams(request)), { headers: { Pragma: 'no-cache' } });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export function OPTIONS() {
  return corsEmpty();
}
