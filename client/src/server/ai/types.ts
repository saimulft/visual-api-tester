// Adapted from dl-cms/cms/src/server/ai/types.ts
import { AI_ERROR_MESSAGES, type AiErrorKind, type AiProvider } from '@/contracts/ai';

/**
 * The provider-neutral shapes every adapter speaks. A conversation is a list of messages made of parts; each
 * adapter turns it into its provider's request and its stream back into ProviderEvents.
 */
export type AiPart =
  | { type: 'text'; text: string }
  /** `signature`: Gemini's thought signature for the call, sent back with it. */
  | { type: 'tool_call'; id: string; name: string; args: unknown; signature?: string }
  | { type: 'tool_result'; callId: string; name: string; content: string; isError?: boolean }
  /** A provider's own block (Anthropic thinking), replayed to that provider only. */
  | { type: 'native'; provider: AiProvider; block: unknown };

export type AiMessage =
  | { role: 'user'; parts: AiPart[] }
  | { role: 'assistant'; parts: AiPart[]; provider?: AiProvider }
  | { role: 'tool'; parts: AiPart[] };

/** A tool as the model sees it: JSON Schema parameters (cleaned per provider by the adapter). */
export type AiTool = { name: string; description: string; parameters: Record<string, unknown> };

export type ChatInput = {
  provider: AiProvider;
  model: string;
  apiKey: string;
  system: string;
  messages: AiMessage[];
  tools: AiTool[];
  /** The most the call may write (none: the adapter's usual). */
  maxOutput?: number;
  signal: AbortSignal;
};

export type ProviderEvent =
  | { type: 'text'; delta: string }
  /** `error`: the arguments weren't valid JSON (args holds the raw text). */
  | { type: 'tool_call'; id: string; name: string; args: unknown; signature?: string; error?: string }
  | { type: 'native'; block: unknown }
  | { type: 'thinking'; delta: string }
  /** The provider is answering: `bytes` more output that reaches no event yet (a tool call's arguments). */
  | { type: 'progress'; bytes: number }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; stop: 'end' | 'tool_calls' | 'length' };

/**
 * A failed provider call. `message` is a fixed, safe sentence; `detail` (the provider's redacted answer) is for
 * the server log only and never leaves the server.
 */
export class AiCallError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;
  /** From Retry-After. */
  readonly retryAfterMs?: number;
  readonly detail?: string;
  /** Text or a tool call already went out: no retry, no fallback. */
  committed = false;

  constructor(
    kind: AiErrorKind,
    opts: { status?: number; retryAfterMs?: number; detail?: string; message?: string } = {},
  ) {
    super(opts.message ?? AI_ERROR_MESSAGES[kind]);
    this.name = 'AiCallError';
    this.kind = kind;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.detail = opts.detail;
  }
}

/** Out of credit or quota: waiting doesn't help (per-minute rate limits don't match). */
export const NO_CREDIT_PATTERN =
  /credit balance|insufficient[_ ](?:quota|credits?|funds|balance)|billing|payment required|out of credits/i;
/** Providers that report a bad key as a 400 (Gemini) instead of a 401. */
const INVALID_KEY_PATTERN =
  /api[ _-]?key (?:is )?(?:not valid|invalid|expired)|invalid[ _-](?:x-)?api[ _-]?key|incorrect api key|API_KEY_INVALID/i;

/** The error kind of an HTTP answer. */
export function kindForResponse(status: number, detail = ''): AiErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402 || status === 429) return 'rate_limit';
  if (status === 408) return 'timeout';
  if (status >= 400 && status < 500) {
    // Anthropic answers "credit balance too low" and Gemini "API key not valid" with a 400.
    if (NO_CREDIT_PATTERN.test(detail)) return 'rate_limit';
    if (INVALID_KEY_PATTERN.test(detail)) return 'auth';
    return 'bad_request';
  }
  return 'unavailable';
}

/** Masks anything that looks like a credential before a provider message is logged. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_*.-]{6,}/g, '[redacted]')
    .replace(/\bAIza[0-9A-Za-z_-]{10,}/g, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]');
}
