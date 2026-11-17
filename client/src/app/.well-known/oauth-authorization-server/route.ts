// Adapted from dl-cms/cms/src/app/.well-known/oauth-authorization-server/route.ts
import { authorizationServerMetadata, baseUrl, corsEmpty, corsJson } from '@/server/oauth';

/** RFC 8414 metadata: where MCP clients register, send people to sign in, and get tokens. */
export function GET(request: Request) {
  return corsJson(authorizationServerMetadata(baseUrl(request)));
}

export function OPTIONS() {
  return corsEmpty();
}
