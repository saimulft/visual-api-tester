import { z } from 'zod';

/**
 * Docs discovery: finding an API's docs from its name, probing a docs site for llms.txt, OpenAPI and the
 * sitemap, and what the New project screen shows ("Found the CoreSignal docs").
 */

/** How the API takes its key, as far as the directory knows ("unknown": ask, and let the AI work it out). */
export type KeyPlacement =
  { in: 'header' | 'query'; name: string; prefix?: string } | { in: 'none' } | { in: 'unknown' };

/** A call that tests a key without spending anything (New project's "Test it with one free search"). */
export type KeyTest = {
  method: 'GET' | 'POST';
  /** Full URL on the API's own host. */
  url: string;
  body?: unknown;
  /** Response headers that report credits left, when the API sends one. */
  creditsHeader?: string;
};

/** One API in the curated directory or found through APIs.guru. */
export type ApiListing = {
  slug: string;
  name: string;
  monogram: string;
  docsUrl: string;
  openApiUrl: string | null;
  /** The API's own host, which a saved key is bound to ("api.coresignal.com"). Null when unknown. */
  apiHost: string | null;
  /** What the API covers, for "31 endpoints for company, employee and job data". */
  topic: string | null;
  key: KeyPlacement;
  /** Where the person finds a key ("Find it in your CoreSignal dashboard under API keys."). */
  keyHint: string | null;
  keyTest: KeyTest | null;
  /** What it costs, in a line ("Search is free; full records cost credits."). */
  costNote: string | null;
  /** Brief suggestions for the "Or start from" chips. */
  briefs: string[];
  source: 'directory' | 'apis.guru' | 'link';
};

/** What a probe of a docs site found. */
export type DocsProbe = {
  docsUrl: string;
  docsHost: string;
  title: string | null;
  llmsTxt: string | null;
  llmsFullTxt: string | null;
  openApiUrl: string | null;
  sitemapUrl: string | null;
  /** Docs pages listed in llms.txt or the sitemap. */
  pages: number | null;
  /** Endpoints: exact from OpenAPI, or the distinct API paths the docs mention. */
  endpoints: number | null;
  endpointsFrom: 'openapi' | 'docs' | null;
  /** "docs.coresignal.com · 31 endpoints for company, employee and job data" */
  summary: string;
};

export type FoundApi = { listing: ApiListing; probe: DocsProbe | null };

export const FindQuerySchema = z.object({
  q: z.string().trim().min(2, 'Type at least two letters.').max(120),
});

export const ProbeSchema = z.object({
  url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https?:\/\//.test(v) && URL.canParse(v), 'Enter the full docs address, starting https://.'),
  slug: z.string().trim().max(48).optional(),
});

/** "docs.coresignal.com · 31 endpoints for company, employee and job data" */
export function probeSummary(probe: Pick<DocsProbe, 'docsHost' | 'pages' | 'endpoints'>, topic: string | null): string {
  const about = topic ? ` for ${topic}` : '';
  if (probe.endpoints) return `${probe.docsHost} · ${probe.endpoints.toLocaleString('en')} endpoints${about}`;
  if (probe.pages) return `${probe.docsHost} · ${probe.pages.toLocaleString('en')} pages of docs${about}`;
  return `${probe.docsHost}${topic ? ` · ${topic}` : ''}`;
}
