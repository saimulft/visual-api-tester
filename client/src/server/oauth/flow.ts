// Adapted from dl-cms/cms/src/server/oauth/flow.ts (one resource per person instead of sites)
import { createHash, timingSafeEqual } from 'node:crypto';
import { db } from '../db';
import { OAuthError } from './errors';
import {
  createCode,
  getClient,
  issueGrant,
  redirectUriAllowed,
  revokeToken,
  rotateGrant,
  takeCode,
  type OAuthClient,
  type TokenSet,
} from './store';
import { authorizeUrl, MCP_SCOPE, parseResource, registerUrl, resourceUrl, revokeUrl, tokenUrl } from './urls';
import { appUrl } from '../auth/tokens';

/* ------------------------------------------------------------------ metadata */
/** RFC 8414 authorization server metadata. The issuer is Dialed's origin. */
export function authorizationServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: authorizeUrl(base),
    token_endpoint: tokenUrl(base),
    registration_endpoint: registerUrl(base),
    revocation_endpoint: revokeUrl(base),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [MCP_SCOPE],
  };
}

/** RFC 9728 protected resource metadata for one person's MCP address. */
export function protectedResourceMetadata(base: string, handle: string) {
  return {
    resource: resourceUrl(base, handle),
    authorization_servers: [base],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Dialed',
  };
}

/* ------------------------------------------------------------------ authorize */
export type AuthorizeQuery = {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  state?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  resource?: string;
};

export const AUTHORIZE_PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'state',
  'scope',
  'code_challenge',
  'code_challenge_method',
  'resource',
] as const;

/** Picks the authorize parameters out of a query or form (first value of each). */
export function authorizeQuery(get: (key: string) => string | string[] | null | undefined): AuthorizeQuery {
  const out: AuthorizeQuery = {};
  for (const key of AUTHORIZE_PARAMS) {
    const value = get(key);
    const text = Array.isArray(value) ? value[0] : value;
    if (typeof text === 'string' && text) out[key] = text;
  }
  return out;
}

/**
 * Step one: the client and where to send the answer. Errors here are shown on the page and never redirected,
 * so a bad redirect_uri can't be used to bounce people elsewhere.
 */
export async function checkClient(q: AuthorizeQuery) {
  const client = await getClient(q.client_id);
  if (!client)
    throw new OAuthError(
      'invalid_client',
      'This AI app isn’t registered here. Remove the connection in the app and add it again.',
    );
  let redirectUri = q.redirect_uri;
  if (!redirectUri) {
    if (client.redirect_uris.length !== 1)
      throw new OAuthError('invalid_request', 'The app didn’t say where to return after sign-in.');
    redirectUri = client.redirect_uris[0];
  }
  if (!redirectUriAllowed(client, redirectUri))
    throw new OAuthError('invalid_request', 'The app’s return address isn’t one it registered.');
  return { client, redirectUri };
}

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** Step two: the rest of the request. Errors from here on are sent back to the app's redirect URI. */
export function checkRequest(q: AuthorizeQuery) {
  if (q.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'response_type must be code.');
  if (!q.code_challenge || q.code_challenge_method !== 'S256' || !CHALLENGE.test(q.code_challenge))
    throw new OAuthError('invalid_request', 'PKCE with an S256 code_challenge is required.');
  const scopes = (q.scope ?? MCP_SCOPE).split(' ').filter(Boolean);
  if (scopes.some((s) => s !== MCP_SCOPE)) throw new OAuthError('invalid_scope', `The only scope is "${MCP_SCOPE}".`);
  return { codeChallenge: q.code_challenge, scope: MCP_SCOPE };
}

/** What the person connects the app to: always their own MCP address. */
export type Target = { resource: string; handle: string };

/** The person's own current handle. */
async function handleOf(userId: string): Promise<string | null> {
  const row = await db.selectFrom('users').select('mcp_handle').where('id', '=', userId).executeTakeFirst();
  return row?.mcp_handle ?? null;
}

/**
 * The address a `resource` names, which must be the signed-in person's own current one. Without a resource
 * (older clients), their own address.
 */
