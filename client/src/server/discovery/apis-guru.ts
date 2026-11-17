import type { ApiListing } from '@/contracts/discovery';
import { monogramOf } from '@/contracts/projects';
import { tryFetch } from './fetch';

/**
 * The APIs.guru OpenAPI directory (api.apis.guru/v2): definitions contributed to it are CC0 1.0 and the rest
 * are collected from public sources, and the project asks people to use its REST API rather than the raw
 * repository. Dialed reads two small endpoints: the provider list (cached for a day) and one provider's APIs.
 */
const BASE = 'https://api.apis.guru/v2';
const DAY_MS = 24 * 60 * 60_000;
const MAX_RESULTS = 5;

const globals = globalThis as unknown as { __dialedApisGuru?: { at: number; providers: string[] } };

async function providers(): Promise<string[]> {
  const hit = globals.__dialedApisGuru;
  if (hit && Date.now() - hit.at < DAY_MS) return hit.providers;
  const got = await tryFetch(`${BASE}/providers.json`, { maxBytes: 2 * 1024 * 1024 });
  if (!got) return hit?.providers ?? [];
  try {
    const list = (JSON.parse(got.text) as { data?: unknown }).data;
    const names = Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
    globals.__dialedApisGuru = { at: Date.now(), providers: names };
    return names;
  } catch {
    return hit?.providers ?? [];
  }
}

type GuruApi = {
  info?: { title?: string; description?: string; 'x-providerName'?: string };
  externalDocs?: { url?: string };
  swaggerUrl?: string;
};

const slugOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

/** Providers whose domain matches the query, best first: "stripe" finds stripe.com. */
export function matchProviders(list: string[], query: string): string[] {
  const q = query.toLowerCase().replace(/[^a-z0-9.]+/g, '');
  if (q.length < 2) return [];
  const label = (p: string) => p.split('.')[0];
  const exact = list.filter((p) => label(p) === q || p === q);
  const starts = list.filter((p) => !exact.includes(p) && p.startsWith(q));
  const contains = list.filter((p) => !exact.includes(p) && !starts.includes(p) && p.includes(q));
  return [...exact, ...starts, ...contains].slice(0, MAX_RESULTS);
}

/** APIs.guru listings for a query: up to five, each with its OpenAPI file. Empty when the directory is down. */
export async function searchApisGuru(query: string): Promise<ApiListing[]> {
  const matched = matchProviders(await providers(), query);
  const results = await Promise.all(
    matched.map(async (provider) => {
      const got = await tryFetch(`${BASE}/${encodeURIComponent(provider)}.json`, { maxBytes: 4 * 1024 * 1024 });
      if (!got) return [];
      let apis: Record<string, { preferred?: string; versions?: Record<string, GuruApi> }>;
      try {
        apis = (JSON.parse(got.text) as { apis?: typeof apis }).apis ?? {};
      } catch {
        return [];
      }
      return Object.entries(apis)
        .slice(0, 2)
        .flatMap(([id, entry]) => {
          const version = entry.versions?.[entry.preferred ?? ''] ?? Object.values(entry.versions ?? {})[0];
          const api = version ?? (entry as GuruApi);
          const name = api.info?.title?.trim() || id;
          const docsUrl = api.externalDocs?.url || `https://${provider}`;
          if (!/^https?:\/\//.test(docsUrl)) return [];
          const listing: ApiListing = {
            slug: slugOf(id.replace(':', '-')),
            name,
            monogram: monogramOf(name),
            docsUrl,
            openApiUrl: api.swaggerUrl ?? null,
            apiHost: null,
            topic: null,
            key: { in: 'unknown' },
            keyHint: null,
            keyTest: null,
            costNote: null,
            briefs: [],
            source: 'apis.guru',
          };
          return [listing];
        });
    }),
  );
  return results.flat();
}
