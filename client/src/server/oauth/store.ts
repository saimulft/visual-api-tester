// Adapted from dl-cms/cms/src/server/oauth/store.ts (queries rewritten through Kysely, times in ms)
import type { Selectable } from 'kysely';
import { randomToken, sha256 } from '../auth/tokens';
import { db, json, newId, transaction } from '../db';
import type { OauthTokensTable } from '../db/schema';
import { OAuthError } from './errors';
import { isLoopbackHost } from './urls';

/**
 * OAuth storage: registered clients (dynamic registration), one-time authorization codes and grants. A grant is
 * one row in oauth_tokens (a "connection" in Settings) holding the hashes of its current access and refresh
 * tokens; refreshing rotates both in place. Tokens are never stored, only their SHA-256.
 */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;

/* ------------------------------------------------------------------ clients */
export type OAuthClient = {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none';
  client_uri?: string;
  logo_uri?: string;
};

/** Never a way back to an app: script and local URLs, and handlers that open files or other programs. */
const BLOCKED_SCHEMES = new Set([
  'javascript:',
  'data:',
  'file:',
  'vbscript:',
  'about:',
  'blob:',
  'ftp:',
  'ws:',
  'wss:',
  'mailto:',
  'tel:',
  'sms:',
  'search:',
  'search-ms:',
  'ms-msdt:',
  'ms-officecmd:',
  'ms-word:',
  'ms-excel:',
  'ms-powerpoint:',
]);

/** https, http on loopback (native apps, RFC 8252), or a private-use scheme like cursor://. */
function checkRedirectUri(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000)
    throw new OAuthError('invalid_redirect_uri', 'Each redirect URI must be a URL.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthError('invalid_redirect_uri', `"${value}" isn't a valid URL.`);
  }
  if (url.hash) throw new OAuthError('invalid_redirect_uri', "Redirect URIs can't have a fragment.");
  if (BLOCKED_SCHEMES.has(url.protocol))
    throw new OAuthError('invalid_redirect_uri', `${url.protocol} redirect URIs aren't allowed.`);
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname))
    throw new OAuthError('invalid_redirect_uri', 'Plain http redirect URIs are only allowed on localhost. Use https.');
  return value;
}

const cleanName = (value: unknown) =>
  typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
    : '';

