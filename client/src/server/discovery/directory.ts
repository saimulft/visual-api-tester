import type { ApiListing } from '@/contracts/discovery';
import { monogramOf } from '@/contracts/projects';
import entries from './directory.json';

/**
 * The small curated directory: the APIs Dialed knows well, with their docs, key placement, a free key test and
 * brief suggestions. Searched before APIs.guru.
 */
type Entry = Omit<ApiListing, 'source'> & { aliases: string[] };

const DIRECTORY = entries as unknown as Entry[];

export const GENERAL_BRIEFS = [
  'Find records that match a few filters',
  'Look up one item by its id',
  'Pull what’s new every day',
];

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function toListing(entry: Entry): ApiListing {
  const { aliases: _aliases, ...rest } = entry;
  void _aliases;
  return { ...rest, monogram: rest.monogram || monogramOf(rest.name), source: 'directory' };
}

/** Directory entries matching a query, best first: exact name, then name or alias start, then contains. */
export function searchDirectory(query: string): ApiListing[] {
  const q = norm(query);
  if (!q) return [];
  const scored = DIRECTORY.flatMap((entry) => {
    const names = [entry.name, entry.slug, ...entry.aliases].map(norm);
    const score = names.some((n) => n === q)
      ? 3
      : names.some((n) => n.startsWith(q) || q.startsWith(n))
        ? 2
        : names.some((n) => n.includes(q)) || (entry.topic && norm(entry.topic).includes(q))
          ? 1
          : 0;
    return score ? [{ entry, score }] : [];
  });
  return scored.sort((a, b) => b.score - a.score).map((s) => toListing(s.entry));
}

export function directoryEntry(slug: string): ApiListing | null {
  const entry = DIRECTORY.find((e) => e.slug === slug);
  return entry ? toListing(entry) : null;
}

/** The entry whose docs or API live on this host, for "Use another link". */
export function directoryByHost(host: string): ApiListing | null {
  const entry = DIRECTORY.find((e) => {
    try {
      return new URL(e.docsUrl).host === host || e.apiHost === host;
    } catch {
      return false;
    }
  });
  return entry ? toListing(entry) : null;
}
