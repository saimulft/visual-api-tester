// Adapted from dl-cms/cms/src/server/oauth/errors.ts
/** An OAuth error with its RFC 6749 code ("invalid_grant", "access_denied") and the HTTP status to send. */
export class OAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'OAuthError';
    this.code = code;
    this.status = status;
  }

  toJSON() {
    return { error: this.code, error_description: this.message };
  }
}
