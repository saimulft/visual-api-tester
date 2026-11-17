import { route } from '@/server/http';
import { baseUrl, resourceUrl } from '@/server/oauth';
import { mcp } from '@/server/services';

/** POST "New address": a new MCP handle, and every connected AI is signed out. */
export const POST = route(async ({ ctx, req }) => {
  const me = await mcp.newAddress(ctx);
  return { address: resourceUrl(baseUrl(req), me.mcpHandle) };
});