export async function resolveTarget(userId: string, resource: string | undefined, base: string): Promise<Target> {
  const own = await handleOf(userId);
  if (!own) throw new OAuthError('access_denied', 'That account can’t sign in.', 403);
  if (!resource) return { resource: resourceUrl(base, own), handle: own };
  const handle = parseResource(resource, base);
  if (!handle) throw new OAuthError('invalid_target', 'The app asked for an address that isn’t a Dialed MCP address.');
  if (handle !== own)
    throw new OAuthError(
      'access_denied',
      'That MCP address isn’t yours, or it was replaced. Copy your current address from Settings, AI and keys.',
      403,
    );
  return { resource: resourceUrl(base, handle), handle };
}

/** The person said Allow: a one-time code goes back to the app. */
export async function approve(input: {
  client: OAuthClient;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scope: string;
  target: Target;
  userId: string;
}): Promise<string> {
  const code = await createCode({
    clientId: input.client.client_id,
    userId: input.userId,
    resource: input.target.resource,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope,
  });
  const url = new URL(input.redirectUri);
  url.searchParams.set('code', code);
  if (input.state !== undefined) url.searchParams.set('state', input.state);
  return url.toString();
}

/** Where an error (or Deny) goes: back to the app, with the state it sent. */
export function errorRedirect(redirectUri: string, error: OAuthError, state?: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error.code);
  url.searchParams.set('error_description', error.message);
  if (state !== undefined) url.searchParams.set('state', state);
  return url.toString();
}

/* ------------------------------------------------------------------ token */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier)) return false;
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/** Whether two resource URLs name the same address (trailing slashes aside, and on any loopback origin). */
function sameResource(a: string, b: string) {
  if (a.replace(/\/+$/, '') === b.replace(/\/+$/, '')) return true;
  const base = appUrl();
  const x = parseResource(a, base) ?? parseResource(a, new URL(b).origin);
  const y = parseResource(b, base) ?? parseResource(b, new URL(b).origin);
  return Boolean(x && y && x === y);
}

/** POST /oauth/token: authorization_code (with PKCE) or refresh_token. */
export async function token(params: Record<string, string>): Promise<TokenSet> {
  if (params.grant_type === 'authorization_code') return exchangeCode(params);
  if (params.grant_type === 'refresh_token') return refresh(params);
  throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token.');
}

async function exchangeCode(params: Record<string, string>): Promise<TokenSet> {
  const client = await getClient(params.client_id);
  if (!client) throw new OAuthError('invalid_client', 'Unknown client_id.', 401);
  if (!params.code || !params.code_verifier)
    throw new OAuthError('invalid_request', 'code and code_verifier are required.');
  const code = await takeCode(params.code);
  if (code.clientId !== client.client_id)
    throw new OAuthError('invalid_grant', 'That code was issued to another client.');
  if (params.redirect_uri && params.redirect_uri !== code.redirectUri)
    throw new OAuthError('invalid_grant', 'redirect_uri doesn’t match the authorization request.');
  if (!pkceMatches(params.code_verifier, code.codeChallenge))
    throw new OAuthError('invalid_grant', 'code_verifier doesn’t match the code_challenge.');
  if (params.resource && !sameResource(params.resource, code.resource))
    throw new OAuthError('invalid_target', 'resource doesn’t match the authorization request.');
  // "New address" between consent and exchange: the code is for an address that no longer exists.
  const own = await handleOf(code.userId);
  if (!own || !code.resource.endsWith(`/${own}`))
    throw new OAuthError('invalid_grant', 'That MCP address was replaced. Connect again with the new one.');
  return issueGrant({
    clientId: client.client_id,
    clientName: client.client_name,
    userId: code.userId,
    resource: code.resource,
    scope: code.scope,
  });
}

async function refresh(params: Record<string, string>): Promise<TokenSet> {
  if (!params.refresh_token) throw new OAuthError('invalid_request', 'refresh_token is required.');
  if (params.client_id && !(await getClient(params.client_id)))
    throw new OAuthError('invalid_client', 'Unknown client_id.', 401);
  // The resource is checked before the tokens rotate, so a mismatch doesn't sign the client out.
  const { tokens } = await rotateGrant(
    params.refresh_token,
    params.client_id,
    (granted) => !params.resource || sameResource(params.resource, granted),
  );
  return tokens;
}

/** POST /oauth/revoke (RFC 7009). Always succeeds, so it can't be used to probe tokens. */
export async function revoke(params: Record<string, string>): Promise<void> {
  if (!params.token) throw new OAuthError('invalid_request', 'token is required.');
  await revokeToken(params.token);
}
