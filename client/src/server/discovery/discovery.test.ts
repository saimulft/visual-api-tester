import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeSummary } from '@/contracts/discovery';
import { allowLoopbackForTests } from '../net/public-address';
import { matchProviders } from './apis-guru';
import { directoryEntry, searchDirectory } from './directory';
import { readOpenApi } from './openapi';
import { countApiPaths, probeDocs } from './probe';
import { PAGE_CHARS, readPage } from './read-page';

/** Two local docs sites built from saved fixtures: one with an OpenAPI file, one with llms.txt only. */
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

function site(files: Record<string, { body: string; type: string }>): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const file = files[new URL(req.url ?? '/', 'http://x').pathname];
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('<html><body>Not found</body></html>');
    }
    res.writeHead(200, { 'content-type': file.type });
    res.end(file.body);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }),
    ),
  );
}

let news: { server: Server; base: string };
let data: { server: Server; base: string };

beforeAll(async () => {
  allowLoopbackForTests(true);
  const html = { body: fixture('docs-page.html'), type: 'text/html; charset=utf-8' };
  news = await site({
    '/docs/intro': html,
    '/docs/search': html,
    '/docs/huge': {
      body: `<html><body><main><h1>Big</h1><p>${'word '.repeat(40_000)}</p></main></body></html>`,
      type: 'text/html',
    },
    '/specs/openapi.yaml': { body: fixture('openapi.yaml'), type: 'application/yaml' },
    '/sitemap.xml': { body: fixture('sitemap.xml'), type: 'application/xml' },
  });
  data = await site({
    '/': { body: '<html><head><title>Example Data Docs</title></head><body>Docs</body></html>', type: 'text/html' },
    '/llms.txt': { body: fixture('llms.txt'), type: 'text/markdown' },
    '/llms-full.txt': { body: fixture('llms-full.txt'), type: 'text/markdown' },
  });
});

afterAll(() => {
  allowLoopbackForTests(false);
  news.server.close();
  data.server.close();
});

describe('probeDocs', () => {
  it('finds an OpenAPI file through a link on the page and counts its endpoints exactly', async () => {
    const probe = await probeDocs(`${news.base}/docs/intro`, { topic: 'stories and comments' });
    expect(probe.openApiUrl).toBe(`${news.base}/specs/openapi.yaml`);
    expect(probe).toMatchObject({ endpoints: 4, endpointsFrom: 'openapi', pages: 4, llmsTxt: null });
    expect(probe.title).toBe('Searching stories | Example News API');
    expect(probe.summary).toBe(`${new URL(news.base).host} · 4 endpoints for stories and comments`);
  });

  it('counts the API paths llms-full.txt mentions when there’s no OpenAPI', async () => {
    const probe = await probeDocs(`${data.base}/`, { apiHost: 'api.example-data.test', topic: 'company data' });
    expect(probe.llmsTxt).toBe(`${data.base}/llms.txt`);
    expect(probe.llmsFullTxt).toBe(`${data.base}/llms-full.txt`);
    expect(probe).toMatchObject({ openApiUrl: null, endpoints: 5, endpointsFrom: 'docs', pages: 7 });
  });

  it('collapses ids and queries when counting paths', () => {
    const text =
      'GET https://api.x.test/v2/a/collect/123?f=1\nGET https://api.x.test/v2/a/collect/456\nPOST /v2/a/search';
    expect(countApiPaths(text, 'api.x.test')).toBe(2);
  });

  it('writes the found-docs line', () => {
    expect(
      probeSummary({ docsHost: 'docs.coresignal.com', pages: 202, endpoints: 31 }, 'company, employee and job data'),
    ).toBe('docs.coresignal.com · 31 endpoints for company, employee and job data');
    expect(probeSummary({ docsHost: 'hn.algolia.com', pages: 1200, endpoints: null }, null)).toBe(
      'hn.algolia.com · 1,200 pages of docs',
    );
  });
});

