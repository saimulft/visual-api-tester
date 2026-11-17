// Adapted from dl-cms/cms/src/app/oauth/revoke/route.ts
import { corsEmpty, corsJson, oauthErrorResponse, readParams, revoke } from '@/server/oauth';

/** RFC 7009: an app signs itself out. */
export async function POST(request: Request) {
  try {
    await revoke(await readParams(request));
    return corsJson({});
  } catch (error) {
    return oauthErrorResponse(error);
  }
}

export function OPTIONS() {
  return corsEmpty();
}
