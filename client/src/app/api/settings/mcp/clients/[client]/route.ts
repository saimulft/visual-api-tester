import { route } from '@/server/http';
import { mcp } from '@/server/services';

/** DELETE "Disconnect": signs one connected AI out. */
export const DELETE = route(async ({ ctx, params }) => {
  await mcp.disconnect(ctx, params.client);
});