describe('readPage', () => {
  it('turns a docs page into Markdown with its same-site links, without scripts', async () => {
    const page = await readPage(`${news.base}/docs/intro`);
    expect(page.title).toBe('Searching stories | Example News API');
    expect(page.markdown).toContain('Searching stories');
    expect(page.markdown).toContain('`numericFilters`');
    expect(page.markdown).not.toContain('window.tracking');
    const urls = page.links.map((l) => l.url);
    expect(urls).toContain(`${news.base}/docs/search`);
    expect(urls).toContain(`${news.base}/docs/items`);
    expect(urls.some((u) => u.includes('elsewhere.example.org'))).toBe(false);
    expect(page.cut).toBe(false);
  });

  it('caps a long page at about 60,000 characters', async () => {
    const page = await readPage(`${news.base}/docs/huge`);
    expect(page.cut).toBe(true);
    expect(page.markdown.length).toBeLessThanOrEqual(PAGE_CHARS);
  });

  it('returns Markdown as it is, with its links', async () => {
    const page = await readPage(`${data.base}/llms.txt`);
    expect(page.markdown).toBe(fixture('llms.txt'));
    expect(page.title).toBe('Example Data Docs');
  });

  it('refuses private addresses once the test allowance is off', async () => {
    allowLoopbackForTests(false);
    await expect(readPage(`${news.base}/docs/intro`)).rejects.toMatchObject({ code: 'docs_private_address' });
    allowLoopbackForTests(true);
  });
});

describe('readOpenApi', () => {
  it('compacts servers, auth, parameters, bodies and response fields', async () => {
    const api = await readOpenApi(`${news.base}/specs/openapi.yaml`);
    expect(api).toMatchObject({
      title: 'Example News API',
      servers: ['https://api.example-news.test/api/v1'],
      auth: [{ name: 'apiKey', type: 'apiKey', in: 'header', param: 'X-Api-Key' }],
      endpointCount: 4,
      cut: false,
    });
    const search = api.endpoints.find((e) => e.path === '/search')!;
    expect(search.params.find((p) => p.name === 'tags')?.enum).toContain('show_hn');
    expect(search.params.find((p) => p.name === 'query')).toMatchObject({ required: true, type: 'string' });
    expect(search.returns).toEqual(expect.arrayContaining(['hits[]', 'hits[].title: string', 'nbHits: integer']));
    const item = api.endpoints.find((e) => e.path === '/items/{id}')!;
    expect(item.params[0]).toMatchObject({ name: 'id', in: 'path', required: true });
    const alerts = api.endpoints.find((e) => e.path === '/alerts')!;
    expect(alerts.body).toEqual({ required: true, fields: ['query: string', 'email: string (email)'] });
  });
});

describe('the directory', () => {
  it('finds the curated APIs by name, alias or topic', () => {
    expect(searchDirectory('CoreSignal')[0].slug).toBe('coresignal');
    expect(searchDirectory('hacker news')[0].slug).toBe('hacker-news');
    expect(searchDirectory('weather').map((l) => l.slug)).toEqual(
      expect.arrayContaining(['open-meteo', 'openweather']),
    );
    expect(searchDirectory('zzzz')).toEqual([]);
  });

  it('keeps every key test on the API’s own host', () => {
    for (const slug of ['coresignal', 'open-meteo', 'hacker-news', 'google-places', 'nasa']) {
      const entry = directoryEntry(slug)!;
      expect(entry.docsUrl).toMatch(/^https:\/\//);
      if (entry.keyTest) expect(new URL(entry.keyTest.url).host).toBe(entry.apiHost);
    }
  });

  it('matches APIs.guru providers by their domain', () => {
    const list = ['stripe.com', 'stripe.local', 'mystripe.io', 'github.com', 'stripe-like.app'];
    expect(matchProviders(list, 'stripe')).toEqual(['stripe.com', 'stripe.local', 'stripe-like.app', 'mystripe.io']);
    expect(matchProviders(list, 'x')).toEqual([]);
  });
});
