// Adapted from dl-cms/cms/src/server/ai/models.ts (no thinking levels)
import { FALLBACK_MODELS, type AiModelOption, type AiProvider } from '@/contracts/ai';
import { readErrorDetail } from './sse';
import { AiCallError, kindForResponse } from './types';

/**
 * Live model lists per provider, for the model pickers. OpenRouter's is limited to models that take tools (the
 * setup agent needs them). Lists are cached for 10 minutes per key; a refresh fetches again.
 */
const TIMEOUT_MS = 15_000;
const CACHE_MS = 10 * 60_000;
const ANTHROPIC_MAX_PAGES = 10;

const globals = globalThis as unknown as {
  __dialedAiModels?: Map<string, { at: number; models: AiModelOption[] }>;
};
const cache = (globals.__dialedAiModels ??= new Map());

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    throw new AiCallError(name === 'TimeoutError' ? 'timeout' : 'network');
  }
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new AiCallError(kindForResponse(response.status, detail), { status: response.status, detail });
  }
  try {
    return await response.json();
  } catch {
    throw new AiCallError('invalid_response');
  }
}

const byName = (a: AiModelOption, b: AiModelOption) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** OpenAI's list holds every model: keep the chat ones. */
export function isOpenAiChatModel(id: string): boolean {
  if (!id || id.length > 128 || id.includes(':')) return false;
  if (
    /^(text-|audio-|whisper|tts|dall-e|embedding|moderation|omni-moderation|transcribe|speech|realtime|gpt-image|gpt-live|davinci|babbage|ada|curie)/i.test(
      id,
    ) ||
    /-(tts|transcribe|realtime|audio|image|search)/i.test(id)
  )
    return false;
  return /^(gpt-|o[0-9]|chatgpt-)/i.test(id);
}

async function openAiModels(apiKey: string): Promise<AiModelOption[]> {
  const json = (await getJson('https://api.openai.com/v1/models', { authorization: `Bearer ${apiKey}` })) as {
    data?: { id: string }[];
  };
  if (!Array.isArray(json.data)) throw new AiCallError('invalid_response');
  return [...new Set(json.data.map((m) => m.id).filter(isOpenAiChatModel))]
    .map((id) => ({ id, name: id }))
    .sort(byName);
}

async function anthropicModels(apiKey: string): Promise<AiModelOption[]> {
  const rows: { id: string; display_name?: string }[] = [];
  let after: string | undefined;
  for (let page = 0; page < ANTHROPIC_MAX_PAGES; page++) {
    const url = new URL('https://api.anthropic.com/v1/models');
    url.searchParams.set('limit', '1000');
    if (after) url.searchParams.set('after_id', after);
    const json = (await getJson(url.toString(), { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' })) as {
      data?: typeof rows;
      has_more?: boolean;
      last_id?: string;
    };
    if (!Array.isArray(json.data)) throw new AiCallError('invalid_response');
    rows.push(...json.data);
    if (!json.has_more || !json.last_id) break;
    after = json.last_id;
  }
  // Newest first, as Anthropic lists them.
  return rows.map((r) => ({ id: r.id, name: r.display_name?.trim() || r.id }));
}

async function geminiModels(apiKey: string): Promise<AiModelOption[]> {
  // The key goes in a header, never the URL.
  const json = (await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    'x-goog-api-key': apiKey,
  })) as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
  if (!Array.isArray(json.models)) throw new AiCallError('invalid_response');
  return json.models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && m.name?.startsWith('models/'))
    .map((m) => {
      const id = m.name.replace(/^models\//, '');
      return { id, name: m.displayName?.trim() || id };
    })
    .sort(byName);
}

async function openRouterModels(apiKey: string): Promise<AiModelOption[]> {
  const json = (await getJson('https://openrouter.ai/api/v1/models?supported_parameters=tools', {
    authorization: `Bearer ${apiKey}`,
  })) as { data?: { id: string; name?: string; supported_parameters?: string[] }[] };
  if (!Array.isArray(json.data)) throw new AiCallError('invalid_response');
  return json.data
    .filter((m) => !m.supported_parameters || m.supported_parameters.includes('tools'))
    .map((m) => ({ id: m.id, name: m.name?.trim() || m.id }))
    .sort(byName);
}

const LISTS: Record<AiProvider, (apiKey: string) => Promise<AiModelOption[]>> = {
  openai: openAiModels,
  anthropic: anthropicModels,
  gemini: geminiModels,
  openrouter: openRouterModels,
};

/**
 * The model a new key starts on: the provider's newest Claude Sonnet for Anthropic (its list is newest first),
 * and the documented default for the others when the list has it. Falls back to the first model listed.
 */
export function defaultModel(provider: AiProvider, models: AiModelOption[]): string {
  const ids = models.map((m) => m.id);
  if (provider === 'anthropic') {
    const sonnet = ids.find((id) => /^claude-sonnet-/.test(id));
    if (sonnet) return sonnet;
  }
  if (ids.includes(FALLBACK_MODELS[provider])) return FALLBACK_MODELS[provider];
  if (provider === 'openrouter') {
    const sonnet = ids.find((id) => id.startsWith('anthropic/claude-sonnet'));
    if (sonnet) return sonnet;
  }
  if (provider === 'gemini') {
    const flash = ids.find((id) => /^gemini-[\d.]+-flash$/.test(id));
    if (flash) return flash;
  }
  return ids[0] ?? FALLBACK_MODELS[provider];
}

/** The provider's models with one key, the recommended one marked. `cacheKey` must not be the key itself. */
export async function listModels(
  provider: AiProvider,
  apiKey: string,
  cacheKey: string,
  refresh = false,
): Promise<AiModelOption[]> {
  const id = `${provider}:${cacheKey}`;
  const hit = cache.get(id);
  if (hit && !refresh && Date.now() - hit.at < CACHE_MS) return hit.models;
  const listed = await LISTS[provider](apiKey);
  const recommended = defaultModel(provider, listed);
  const models = listed.map((m) => (m.id === recommended ? { ...m, recommended: true } : m));
  cache.set(id, { at: Date.now(), models });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return models;
}

/** A model's name from a cached list ("Claude Sonnet 5.5"), else a readable form of its id. */
export function modelName(provider: AiProvider, model: string): string {
  for (const [key, entry] of cache)
    if (key.startsWith(`${provider}:`)) {
      const found = entry.models.find((m: AiModelOption) => m.id === model);
      if (found) return found.name;
    }
  return prettyModel(model);
}

/** "claude-sonnet-5-5" reads "Claude Sonnet 5.5"; other ids stay as they are. */
export function prettyModel(model: string): string {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(model);
  if (claude) {
    const [, family, major, minor] = claude;
    return `Claude ${family[0].toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`;
  }
  return model;
}
