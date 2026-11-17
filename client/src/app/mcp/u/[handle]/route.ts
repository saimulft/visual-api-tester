import { handleMcp } from '@/server/mcp/handler';

/** A person's MCP address: Streamable HTTP, stateless, OAuth Bearer tokens granted for this address only. */
type Context = { params: Promise<{ handle: string }> };

const handle = async (request: Request, context: Context) => handleMcp(request, (await context.params).handle);

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
