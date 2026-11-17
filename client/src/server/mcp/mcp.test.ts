import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as asMetadata } from '@/app/.well-known/oauth-authorization-server/route';
import { GET as resourceMetadata } from '@/app/.well-known/oauth-protected-resource/mcp/u/[handle]/route';
import { POST as decide } from '@/app/oauth/authorize/decision/route';
import { POST as register } from '@/app/oauth/register/route';
import { POST as tokenRoute } from '@/app/oauth/token/route';
import type { SpecOp } from '@/contracts/setup';
import hackerNews from '../seed/specs/hacker-news.json';
import { createSession } from '../auth';
import { db } from '../db';
import { createTestDb } from '../db/testing';
import { SESSION_COOKIE } from '../http/cookies';
import { resetRateLimits } from '../http/rate-limit';
import type { GuardedResponse } from '../net/guarded-fetch';
import { allowLoopbackForTests } from '../net/public-address';
import { resetCallCounts, useTransportForTests, type Transport } from '../runner/call';
import * as auth from '../services/auth';
import { ctxFor, type Ctx } from '../services/context';
import * as mcpStatus from '../services/mcp-status';
import * as projects from '../services/projects';
import * as setups from '../services/setups';
import { handleMcp } from './handler';

// The directory has Hacker News; APIs.guru (the network) isn't needed in these tests.
vi.mock('../discovery/apis-guru', () => ({ searchApisGuru: async () => [], matchProviders: () => [] }));

const t = await createTestDb();
const BASE = 'http://localhost:3310';
const REDIRECT = 'http://127.0.0.1:47123/callback';
const here = path.dirname(fileURLToPath(import.meta.url));

let docs: Server;
let docsBase = '';
let nadia: Ctx;
let handle = '';
let cookie = '';

/** Routes the client's requests to the app's own handlers, in-process. */
const appFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  const p = url.pathname;
  if (p.startsWith('/.well-known/oauth-protected-resource/mcp/u/'))
    return resourceMetadata(request, { params: Promise.resolve({ handle: p.split('/').pop()! }) });
  if (p.startsWith('/.well-known/oauth-authorization-server')) return asMetadata(request);
  if (p === '/oauth/register') return register(request);
  if (p === '/oauth/token') return tokenRoute(request);
  if (p.startsWith('/mcp/u/')) return handleMcp(request, p.split('/').pop()!);
  return new Response('not found', { status: 404 });
};

/** An MCP client app that keeps its registration and tokens in memory, like Claude Desktop would on disk. */
class MemoryProvider implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined;
  saved: OAuthTokens | undefined;
  verifier = '';
  authorizationUrl: URL | null = null;
  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata() {
    return { client_name: 'Claude', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'] };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
}

function respond(data: unknown): GuardedResponse {
  const text = JSON.stringify(data);
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    url: 'https://hn.algolia.com/api/v1/search',
    redirects: 0,
    ms: 3,
    bytes: Buffer.from(text),
    text: () => text,
    json: () => JSON.parse(text),
  };
}
const apiCalls: string[] = [];
const transport: Transport = async (input) => {
  apiCalls.push(String(input));
  return respond({
    hits: [
      { objectID: '1', title: 'Launch: an AI tool', points: 120, created_at_i: 1763300000 },
      { objectID: '2', title: 'Show HN: another', points: 64, created_at_i: 1763310000 },
    ],
    nbHits: 2,
  });
};

beforeAll(async () => {
  resetRateLimits();
  resetCallCounts();
  allowLoopbackForTests(true);
  useTransportForTests(transport, async () => {});
  docs = createServer((req, res) => {
    const file = { '/docs': 'docs-page.html', '/openapi.yaml': 'openapi.yaml' }[req.url ?? ''];
    if (!file) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': file.endsWith('html') ? 'text/html' : 'application/yaml' });
    res.end(readFileSync(path.join(here, '../discovery/fixtures', file)));
  });
  await new Promise<void>((resolve) => docs.listen(0, '127.0.0.1', resolve));
  docsBase = `http://127.0.0.1:${(docs.address() as AddressInfo).port}`;

  const a = await auth.signUp(
    { email: 'nadia@brightfield.com.au', password: 'field-notes-2026!' },
    {
      ip: '203.0.113.50',
      userAgent: 'vitest',
    },
  );
  await db.updateTable('users').set({ email_checked_at: Date.now() }).execute();
  nadia = ctxFor(await db.selectFrom('users').selectAll().where('id', '=', a.user.id).executeTakeFirstOrThrow());
  handle = nadia.user.mcpHandle;
  cookie = `${SESSION_COOKIE}=${(await createSession(nadia.user.id)).token}`;
});

