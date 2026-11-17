// Adapted from dl-cms/cms/src/server/mcp/handler.ts
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { rateLimit } from '../http/rate-limit';
import { baseUrl, corsEmpty, corsJson, HANDLE_PATTERN, MCP_SCOPE, resourceMetadataUrl, withCors } from '../oauth';
import { authenticate, bearerToken, McpAuthError, type McpCaller } from './auth';
import { createMcpServer } from './server';

const ACCEPT = 'application/json, text/event-stream';

/** 401 with the RFC 9728 challenge that starts a client's OAuth flow (or tells it to sign in again). */
function challenge(base: string, handle: string, error: McpAuthError | null) {
  // Header values are ASCII: curly quotes become straight ones, anything else non-ASCII goes.
  const quote = (s: string) =>
    s
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/["\\]/g, '')
      .replace(/[^\x20-\x7e]/g, '');
  const parts = [
    `Bearer realm="mcp"`,
    `resource_metadata="${resourceMetadataUrl(base, handle)}"`,
    `scope="${MCP_SCOPE}"`,
  ];
  if (error) parts.push(`error="${error.code}"`, `error_description="${quote(error.message)}"`);
  return corsJson(
    error
      ? { error: error.code, error_description: error.message }
      : { error: 'unauthorized', error_description: 'Sign in to use this MCP address.' },
    { status: error?.status ?? 401, headers: { 'WWW-Authenticate': parts.join(', ') } },
  );
}

function rpcError(status: number, code: number, message: string) {
  return corsJson({ jsonrpc: '2.0', error: { code, message }, id: null }, { status });
}

/**
 * One MCP request over Streamable HTTP, stateless: authenticate, build the server for this caller, answer with
 * JSON. GET (server-sent events) and DELETE (sessions) aren't used without sessions.
 */
export async function handleMcp(request: Request, handle: string): Promise<Response> {
  if (request.method === 'OPTIONS') return corsEmpty();
  if (!HANDLE_PATTERN.test(handle)) return corsJson({ error: 'not_found' }, { status: 404 });
  const base = baseUrl(request);
  const token = bearerToken(request);
  if (!token) return challenge(base, handle, null);

  let caller: McpCaller;
  try {
    caller = await authenticate(token, handle);
  } catch (error) {
    if (error instanceof McpAuthError) return challenge(base, handle, error);
    console.error('[mcp] auth failed', error);
    return rpcError(500, -32603, 'Internal server error');
  }

  if (request.method !== 'POST')
    return new Response(null, { status: 405, headers: withCors({ Allow: 'POST, OPTIONS' }) });

  try {
    rateLimit(`mcp:${caller.ctx.user.id}`, 240, 60_000);
  } catch {
    return rpcError(429, -32000, 'Too many requests. Wait a minute and try again.');
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return rpcError(400, -32700, 'Parse error: the body isn’t valid JSON.');
  }

  // Some clients leave out the Accept header the transport insists on.
  const accept = request.headers.get('accept') ?? '';
  let mcpRequest = request;
  if (!accept.includes('application/json') || !accept.includes('text/event-stream')) {
    const headers = new Headers(request.headers);
    headers.set('accept', ACCEPT);
    mcpRequest = new Request(request.url, { method: 'POST', headers });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createMcpServer(caller, base);
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(mcpRequest, { parsedBody });
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: withCors(response.headers),
    });
  } catch (error) {
    console.error('[mcp] request failed', error);
    return rpcError(500, -32603, 'Internal server error');
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}
