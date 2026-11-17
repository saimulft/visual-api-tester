// Adapted from dl-cms/cms/src/app/.well-known/oauth-protected-resource/api/mcp/[site]/route.ts
import { baseUrl, corsEmpty, corsJson, HANDLE_PATTERN, protectedResourceMetadata } from '@/server/oauth';

/** RFC 9728 metadata for one MCP address. Answers for any well-formed handle, so it can't reveal which exist. */
export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  if (!HANDLE_PATTERN.test(handle))
    return corsJson({ error: 'not_found', error_description: 'No such address.' }, { status: 404 });
  return corsJson(protectedResourceMetadata(baseUrl(request), handle));
}

export function OPTIONS() {
  return corsEmpty();
}