/** RFC 7591 dynamic client registration. Public clients only: no secrets, PKCE does the work. */
export async function registerClient(meta: Record<string, unknown>): Promise<OAuthClient> {
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || !uris.length) throw new OAuthError('invalid_redirect_uri', 'redirect_uris is required.');
  if (uris.length > 10) throw new OAuthError('invalid_redirect_uri', 'Register at most 10 redirect URIs.');
  if (Array.isArray(meta.grant_types) && meta.grant_types.length > 5)
    throw new OAuthError('invalid_client_metadata', 'Too many grant types.');
  const grantTypes = Array.isArray(meta.grant_types)
    ? meta.grant_types.map(String)
    : ['authorization_code', 'refresh_token'];
  const unsupported = grantTypes.filter((g) => g !== 'authorization_code' && g !== 'refresh_token');
  if (unsupported.length)
    throw new OAuthError(
      'invalid_client_metadata',
      `Unsupported grant type: ${unsupported.join(', ')}. Use authorization_code and refresh_token.`,
    );
  const client: OAuthClient = {
    client_id: `mcp_${randomToken(16)}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: cleanName(meta.client_name) || 'AI app',
    redirect_uris: uris.map(checkRedirectUri),
    grant_types: grantTypes.includes('refresh_token') ? grantTypes : [...grantTypes, 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    ...(typeof meta.client_uri === 'string' ? { client_uri: meta.client_uri.slice(0, 500) } : {}),
    ...(typeof meta.logo_uri === 'string' ? { logo_uri: meta.logo_uri.slice(0, 500) } : {}),
  };
  await db
    .insertInto('oauth_clients')
    .values({
      client_id: client.client_id,
      data: json(client)!,
      client_name: client.client_name,
      created_at: Date.now(),
    })
    .execute();
  return client;
}

export async function getClient(clientId: string | undefined): Promise<OAuthClient | null> {
  if (!clientId) return null;
  const row = await db.selectFrom('oauth_clients').select('data').where('client_id', '=', clientId).executeTakeFirst();
  if (!row) return null;
  try {
    return JSON.parse(row.data) as OAuthClient;
  } catch {
    return null;
  }
}

/** Exact match, except loopback URIs may use any port (RFC 8252 section 7.3). */
export function redirectUriAllowed(client: OAuthClient, requested: string): boolean {
  if (client.redirect_uris.includes(requested)) return true;
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (req.protocol !== 'http:' || !isLoopbackHost(req.hostname)) return false;
  return client.redirect_uris.some((registered) => {
    try {
      const reg = new URL(registered);
      return (
        reg.protocol === 'http:' &&
        reg.hostname === req.hostname &&
        reg.pathname === req.pathname &&
        reg.search === req.search
      );
    } catch {
      return false;
    }
  });
}

/* ------------------------------------------------------------------ codes */
export type CodeData = {
  clientId: string;
  userId: string;
  resource: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
};

export async function createCode(data: CodeData): Promise<string> {
  const code = randomToken();
  const at = Date.now();
  await db
    .insertInto('oauth_codes')
    .values({ code_hash: sha256(code), data: json(data)!, expires_at: at + CODE_TTL_MS, created_at: at })
    .execute();
  // Expired codes nobody redeemed.
  await db
    .deleteFrom('oauth_codes')
    .where('expires_at', '<', at - 24 * 60 * 60 * 1000)
    .execute();
  return code;
}

/** Single use: the code is deleted whether or not the exchange then succeeds. */
export async function takeCode(code: string): Promise<CodeData> {
  const hash = sha256(code);
  const row = await transaction(async () => {
    const found = await db
      .selectFrom('oauth_codes')
      .select(['data', 'expires_at'])
      .where('code_hash', '=', hash)
      .executeTakeFirst();
    if (!found) return null;
    const deleted = await db.deleteFrom('oauth_codes').where('code_hash', '=', hash).executeTakeFirst();
    // Someone else redeemed it between the read and the delete.
    if (Number(deleted.numDeletedRows) !== 1) return null;
    return found;
  });
  if (!row) throw new OAuthError('invalid_grant', 'That authorization code is invalid or was already used.');
  if (Number(row.expires_at) < Date.now())
    throw new OAuthError('invalid_grant', 'That authorization code has expired. Sign in again.');
  return JSON.parse(row.data) as CodeData;
}

/* ------------------------------------------------------------------ grants */
export type GrantRow = Selectable<OauthTokensTable>;

export type TokenSet = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
};

const newAccess = () => `dla_${randomToken()}`;
const newRefresh = () => `dlr_${randomToken()}`;

function tokenSet(access: string, refresh: string, scope: string): TokenSet {
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

/** A new grant. Earlier grants of the same client, person and address are signed out: it replaces them. */
export async function issueGrant(input: {
  clientId: string;
  clientName: string;
  userId: string;
  resource: string;
  scope: string;
}): Promise<TokenSet> {
  const access = newAccess();
  const refresh = newRefresh();
  const at = Date.now();
  await transaction(async () => {
    await db
      .updateTable('oauth_tokens')
      .set({ revoked_at: at })
      .where('client_id', '=', input.clientId)
      .where('user_id', '=', input.userId)
      .where('resource', '=', input.resource)
      .where('revoked_at', 'is', null)
      .execute();
    await db
      .insertInto('oauth_tokens')
      .values({
        id: newId(),
        access_hash: sha256(access),
        refresh_hash: sha256(refresh),
        client_id: input.clientId,
        client_name: input.clientName,
        user_id: input.userId,
        resource: input.resource,
        scope: input.scope,
        created_at: at,
        expires_at: at + ACCESS_TTL_S * 1000,
        refresh_expires_at: at + REFRESH_TTL_MS,
        revoked_at: null,
        last_used_at: null,
      })
      .execute();
  });
  return tokenSet(access, refresh, input.scope);
}

/**
 * Refresh: both tokens rotate, so a refresh token works once. The 30 days start again. The swap is one
 * conditional update on the old refresh hash, so two refreshes racing can't both win.
 */
export async function rotateGrant(
  refreshToken: string,
  clientId: string | undefined,
  resourceMatches: (resource: string) => boolean = () => true,
): Promise<{ tokens: TokenSet; grant: GrantRow }> {
  const access = newAccess();
  const refresh = newRefresh();
  const oldHash = sha256(refreshToken);
  const row = await db.selectFrom('oauth_tokens').selectAll().where('refresh_hash', '=', oldHash).executeTakeFirst();
  if (!row || row.revoked_at !== null)
    throw new OAuthError('invalid_grant', 'That refresh token is invalid or was signed out.');
  if (!row.refresh_expires_at || Number(row.refresh_expires_at) < Date.now())
    throw new OAuthError('invalid_grant', 'That refresh token has expired. Sign in again.');
  if (clientId && clientId !== row.client_id)
    throw new OAuthError('invalid_grant', 'That refresh token belongs to another client.');
  if (!resourceMatches(row.resource)) throw new OAuthError('invalid_target', "resource doesn't match this grant.");
  const at = Date.now();
  const updated = await db
    .updateTable('oauth_tokens')
    .set({
      access_hash: sha256(access),
      refresh_hash: sha256(refresh),
      expires_at: at + ACCESS_TTL_S * 1000,
      refresh_expires_at: at + REFRESH_TTL_MS,
    })
    .where('id', '=', row.id)
    .where('refresh_hash', '=', oldHash)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows) !== 1)
    throw new OAuthError('invalid_grant', 'That refresh token is invalid or was signed out.');
  const next = await db.selectFrom('oauth_tokens').selectAll().where('id', '=', row.id).executeTakeFirstOrThrow();
  return { tokens: tokenSet(access, refresh, row.scope), grant: next };
}

/** The grant behind a live access token: not revoked, not expired. Marks it used (at most once a minute). */
export async function grantForAccessToken(token: string): Promise<GrantRow | null> {
  const row = await db
    .selectFrom('oauth_tokens')
    .selectAll()
    .where('access_hash', '=', sha256(token))
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', Date.now())
    .executeTakeFirst();
  if (!row) return null;
  if (!row.last_used_at || Date.now() - Number(row.last_used_at) > TOUCH_EVERY_MS)
    await db.updateTable('oauth_tokens').set({ last_used_at: Date.now() }).where('id', '=', row.id).execute();
  return row;
}

/** RFC 7009: revokes the grant behind an access or refresh token. Unknown tokens are not an error. */
export async function revokeToken(token: string): Promise<void> {
  const hash = sha256(token);
  await db
    .updateTable('oauth_tokens')
    .set({ revoked_at: Date.now() })
    .where((eb) => eb.or([eb('access_hash', '=', hash), eb('refresh_hash', '=', hash)]))
    .where('revoked_at', 'is', null)
    .execute();
}