afterAll(async () => {
  allowLoopbackForTests(false);
  useTransportForTests(null);
  docs.close();
  await t.close();
});

/** What a person does in the browser: Allow on the consent page. Returns the code the app gets back. */
async function consent(authorizationUrl: URL): Promise<string> {
  const form = new URLSearchParams(authorizationUrl.searchParams);
  form.set('decision', 'allow');
  const res = await decide(
    new NextRequest(`${BASE}/oauth/authorize/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, cookie },
      body: form,
    }),
  );
  expect(res.status).toBe(303);
  const back = new URL(res.headers.get('location')!);
  expect(back.origin + back.pathname).toBe(REDIRECT);
  return back.searchParams.get('code')!;
}

const provider = new MemoryProvider();
let client: Client;

async function call(
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown> & { isError: boolean }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[];
    isError?: boolean;
  };
  const text = result.content[0].text;
  try {
    return { ...(JSON.parse(text) as Record<string, unknown>), isError: Boolean(result.isError) };
  } catch {
    // The SDK's own argument check answers in plain text.
    return { ok: false, text, isError: Boolean(result.isError) };
  }
}

const hn = hackerNews as unknown as {
  api: Record<string, unknown>;
  endpoints: Record<string, unknown>[];
  channels: { id: string; title: string; controls: Record<string, unknown>[] }[];
  notes: Record<string, unknown>[];
  run: Record<string, unknown>;
};

describe('a scripted MCP client', () => {
  it('registers, gets the person’s consent and a token, then sees exactly the seven tools', async () => {
    const url = new URL(`${BASE}/mcp/u/${handle}`);
    const first = new Client({ name: 'scripted', version: '1.0.0' });
    await expect(
      first.connect(new StreamableHTTPClientTransport(url, { authProvider: provider, fetch: appFetch })),
    ).rejects.toThrow();
    expect(provider.info?.client_id).toMatch(/^mcp_/);
    expect(provider.authorizationUrl?.pathname).toBe('/oauth/authorize');
    expect(provider.authorizationUrl?.searchParams.get('resource')).toBe(url.toString());

    const signIn = new StreamableHTTPClientTransport(url, { authProvider: provider, fetch: appFetch });
    await signIn.finishAuth(await consent(provider.authorizationUrl!));
    expect(provider.saved?.access_token).toMatch(/^dla_/);

    client = new Client({ name: 'scripted', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider, fetch: appFetch }));
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'create_project',
      'get_results',
      'list_projects',
      'read_api_docs',
      'run_request',
      'schedule_pull',
      'set_controls',
    ]);
    expect(await mcpStatus.mcpStatus(nadia)).toMatchObject({ connected: true, clientName: 'Claude' });
    expect((await mcpStatus.clients(nadia)).map((c) => c.clientName)).toEqual(['Claude']);
  });

  it('sets up a project with the tools while the Setup page follows along', async () => {
    expect(await call('list_projects')).toMatchObject({ ok: true, projects: [] });

    const created = await call('create_project', {
      name: 'AI launch posts',
      api: 'Hacker News search',
      brief: 'AI launch posts with at least 50 points in the last day',
    });
    expect(created).toMatchObject({ ok: true, docsUrl: 'https://hn.algolia.com/api' });
    const projectId = String(created.projectId);
    const setupId = String(created.setupId);
    expect(String(created.setupPage)).toBe(`${BASE}/projects/${projectId}/setup`);

    expect((await call('read_api_docs', { mode: 'find', query: 'api' })).results).toBeTruthy();
    const page = await call('read_api_docs', { mode: 'page', url: `${docsBase}/docs`, projectId });
    expect(String(page.markdown)).toContain('Searching stories');
    const openapi = await call('read_api_docs', { mode: 'openapi', url: `${docsBase}/openapi.yaml`, projectId });
    expect((openapi.openapi as { endpointCount: number }).endpointCount).toBe(4);

    // Operations that don't fit the schema are refused with the field and the fix; nothing in that call applies.
    const malformed = await call('set_controls', {
      projectId,
      operations: [
        { op: 'set_api', api: hn.api },
        { op: 'add_endpoint', endpoint: { ...hn.endpoints[0], path: 'search' } },
      ],
    });
    expect(malformed.isError).toBe(true);
    expect(String(malformed.text)).toContain('path starts with \"/\"');
    // One the contract rejects (a control on a missing endpoint) stops there, after the ones before it applied.
    const bad = await call('set_controls', {
      projectId,
      operations: [
        { op: 'set_api', api: hn.api },
        { op: 'add_channel', channel: { id: 'what', title: 'What to find' } },
        { op: 'add_control', channelId: 'what', control: { ...hn.channels[0].controls[0], endpointId: 'serch' } },
      ],
    });
    expect(bad).toMatchObject({ ok: true, applied: 2 });
    expect((bad.error as { problems: { path: string }[] }).problems[0].path).toBe('channels.0.controls.0.endpointId');

    const ops: SpecOp[] = [
      { op: 'add_endpoint', endpoint: hn.endpoints[0] } as SpecOp,
      ...hn.channels.flatMap((c, i) => [
        ...(i === 0
          ? []
          : [
              {
                op: 'add_channel',
                channel: { id: c.id, title: c.title },
                planned: c.controls.map((k) => k.label),
              } as SpecOp,
            ]),
        ...c.controls.map((control) => ({ op: 'add_control', channelId: c.id, control }) as SpecOp),
      ]),
      ...hn.notes.map((note) => ({ op: 'add_note', note }) as SpecOp),
      { op: 'set_run', run: hn.run } as SpecOp,
    ];
    const built = await call('set_controls', { projectId, operations: ops });
    expect(built).toMatchObject({ ok: true, applied: ops.length });
    expect((built.results as { valid: boolean }[]).at(-1)!.valid).toBe(true);

    expect((await call('set_controls', { projectId, finish: true })).code).toBe('untested');
    const tested = await call('run_request', { projectId, endpointId: 'search' });
    expect(tested.test).toMatchObject({ ok: true, records: 2 });
    const finished = await call('set_controls', { projectId, finish: true, summary: 'Launch posts by points.' });
    expect(finished).toMatchObject({ ok: true, finished: true });

    const project = await projects.get(nadia, projectId);
    expect(project.status).toBe('ready');
    expect(project.spec).toEqual(hackerNews);
    const view = await setups.view(nadia, setupId);
    expect(view.setup).toMatchObject({ status: 'done', via: 'mcp', who: 'Claude', pagesRead: 2 });
    const events = await setups.events(nadia, setupId);
    const logs = events.flatMap((e) => (e.kind === 'log' ? [e.text] : []));
    expect(logs).toEqual(expect.arrayContaining(['Claude connected', 'Read Searching stories | Example News API']));
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['endpoint', 'control', 'note', 'test', 'done']));
    expect(apiCalls.every((u) => u.startsWith('https://hn.algolia.com/'))).toBe(true);

    // Running it: a free run goes at once.
    const run = await call('run_request', { projectId });
    expect(run).toMatchObject({ ok: true, run: { status: 'ok', rows: 2, credits: 0 } });
    const results = await call('get_results', { projectId });
    expect((results.runs as { id: string }[]).map((r) => r.id)).toContain((run.run as { runId: string }).runId);
    const one = await call('get_results', { runId: (run.run as { runId: string }).runId });
    expect((one.run as { sample: unknown[] }).sample.length).toBe(2);

    const scheduled = await call('schedule_pull', { projectId, cadence: 'daily', time: '08:00' });
    expect(scheduled).toMatchObject({ ok: true, schedule: { cadence: 'daily', time: '08:00' } });
    expect(scheduled.nextRuns).toHaveLength(3);
  });

  it('works only on the person’s own projects', async () => {
    const other = await auth.signUp(
      { email: 'sam@tidepool.io', password: 'field-notes-2026!' },
      {
        ip: '203.0.113.51',
        userAgent: 'vitest',
      },
    );
    const samCtx = ctxFor(
      await db.selectFrom('users').selectAll().where('id', '=', other.user.id).executeTakeFirstOrThrow(),
    );
    const theirs = await projects.create(samCtx, { name: 'Sam’s project' });
    const tried = await call('set_controls', { projectId: theirs.id, operations: [] });
    expect(tried).toMatchObject({ ok: false, code: 'not_found', isError: true });
    expect((await call('list_projects')).projects).toHaveLength(1);
  });

  it('cuts the client off with New address', async () => {
    const old = provider.saved!.access_token;
    await mcpStatus.newAddress(nadia);
    const res = await appFetch(`${BASE}/mcp/u/${handle}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${old}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
    expect(await mcpStatus.mcpStatus(nadia)).toMatchObject({ connected: false });
  });
});
