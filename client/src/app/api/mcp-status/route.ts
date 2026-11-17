import { route } from '@/server/http';
import { baseUrl, resourceUrl } from '@/server/oauth';
import { mcpStatus } from '@/server/services';

/** GET whether an AI is connected over MCP (screens 02 and 04 poll it every 3 s), and the person's address. */
export const GET = route(async ({ ctx, req }) => ({
  status: await mcpStatus(ctx),
  address: resourceUrl(baseUrl(req), ctx.user.mcpHandle),
}));
