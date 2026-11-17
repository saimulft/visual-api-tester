import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { DOCS_LIMITS, fetchDocs, looksLikeHtml } from './fetch';

/**
 * One docs page as readable Markdown, for the AI: the main content through Readability, linkedom and Turndown,
 * capped at about 60,000 characters, plus the same-site links on the page so the AI can pick what to read
 * next. Markdown and plain text (llms.txt, .md pages) come back as they are.
 */
export const PAGE_CHARS = 60_000;
const MAX_LINKS = 150;

export type ReadPage = {
  url: string;
  title: string | null;
  markdown: string;
  /** True when the page was longer than the cap. */
  cut: boolean;
  links: { text: string; url: string }[];
};

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
turndown.remove(['script', 'style', 'noscript', 'iframe']);
turndown.remove((node) => node.nodeName.toLowerCase() === 'svg');

function sameSite(a: string, b: string) {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

function cleanUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function dedupeLinks(links: { text: string; url: string }[], base: string) {
  const seen = new Set<string>();
  const out: { text: string; url: string }[] = [];
  for (const link of links) {
    if (!sameSite(link.url, base) || seen.has(link.url) || link.url === base) continue;
    seen.add(link.url);
    out.push({ text: link.text.replace(/\s+/g, ' ').trim().slice(0, 120), url: link.url });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/** Markdown links in text: [title](url). */
export function markdownLinks(text: string, base: string) {
  const links: { text: string; url: string }[] = [];
  for (const match of text.matchAll(/\[([^\]]{0,200})\]\((\S+?)\)/g)) {
    const url = cleanUrl(match[2], base);
    if (url) links.push({ text: match[1], url });
  }
  return links;
}

const cap = (text: string) =>
  text.length > PAGE_CHARS ? { markdown: text.slice(0, PAGE_CHARS), cut: true } : { markdown: text, cut: false };

/** Turns fetched HTML into readable Markdown and its links. */
export function htmlToPage(html: string, url: string): ReadPage {
  const { document } = parseHTML(html);
  const links = dedupeLinks(
    Array.from(document.querySelectorAll('a[href]')).flatMap((a) => {
      const href = cleanUrl(a.getAttribute('href') ?? '', url);
      return href ? [{ text: a.textContent ?? '', url: href }] : [];
    }),
    url,
  );
  const title = document.querySelector('title')?.textContent?.trim() || null;
  let content: string | null = null;
  let heading: string | null = null;
  try {
    // Readability lifts the page's main heading out as the article title: it goes back on top.
    const article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
    content = article?.content ?? null;
    heading = article?.title?.trim() || null;
  } catch {
    content = null;
  }
  const body = content ?? document.querySelector('main')?.innerHTML ?? document.body?.innerHTML ?? '';
  const text = turndown
    .turndown(body)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const markdown = content && heading && !text.startsWith('#') ? `# ${heading}\n\n${text}` : text;
  return { url, title, ...cap(markdown), links };
}

export async function readPage(url: string): Promise<ReadPage> {
  const page = await fetchDocs(url, { maxBytes: DOCS_LIMITS.pageBytes });
  if (!page.ok) throw new Error(`${url} answered ${page.status}.`);
  if (looksLikeHtml(page)) return htmlToPage(page.text, page.url);
  // Markdown, plain text or JSON: as it is.
  const text = page.contentType.includes('json')
    ? (() => {
        try {
          return JSON.stringify(JSON.parse(page.text), null, 1);
        } catch {
          return page.text;
        }
      })()
    : page.text;
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  return { url: page.url, title, ...cap(text), links: dedupeLinks(markdownLinks(text, page.url), page.url) };
}
