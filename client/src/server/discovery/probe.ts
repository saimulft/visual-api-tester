import { parseHTML } from 'linkedom';
import { probeSummary, type DocsProbe } from '@/contracts/discovery';
import { DOCS_LIMITS, looksLikeHtml, tryFetch } from './fetch';
import { countOperations, parseOpenApi } from './openapi';
import { markdownLinks } from './read-page';

/**
 * Probes a docs site: llms.txt and llms-full.txt, an OpenAPI or Swagger file (at the common paths and through
 * links on the page), and the sitemap. It returns the docs host, how many pages there are and how many
 * endpoints: exact from OpenAPI, else the distinct API paths the docs mention.
 */
const OPENAPI_PATHS = [
  '/openapi.json',
  '/openapi.yaml',
  '/swagger.json',
  '/v3/api-docs',
  '/api-docs',
  '/docs/openapi.json',
  '/api/openapi.json',
];
const PROBE_MS = 8_000;
const MAX_SITEMAPS = 6;

const originOf = (url: string) => new URL(url).origin;

/** The docs folder: https://x.com/docs/intro gives https://x.com/docs. */
function folderOf(url: string): string | null {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  if (!parts.length) return null;
  return `${u.origin}/${parts[0]}`;
}

async function firstOk(urls: string[], maxBytes: number = DOCS_LIMITS.pageBytes) {
  for (const url of [...new Set(urls)]) {
    const got = await tryFetch(url, { maxBytes, timeoutMs: PROBE_MS });
    if (got && !looksLikeHtml(got) && got.text.trim()) return got;
  }
  return null;
}

/** Links on a page that look like an OpenAPI or Swagger file. */
export function openApiLinks(html: string, base: string): string[] {
  const { document } = parseHTML(html);
  const out: string[] = [];
  for (const a of Array.from(document.querySelectorAll('a[href], link[href]'))) {
    const href = a.getAttribute('href') ?? '';
    if (!/(openapi|swagger)[^/]*\.(json|ya?ml)(\?|$)|\/(openapi|swagger)(\.json|\.ya?ml)?$/i.test(href)) continue;
    try {
      out.push(new URL(href, base).toString());
    } catch {
      /* not a URL */
    }
  }
  return out.slice(0, 5);
}

/** Distinct API paths a docs text mentions: URLs on the API host, and "GET /path" lines. */
export function countApiPaths(text: string, apiHost: string | null): number {
  const paths = new Set<string>();
  const norm = (path: string) =>
    path
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .split('/')
      .map((seg) => (/^\d+$|^[0-9a-f-]{16,}$|^\{.+\}$/i.test(seg) ? '{id}' : seg))
      .join('/');
  if (apiHost) {
    const escaped = apiHost.replace(/[.]/g, '\\.');
    for (const m of text.matchAll(new RegExp(`https?://${escaped}(/[A-Za-z0-9_{}/.:-]+)`, 'g'))) paths.add(norm(m[1]));
  }
  for (const m of text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_{}/.:-]{2,})/g)) paths.add(norm(m[2]));
  return paths.size;
}

async function sitemapPages(origin: string): Promise<{ url: string; pages: number } | null> {
  const root = await tryFetch(`${origin}/sitemap.xml`, { timeoutMs: PROBE_MS });
  if (!root || !/<(urlset|sitemapindex)/i.test(root.text)) return null;
  const locs = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  if (!/<sitemapindex/i.test(root.text)) return { url: root.url, pages: locs(root.text).length };
  const children = locs(root.text).slice(0, MAX_SITEMAPS);
  const counts = await Promise.all(
    children.map(async (url) => {
      const got = await tryFetch(url, { timeoutMs: PROBE_MS });
      return got ? locs(got.text).length : 0;
    }),
  );
  return { url: root.url, pages: counts.reduce((a, b) => a + b, 0) };
}

export async function probeDocs(
  docsUrl: string,
  hints: { topic?: string | null; apiHost?: string | null; openApiUrl?: string | null } = {},
): Promise<DocsProbe> {
  const origin = originOf(docsUrl);
  const folder = folderOf(docsUrl);
  const docsHost = new URL(docsUrl).host;

  const [page, llms, sitemap] = await Promise.all([
    tryFetch(docsUrl, { timeoutMs: PROBE_MS }),
    firstOk([...(folder ? [`${folder}/llms.txt`] : []), `${origin}/llms.txt`]),
    sitemapPages(origin),
  ]);
  const title =
    page && looksLikeHtml(page)
      ? (parseHTML(page.text).document.querySelector('title')?.textContent?.trim() ?? null)
      : null;

  // OpenAPI: the directory's, then links on the page or in llms.txt, then the common paths.
  const candidates = [
    ...(hints.openApiUrl ? [hints.openApiUrl] : []),
    ...(page && looksLikeHtml(page) ? openApiLinks(page.text, page.url) : []),
    ...(llms
      ? markdownLinks(llms.text, llms.url)
          .map((l) => l.url)
          .filter((u) => /(openapi|swagger).*\.(json|ya?ml)$/i.test(u))
      : []),
    ...OPENAPI_PATHS.map((p) => `${origin}${p}`),
    ...(hints.apiHost ? OPENAPI_PATHS.slice(0, 3).map((p) => `https://${hints.apiHost}${p}`) : []),
  ];
  // Every candidate at once; the first usable one in candidate order wins.
  const openApiAt = async (url: string) => {
    const got = await tryFetch(url, { maxBytes: DOCS_LIMITS.bigBytes, timeoutMs: PROBE_MS });
    if (!got || looksLikeHtml(got) || !/("openapi"|"swagger"|^\s*openapi:|^\s*swagger:)/m.test(got.text.slice(0, 4000)))
      return null;
    try {
      return { url: got.url, endpoints: countOperations(await parseOpenApi(got.url)) };
    } catch {
      return null;
    }
  };
  const [found, full] = await Promise.all([
    Promise.all([...new Set(candidates)].map(openApiAt)).then((all) => all.find(Boolean) ?? null),
    llms ? firstOk([llms.url.replace(/llms\.txt$/, 'llms-full.txt')], DOCS_LIMITS.bigBytes) : Promise.resolve(null),
  ]);
  const openApiUrl = found?.url ?? null;
  let endpoints = found?.endpoints ?? null;
  let endpointsFrom: DocsProbe['endpointsFrom'] = endpoints ? 'openapi' : null;
  const llmsFull = full?.url ?? null;
  if (llms && !endpoints) {
    const mentioned = countApiPaths(`${llms.text}\n${full?.text ?? ''}`, hints.apiHost ?? null);
    if (mentioned >= 2) {
      endpoints = mentioned;
      endpointsFrom = 'docs';
    }
  }

  const llmsPages = llms ? markdownLinks(llms.text, llms.url).length : 0;
  const pages = llmsPages || sitemap?.pages || null;
  return {
    docsUrl,
    docsHost,
    title,
    llmsTxt: llms?.url ?? null,
    llmsFullTxt: llmsFull,
    openApiUrl,
    sitemapUrl: sitemap?.url ?? null,
    pages,
    endpoints,
    endpointsFrom,
    summary: probeSummary({ docsHost, pages, endpoints }, hints.topic ?? null),
  };
}
