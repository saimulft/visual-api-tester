// Adapted from dl-cms/cms/src/app/oauth/register/route.ts
import { isApiError } from '@/contracts/common';
import { clientIp, rateLimit, readCapped } from '@/server/http';
import { OAuthError, corsEmpty, corsJson, oauthErrorResponse, registerClient } from '@/server/oauth';

const HOUR_MS = 60 * 60 * 1000;
const MAX_BYTES = 64 * 1024;

/**
 * RFC 7591 dynamic client registration (public clients). Open to anyone by design, since that's how AI apps
 * connect, so it's limited per IP and in size.
 */
export async function POST(request: Request) {
  try {
    rateLimit(`oauth-register:${clientIp(request) ?? 'unknown'}`, 30, HOUR_MS);
    let body: unknown;
    try {
      body = JSON.parse((await readCapped(request, MAX_BYTES)).toString('utf8'));
    } catch (error) {
      if (isApiError(error)) throw error;
      throw new OAuthError('invalid_client_metadata', 'Send the client metadata as JSON.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new OAuthError('invalid_client_metadata', 'Send the client metadata as a JSON object.');
    return corsJson(await registerClient(body as Record<string, unknown>), { status: 201 });
  } catch (error) {
    if (isApiError(error))
      return corsJson({ error: 'invalid_client_metadata', error_description: error.message }, { status: error.status });
    return oauthErrorResponse(error);
  }
}

export function OPTIONS() {
  return corsEmpty();
}
