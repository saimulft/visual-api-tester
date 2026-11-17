// Adapted from dl-cms/cms/src/contracts/ai.ts (one level: the person's own keys, tried from the top)
import { z } from 'zod';

/**
 * The built-in assistant's AI keys. Each key has its provider and model, and they're tried in order (position):
 * a bad key, a rate limit or no credit moves to the next one. A key never leaves the server; the browser sees
 * its provider, model, label and last 4 characters only.
 */
export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini', 'openrouter'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
};

/** The tile on Connect your AI and Settings: monogram and the line under the name. */
export const AI_PROVIDER_TILES: Record<AiProvider, { mono: string; name: string; small: string }> = {
  anthropic: { mono: 'A', name: 'Anthropic', small: 'Claude' },
  openai: { mono: 'O', name: 'OpenAI', small: 'GPT models' },
  gemini: { mono: 'G', name: 'Google', small: 'Gemini' },
  openrouter: { mono: 'OR', name: 'OpenRouter', small: 'Any model' },
};

/** Where each provider keeps its keys, for the hint under the key field. */
export const AI_KEY_HINTS: Record<AiProvider, string> = {
  anthropic: 'Find it in the Anthropic console under API keys.',
  openai: 'Find it in the OpenAI platform under API keys.',
  gemini: 'Find it in Google AI Studio under Get API key.',
  openrouter: 'Find it in OpenRouter under Settings, then Keys.',
};

/** Used when the provider's live list can't be read. Anthropic's is its newest Sonnet. */
export const FALLBACK_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-6-luna',
  gemini: 'gemini-3.8-flash',
  openrouter: 'anthropic/claude-sonnet-5.5',
};

export const MAX_AI_KEYS = 12;

/** Why a provider call failed. */
export const AI_ERROR_KINDS = [
  'auth',
  'rate_limit',
  'timeout',
  'unavailable',
  'bad_request',
  'network',
  'invalid_response',
] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

export const AI_ERROR_MESSAGES: Record<AiErrorKind, string> = {
  auth: 'The provider rejected the key.',
  rate_limit: 'The provider’s rate limit or credit was reached.',
  timeout: 'The provider didn’t answer in time.',
  unavailable: 'The provider is unavailable right now.',
  bad_request: 'The provider rejected the request. Check the model.',
  network: 'The provider couldn’t be reached.',
  invalid_response: 'The provider sent an answer that couldn’t be read.',
};

/** A saved AI key as the browser sees it. */
export type AiKey = {
  id: string;
  provider: AiProvider;
  model: string;
  /** The model's name from the provider's list when known ("Claude Sonnet 5.5"), else the id. */
  modelName: string;
  label: string;
  last4: string;
  position: number;
  lastTestAt: number | null;
  lastTestOk: boolean | null;
  lastTestMs: number | null;
  /** How many setups this key ran. */
  setups: number;
  createdAt: number;
};

export type AiModelOption = { id: string; name: string; recommended?: boolean };

/** What "Test" says: "Connected. Claude replied in 1.2 s." or why not. */
export type AiTestResult = { ok: boolean; ms: number; message: string };

/** The Projects KPI "Your AI" (chat B) and the New project choice. */
export type AiSummary = {
  /** The first key's provider and model, or null with no key. */
  provider: AiProvider | null;
  model: string | null;
  modelName: string | null;
  keys: number;
};

const secret = z
  .string({ error: 'Paste the key.' })
  .trim()
  .min(12, 'That key looks too short. Paste the whole key.')
  .max(500, 'That key is too long.');

export const AiKeyCreateSchema = z.object({
  provider: z.enum(AI_PROVIDERS, { error: 'Pick a provider.' }),
  secret,
  model: z.string().trim().max(200).optional(),
  label: z.string().trim().max(60).default(''),
});
export type AiKeyCreateInput = z.input<typeof AiKeyCreateSchema>;

export const AiKeyUpdateSchema = z
  .object({
    model: z.string().trim().min(1, 'Pick a model.').max(200),
    label: z.string().trim().max(60),
    secret,
  })
  .partial();

export const AiKeyOrderSchema = z.object({
  ids: z.array(z.string()).min(1).max(MAX_AI_KEYS),
});

/** List models with a key that isn't saved yet (Connect your AI), or with a saved one. */
export const AiModelsQuerySchema = z.union([
  z.object({ provider: z.enum(AI_PROVIDERS), secret }),
  z.object({ keyId: z.string().min(1) }),
]);
