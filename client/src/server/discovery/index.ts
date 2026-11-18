import { FindQuerySchema, ProbeSchema, type ApiListing, type DocsProbe, type FoundApi } from '@/contracts/discovery';
import { ApiError } from '@/contracts/common';
import { monogramOf } from '@/contracts/projects';
import { checkBody } from '../http/inputs';
import { assertPublicHost } from '../net/public-address';
import type { Ctx } from '../services/context';
import { searchApisGuru } from './apis-guru';
import { directoryByHost, directoryEntry, GENERAL_BRIEFS, searchDirectory } from './directory';
import { limitDiscovery } from './fetch';
import { probeDocs } from './probe';

/**
 * Docs discovery for New project and the MCP tool read_api_docs. findApi searches the curated directory, then
 * APIs.guru; probe reads a docs site's llms.txt, OpenAPI and sitemap (cached for an hour per address).
 */
export { readPage, type ReadPage } from './read-page';
export { readOpenApi, type CompactOpenApi } from './openapi';
export { probeDocs } from './probe';
export { directoryEntry, GENERAL_BRIEFS } from './directory';
export { testApiKey } from './key-test';

const PROBE_CACHE_MS = 60 * 60_000;
const globals = globalThis as unknown as { __dialedProbes?: Map<string, { at: number; probe: DocsProbe }> };
const probes = (globals.__dialedProbes ??= new Map());

/** Directory matches first; APIs.guru fills in when the directory has fewer than three. */
export async function findApi(query: string): Promise<ApiListing[]> {
  const fromDirectory = searchDirectory(query);
  if (fromDirectory.length >= 3) return fromDirectory.slice(0, 5);
  let fromGuru: ApiListing[] = [];
  try {
    fromGuru = await searchApisGuru(query);
  } catch {
    fromGuru = [];
  }
  const seen = new Set(fromDirectory.map((l) => l.slug));
  return [...fromDirectory, ...fromGuru.filter((l) => !seen.has(l.slug))].slice(0, 6);
}

/** A probe, from the cache when it's fresh. */
export async function cachedProbe(listing: ApiListing): Promise<DocsProbe> {
  const hit = probes.get(listing.docsUrl);
  if (hit && Date.now() - hit.at < PROBE_CACHE_MS) return hit.probe;
  const probe = await probeDocs(listing.docsUrl, {
    topic: listing.topic,
    apiHost: listing.apiHost,
    openApiUrl: listing.openApiUrl,
  });
  probes.set(listing.docsUrl, { at: Date.now(), probe });
  if (probes.size > 300) probes.delete(probes.keys().next().value!);
  return probe;
}

/** A listing for a docs link that's in no directory: named from the host. */
function listingForLink(url: string): ApiListing {
  const host = new URL(url).host.replace(/^(www|docs|developer|developers|api)\./, '');
  const base = host.split('.')[0];
  const name = base.charAt(0).toUpperCase() + base.slice(1);
  return {
    slug:
      base
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 48) || 'api',
    name,
    monogram: monogramOf(name),
    docsUrl: url,
    openApiUrl: null,
    apiHost: null,
    topic: null,
    key: { in: 'unknown' },
    keyHint: null,
    keyTest: null,
    costNote: null,
    briefs: [],
    source: 'link',
  };
}

// ---------- For the routes (signed in, rate-limited) ----------

export async function find(ctx: Ctx, input: unknown): Promise<{ results: ApiListing[]; briefs: string[] }> {
  const { q } = checkBody(FindQuerySchema, input);
  limitDiscovery(ctx.user.id);
  return { results: await findApi(q), briefs: GENERAL_BRIEFS };
}

/** Probes a listing's docs, or a link the person pasted ("Use another link"). */
export async function probe(ctx: Ctx, input: unknown): Promise<FoundApi> {
  const data = checkBody(ProbeSchema, input);
  limitDiscovery(ctx.user.id);
  try {
    assertPublicHost(new URL(data.url));
  } catch {
    throw new ApiError(
      'private_address',
      'That address points to a private or local network, so Dialed won’t read it. Paste the public docs link.',
      422,
    );
  }
  const known = (data.slug ? directoryEntry(data.slug) : null) ?? directoryByHost(new URL(data.url).host);
  const listing: ApiListing = known ? { ...known, docsUrl: data.url } : listingForLink(data.url);
  return { listing, probe: await cachedProbe(listing) };
}
