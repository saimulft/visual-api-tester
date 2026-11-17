// Adapted from dl-cms/cms/src/server/oauth/oauth.test.ts (one address per person instead of sites)
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as asMetadata } from '@/app/.well-known/oauth-authorization-server/route';
import { GET as resourceMetadata } from '@/app/.well-known/oauth-protected-resource/mcp/u/[handle]/route';
import { POST as decide } from '@/app/oauth/authorize/decision/route';
import { POST as register } from '@/app/oauth/register/route';
import { POST as revokeRoute } from '@/app/oauth/revoke/route';
import { POST as tokenRoute } from '@/app/oauth/token/route';
import { createSession, randomToken } from '../auth';
import { db } from '../db';
import { createTestDb } from '../db/testing';
import { SESSION_COOKIE } from '../http/cookies';
import { resetRateLimits } from '../http/rate-limit';
import { handleMcp } from '../mcp/handler';
import * as auth from '../services/auth';
import { ctxFor } from '../services/context';
import * as mcpStatus from '../services/mcp-status';
import { checkClient, pkceMatches } from './flow';

const t = await createTestDb();
afterAll(() => t.close());

const BASE = 'http://localhost:3310';
const REDIRECT = 'http://127.0.0.1:33418/callback';
let clientId: string;
let nadia: { id: string; handle: string };
let sam: { id: string; handle: string };

beforeAll(async () => {
  resetRateLimits();
  const meta = { ip: '203.0.113.40', userAgent: 'vitest' };
  const a = await auth.signUp({ email: 'nadia@brightfield.com.au', password: 'field-notes-2026!' }, meta);
  const b = await auth.signUp({ email: 'sam@tidepool.io', password: 'field-notes-2026!' }, meta);
  nadia = { id: a.user.id, handle: a.user.mcpHandle };
  sam = { id: b.user.id, handle: b.user.mcpHandle };
});

/* ------------------------------------------------------------------ helpers */
function pkce() {
  const verifier = randomToken(32);
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function cookieFor(userId: string) {
  const { token } = await createSession(userId);
  return `${SESSION_COOKIE}=${token}`;
}

const resourceOf = (handle: string) => `${BASE}/mcp/u/${handle}`;

/** Allow (or Deny) on the consent page, as the browser posts it. Returns the redirect. */
async function consent(
  userId: string,
  opts: { challenge: string; resource?: string; decision?: string; origin?: string },
) {
  const form = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    decision: opts.decision ?? 'allow',
    ...(opts.resource ? { resource: opts.resource } : {}),
  });
  return decide(
    new NextRequest(`${BASE}/oauth/authorize/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: opts.origin ?? BASE,
        cookie: await cookieFor(userId),
      },
      body: form,
    }),
  );
}

async function allow(userId: string, resource: string, challenge: string) {
  const res = await consent(userId, { challenge, resource });
  expect(res.status).toBe(303);
  return new URL(res.headers.get('location')!);
}

async function exchange(params: Record<string, string>) {
  const res = await tokenRoute(
    new Request(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, ...params }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

/** Signs in fully: consent, then the code for tokens. */
async function signIn(userId: string, handle: string) {
  const { verifier, challenge } = pkce();
  const code = (await allow(userId, resourceOf(handle), challenge)).searchParams.get('code')!;
  const { status, body } = await exchange({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT,
    resource: resourceOf(handle),
  });
  expect(status).toBe(200);
  return body;
}

const mcpCall = (handle: string, token: string | null) =>
  handleMcp(
    new Request(`${BASE}/mcp/u/${handle}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    }),
    handle,
  );

