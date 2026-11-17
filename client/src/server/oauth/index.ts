// Adapted from dl-cms/cms/src/server/oauth/index.ts
/**
 * OAuth 2.1 for MCP clients: dynamic client registration, authorization code with PKCE (S256) behind a consent
 * page, refresh tokens, revocation, and RFC 8414 / RFC 9728 metadata. Each person's MCP address is its own
 * resource, so a token works on that one address only.
 */
export { OAuthError } from './errors';
export {
  AUTHORIZE_PARAMS,
  approve,
  authorizationServerMetadata,
  authorizeQuery,
  checkClient,
  checkRequest,
  errorRedirect,
  pkceMatches,
  protectedResourceMetadata,
  resolveTarget,
  revoke,
  token,
  type AuthorizeQuery,
  type Target,
} from './flow';
export { corsEmpty, corsJson, oauthErrorResponse, readParams, withCors } from './http';
export {
  ACCESS_TTL_S,
  REFRESH_TTL_MS,
  getClient,
  grantForAccessToken,
  issueGrant,
  registerClient,
  type GrantRow,
  type OAuthClient,
  type TokenSet,
} from './store';
export {
  HANDLE_PATTERN,
  MCP_PREFIX,
  MCP_SCOPE,
  baseUrl,
  baseUrlFrom,
  parseResource,
  resourceMetadataUrl,
  resourceUrl,
} from './urls';
