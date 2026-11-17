// Adapted from dl-cms/cms/src/server/mcp/auth.ts (OAuth tokens only, one address per person)
import { db } from '../db';
import { grantForAccessToken } from '../oauth';
import { ctxFor, type Ctx } from '../services/context';

/** Who is calling the MCP server: the person, and which app (for setup logs and Settings). */
export type McpCaller = { ctx: Ctx; clientName: string; clientId: string };

/** A request the server refuses: 401 sends a WWW-Authenticate challenge so the client can sign in again. */
export class McpAuthError extends Error {
  readonly status: 401 | 403 | 404;
  readonly code: string;

  constructor(code: string, message: string, status: 401 | 403 | 404 = 401) {
    super(message);
    this.name = 'McpAuthError';
    this.code = code;
    this.status = status;
  }
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [type, value] = header.trim().split(/\s+/, 2);
  return type?.toLowerCase() === 'bearer' && value ? value : null;
}

/**
 * Checks the Bearer token against the address it came to: an OAuth access token granted for exactly this
 * person's current address. A token for an old address (after New address) or another person's fails the same
 * way as a bad token, so addresses can't be probed.
 */
export async function authenticate(token: string, handle: string): Promise<McpCaller> {
  const grant = await grantForAccessToken(token);
  if (!grant) throw new McpAuthError('invalid_token', 'The access token is invalid or has expired.');
  const user = await db.selectFrom('users').selectAll().where('id', '=', grant.user_id).executeTakeFirst();
  if (!user || user.mcp_handle !== handle || !grant.resource.endsWith(`/mcp/u/${handle}`))
    throw new McpAuthError('invalid_token', 'This token isn’t valid for this MCP address.');
  return { ctx: ctxFor(user), clientName: grant.client_name || 'Your AI', clientId: grant.client_id };
}
