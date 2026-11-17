/**
 * Dot paths, as the spec writes them: "$" is the whole value, "$.hits" a field, "$.data[0].items" an index,
 * "$.items[*].id" every item. The leading "$." is optional ("objectID", "company.name").
 */
type Segment = { key: string } | { index: number } | { all: true };

const cache = new Map<string, Segment[]>();

export function parsePath(path: string): Segment[] {
  const hit = cache.get(path);
  if (hit) return hit;
  const segments: Segment[] = [];
  const text = path.trim().replace(/^\$\.?/, '');
  for (const part of text.split('.').filter(Boolean)) {
    const match = /^([^[\]]*)((?:\[(?:\d+|\*)\])*)$/.exec(part);
    if (!match) {
      segments.push({ key: part });
      continue;
    }
    if (match[1]) segments.push({ key: match[1] });
    for (const bracket of match[2].match(/\[(\d+|\*)\]/g) ?? []) {
      const inner = bracket.slice(1, -1);
      segments.push(inner === '*' ? { all: true } : { index: Number(inner) });
    }
  }
  if (cache.size > 500) cache.clear();
  cache.set(path, segments);
  return segments;
}

/** Reads a dot path. Missing parts give undefined; "[*]" maps over a list and flattens one level. */
export function readPath(data: unknown, path: string): unknown {
  let current: unknown[] = [data];
  let many = false;
  for (const segment of parsePath(path)) {
    const next: unknown[] = [];
    for (const value of current) {
      if (value === null || value === undefined) continue;
      if ('all' in segment) {
        many = true;
        if (Array.isArray(value)) next.push(...value);
      } else if ('index' in segment) {
        if (Array.isArray(value)) next.push(value[segment.index]);
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        next.push((value as Record<string, unknown>)[segment.key]);
      }
    }
    current = next;
  }
  if (many) return current.filter((v) => v !== undefined);
  return current[0];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Sets a dot path inside an object, making the objects on the way. A path ending in "[]" appends to that
 * array ("query.bool.filter[]"), making the array when it isn't there yet.
 */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const append = path.endsWith('[]');
  const keys = (append ? path.slice(0, -2) : path)
    .replace(/^\$\.?/, '')
    .split('.')
    .filter(Boolean);
  if (!keys.length) return;
  let node: Record<string, unknown> = target;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (append) {
    if (!Array.isArray(node[last])) node[last] = [];
    (node[last] as unknown[]).push(value);
  } else node[last] = value;
}

/** A deep copy of plain JSON. */
export function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