/* ------------------------------------------------------------------ tests */
describe('metadata and registration', () => {
  it('serves authorization server and per-address resource metadata', async () => {
    const as = await (await asMetadata(new Request(`${BASE}/.well-known/oauth-authorization-server`))).json();
    expect(as).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/oauth/token`,
      registration_endpoint: `${BASE}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });
    const res = await resourceMetadata(
      new Request(`${BASE}/.well-known/oauth-protected-resource/mcp/u/${nadia.handle}`),
      {
        params: Promise.resolve({ handle: nadia.handle }),
      },
    );
    expect(await res.json()).toMatchObject({ resource: resourceOf(nadia.handle), authorization_servers: [BASE] });
    const bad = await resourceMetadata(new Request(`${BASE}/x`), {
      params: Promise.resolve({ handle: 'Bad Handle!' }),
    });
    expect(bad.status).toBe(404);
  });

  it('registers public clients and refuses unsafe redirect URIs', async () => {
    const post = (body: unknown) =>
      register(
        new Request(`${BASE}/oauth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    const ok = await post({ client_name: 'Claude', redirect_uris: [REDIRECT] });
    expect(ok.status).toBe(201);
    const client = (await ok.json()) as { client_id: string; client_name: string; token_endpoint_auth_method: string };
    expect(client).toMatchObject({ client_name: 'Claude', token_endpoint_auth_method: 'none' });
    clientId = client.client_id;
    for (const uri of ['javascript:alert(1)', 'http://evil.example.com/cb', 'https://x.test/cb#frag'])
      expect((await post({ redirect_uris: [uri] })).status).toBe(400);
    expect((await post({ redirect_uris: [REDIRECT], grant_types: ['client_credentials'] })).status).toBe(400);
  });

  it('accepts any port on a loopback redirect and nothing else', async () => {
    await expect(
      checkClient({ client_id: clientId, redirect_uri: 'http://127.0.0.1:5000/callback' }),
    ).resolves.toBeTruthy();
    await expect(checkClient({ client_id: clientId, redirect_uri: 'http://127.0.0.1:5000/other' })).rejects.toThrow();
    await expect(checkClient({ client_id: 'nobody', redirect_uri: REDIRECT })).rejects.toThrow(/isn’t registered/);
  });
});

describe('authorization code flow', () => {
  it('issues a code on Allow, tokens on a matching verifier, and works on that address only', async () => {
    const tokens = await signIn(nadia.id, nadia.handle);
    expect(tokens.access_token).toMatch(/^dla_/);
    expect(tokens.refresh_token).toMatch(/^dlr_/);
    expect((await mcpCall(nadia.handle, tokens.access_token)).status).toBe(200);
    // Another person's address, and no token at all, get the challenge that starts sign-in.
    const other = await mcpCall(sam.handle, tokens.access_token);
    expect(other.status).toBe(401);
    expect(other.headers.get('www-authenticate')).toContain(
      `resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp/u/${sam.handle}"`,
    );
    expect((await mcpCall(nadia.handle, null)).status).toBe(401);
  });

  it('refuses a PKCE mismatch and burns the code', async () => {
    const { challenge } = pkce();
    const code = (await allow(nadia.id, resourceOf(nadia.handle), challenge)).searchParams.get('code')!;
    const wrong = await exchange({ grant_type: 'authorization_code', code, code_verifier: pkce().verifier });
    expect(wrong.body.error).toBe('invalid_grant');
    const again = await exchange({ grant_type: 'authorization_code', code, code_verifier: pkce().verifier });
    expect(again.body.error_description).toContain('already used');
    expect(pkceMatches('short', challenge)).toBe(false);
  });

  it('sends Deny, and another person’s address, back to the app as errors', async () => {
    const { challenge } = pkce();
    const denied = new URL((await consent(nadia.id, { challenge, decision: 'deny' })).headers.get('location')!);
    expect(denied.searchParams.get('error')).toBe('access_denied');
    expect(denied.searchParams.get('state')).toBe('xyz');
    const theirs = await consent(nadia.id, { challenge, resource: resourceOf(sam.handle) });
    expect(new URL(theirs.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
    const elsewhere = await consent(nadia.id, { challenge, resource: 'https://evil.example.com/mcp/u/abc' });
    expect(new URL(elsewhere.headers.get('location')!).searchParams.get('error')).toBe('invalid_target');
  });

  it('rotates refresh tokens and honours revocation', async () => {
    const first = await signIn(nadia.id, nadia.handle);
    const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.access_token).not.toBe(first.access_token);
    // The old refresh token worked once.
    expect((await exchange({ grant_type: 'refresh_token', refresh_token: first.refresh_token })).body.error).toBe(
      'invalid_grant',
    );
    expect((await mcpCall(nadia.handle, first.access_token)).status).toBe(401);
    expect((await mcpCall(nadia.handle, refreshed.body.access_token)).status).toBe(200);
    await revokeRoute(
      new Request(`${BASE}/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshed.body.refresh_token }),
      }),
    );
    expect((await mcpCall(nadia.handle, refreshed.body.access_token)).status).toBe(401);
  });

  it('cuts off every token with New address, and a code issued for the old address', async () => {
    const tokens = await signIn(nadia.id, nadia.handle);
    const { verifier, challenge } = pkce();
    const code = (await allow(nadia.id, resourceOf(nadia.handle), challenge)).searchParams.get('code')!;
    const ctx = ctxFor(await db.selectFrom('users').selectAll().where('id', '=', nadia.id).executeTakeFirstOrThrow());
    expect((await mcpStatus.mcpStatus(ctx)).connected).toBe(true);
    const me = await mcpStatus.newAddress(ctx);
    expect(me.mcpHandle).not.toBe(nadia.handle);
    expect((await mcpCall(nadia.handle, tokens.access_token)).status).toBe(401);
    expect((await mcpCall(me.mcpHandle, tokens.access_token)).status).toBe(401);
    expect((await exchange({ grant_type: 'authorization_code', code, code_verifier: verifier })).body.error).toBe(
      'invalid_grant',
    );
    expect((await mcpStatus.mcpStatus(ctx)).connected).toBe(false);
    nadia.handle = me.mcpHandle;
  });

  it('rejects cross-site form posts and unknown grant types', async () => {
    const { challenge } = pkce();
    const res = await consent(nadia.id, { challenge, origin: 'https://evil.example.com' });
    expect(res.status).toBe(403);
    expect((await exchange({ grant_type: 'password' })).body.error).toBe('unsupported_grant_type');
  });
});
