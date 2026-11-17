import { ApiError, type Problem } from '@/contracts/common';
import {
  allControls,
  type ApiSpec,
  type Auth,
  type Control,
  type Endpoint,
  type Value,
  type Values,
} from '@/contracts/spec';
import { isEmptyValue, resolveValues } from '@/contracts/values';
import { last4, masked as maskedText } from '../secrets';
import { cloneJson, readPath, setPath } from './paths';

/**
 * The request builder: a spec, an endpoint and the person's values in, one HTTP request out. It follows the
 * rules at the top of contracts/spec.ts (empty values left out, format, template, where the key goes, query
 * controls sharing a key joined with commas), plus pagination. It never adds a key: withKey does that, and
 * only for the key's own host over https. Pure: nothing here calls out.
 */

export type BuiltRequest = {
  endpointId: string;
  method: 'GET' | 'POST';
  /** The full URL with its query. */
  url: string;
  headers: Record<string, string>;
  /** The body as sent (JSON or form text), or null. */
  body: string | null;
  /** The body as an object, for the Request tab. Null for a GET. */
  json: Record<string, unknown> | null;
  /** Header names that carry the key, so the guard drops them on a redirect to another host. */
  secretHeaders: string[];
};

/** Where a paged call is. The first page is { index: 0 }. */
export type PageState = {
  index: number;
  /** The page number sent (page pagination). */
  page?: number;
  offset?: number;
  cursor?: string;
  /** The next URL from a Link header (link pagination). */
  url?: string;
};

/** Values the runner adds itself: the collect step's id, by parameter name (a {path} slot or a query param). */
export type BuildExtra = { params?: Record<string, string | number> };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isPoint = (value: unknown): value is { lat: number; lng: number; radius: number } =>
  isPlainObject(value) && 'lat' in value && 'lng' in value;
const isMinMax = (value: unknown): value is { min?: number | string; max?: number | string } =>
  isPlainObject(value) && !('lat' in value);

export function endpointOf(spec: ApiSpec, endpointId: string): Endpoint {
  const endpoint = spec.endpoints.find((e) => e.id === endpointId);
  if (!endpoint) throw new ApiError('not_found', `This API has no "${endpointId}" endpoint.`, 404);
  return endpoint;
}

// ---------- Values into parts ----------

type Parts = { value?: unknown; min?: unknown; max?: unknown; lat?: unknown; lng?: unknown; radius?: unknown };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Shapes one scalar by the control's format (iso-date, unix, year). Lists are handled by the caller. */
export function formatScalar(value: unknown, format: Control['format']): unknown {
  switch (format) {
    case 'iso-date':
      if (typeof value === 'string') return value.slice(0, 10);
      if (typeof value === 'number') return new Date(value < 1e11 ? value * 1000 : value).toISOString().slice(0, 10);
      return value;
    case 'unix':
      if (typeof value === 'string') {
        const ms = Date.parse(DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value);
        return Number.isFinite(ms) ? Math.floor(ms / 1000) : value;
      }
      return value;
    case 'year':
      if (typeof value === 'string' && /^\d{4}/.test(value)) return Number(value.slice(0, 4));
      return value;
    default:
      return value;
  }
}

/**
 * A control's value as the parts a template or key can use: { value } for most kinds, { min, max } for
 * ranges and date ranges, { lat, lng, radius } for a map radius. Null when the value is empty.
 * The top of a log scale reads "10,000+", so a logRange max at the control's max is left open.
 */
export function partsOf(control: Control, value: Value | undefined): Parts | null {
  if (value === undefined || isEmptyValue(value)) return null;
  const shape = (v: unknown) => formatScalar(v, control.format);
  if (isPoint(value)) return { lat: value.lat, lng: value.lng, radius: value.radius };
  if (isMinMax(value)) {
    let max = value.max;
    if (control.kind === 'logRange' && typeof max === 'number' && control.max !== undefined && max >= control.max)
      max = undefined;
    const parts = {
      min: value.min === undefined || value.min === '' ? undefined : shape(value.min),
      max: max === undefined || max === '' ? undefined : shape(max),
    };
    return parts.min === undefined && parts.max === undefined ? null : parts;
  }
  if (Array.isArray(value)) {
    const items = value.map(shape);
    return { value: control.format === 'comma' ? items.map(textOf).join(',') : items };
  }
  return { value: shape(value) };
}

/** A value as text for a query, header or path. */
function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(',');
  return JSON.stringify(value);
}

/** A value as the list of texts a query parameter repeats. */
function textsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map(textOf) : [textOf(value)];
}

const PLACEHOLDER = /^\{(value|min|max|lat|lng|radius)\}$/;
const INLINE = /\{(value|min|max|lat|lng|radius)\}/g;
const UNFILLED = Symbol('unfilled');

/** "points>={value}" with the parts filled in, or undefined when a part it names is missing. */
function fillString(template: string, parts: Parts): string | undefined {
  let missing = false;
  const out = template.replace(INLINE, (_, name: keyof Parts) => {
    const part = parts[name];
    if (part === undefined || part === null) {
      missing = true;
      return '';
    }
    return textOf(part);
  });
  return missing ? undefined : out;
}

/** A JSON template with its placeholders filled, types kept. Unfilled entries are dropped. */
function fillJson(node: unknown, parts: Parts): unknown {
  if (typeof node === 'string') {
    const whole = PLACEHOLDER.exec(node);
    if (whole) {
      const part = parts[whole[1] as keyof Parts];
      return part === undefined ? UNFILLED : part;
    }
    if (node.includes('{')) {
      const filled = fillString(node, parts);
      return filled === undefined ? UNFILLED : filled;
    }
    return node;
  }
  if (Array.isArray(node)) return node.map((item) => fillJson(item, parts)).filter((item) => item !== UNFILLED);
  if (isPlainObject(node)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      const filled = fillJson(child, parts);
      if (filled === UNFILLED) continue;
      // An object whose entries were all unfilled goes too: { gte: "{min}", lte: "{max}" } with neither.
      if (isPlainObject(child) && Object.keys(child).length && isPlainObject(filled) && !Object.keys(filled).length)
        continue;
      out[key] = filled;
    }
    return out;
  }
  return node;
}

/** What a string-keyed control puts at its key, after the template. Undefined leaves it out. */
function shaped(control: Control, parts: Parts): unknown {
  const template = control.template;
  if (typeof template === 'string') {
    if (Array.isArray(parts.value)) {
      const items = parts.value.map((item) => fillString(template, { ...parts, value: item }));
      const kept = items.filter((item): item is string => item !== undefined);
      return kept.length ? kept : undefined;
    }
    return fillString(template, parts);
  }
  if (template && typeof template === 'object') {
    const filled = fillJson(template, parts);
    return isPlainObject(filled) && !Object.keys(filled).length ? undefined : filled;
  }
  if (parts.value !== undefined) return parts.value;
  if (parts.lat !== undefined) return { lat: parts.lat, lng: parts.lng, radius: parts.radius };
  // A range with one string key and no template: the body gets { min, max }, anything else "min,max".
  if (control.in === 'body') return { ...(parts.min !== undefined && { min: parts.min }), ...(parts.max !== undefined && { max: parts.max }) };
  return [parts.min ?? '', parts.max ?? ''].map(textOf).join(',');
}

// ---------- Errors ----------

/** Value problems with the control's label in place of its id, for people: "Employees must stay between 1 and 10000." */
export function inputError(spec: ApiSpec, problems: Problem[]): ApiError {
  const byId = new Map(allControls(spec).map((c) => [c.id, c]));
  const friendly = problems.map((problem) => {
    const control = byId.get(problem.path);
    if (!control) return problem;
    const message = problem.message.split(`"${control.id}"`).join(control.label);
    return { path: problem.path, message: message.charAt(0).toUpperCase() + message.slice(1) };
  });
  return new ApiError('bad_input', friendly[0]?.message ?? 'Check the controls.', 422, friendly);
}

// ---------- Building ----------

type QueryEntry = { values: string[]; controls: number };

/**
 * Builds one request for an endpoint. Missing values take each control's default; a required control left
 * empty, or a value of the wrong shape, throws a 422 naming the control. `page` is where a paged call is
 * (omit it for the first page); `extra.params` fills a {path} slot or a query parameter (the collect step's id).
 */
export function buildRequest(
  spec: ApiSpec,
  endpointId: string,
  values: Values = {},
  page?: PageState,
  extra: BuildExtra = {},
): BuiltRequest {
  const endpoint = endpointOf(spec, endpointId);
  const controls = allControls(spec).filter((c) => c.endpointId === endpoint.id);
  const { values: resolved, problems } = resolveValues(spec, values);
  const mine = problems.filter((p) => controls.some((c) => c.id === p.path));
  if (mine.length) throw inputError(spec, mine);

  let path = endpoint.path;
  const query = new Map<string, QueryEntry>();
  const headers: Record<string, string> = { accept: 'application/json', ...(endpoint.fixed?.headers ?? {}) };
  const body: Record<string, unknown> | null =
    endpoint.method === 'POST' ? cloneJson((endpoint.fixed?.body as Record<string, unknown>) ?? {}) : null;

  for (const [key, value] of Object.entries(endpoint.fixed?.query ?? {}))
    if (value !== undefined && value !== null) query.set(key, { values: textsOf(value), controls: 0 });

  /** A control's contribution to a query parameter. Several controls on one key join with commas. */
  const addQuery = (key: string, value: unknown) => {
    const texts = textsOf(value);
    const entry = query.get(key);
    if (!entry || entry.controls === 0) query.set(key, { values: texts, controls: 1 });
    else query.set(key, { values: [...entry.values, ...texts], controls: entry.controls + 1 });
  };
  const fillPath = (key: string, value: unknown) => {
    path = path.split(`{${key}}`).join(encodeURIComponent(textsOf(value).join(',')));
  };
  const place = (control: Control, key: string, value: unknown) => {
    if (value === undefined) return;
    switch (control.in) {
      case 'query':
        addQuery(key, value);
        break;
      case 'header':
        headers[key.toLowerCase()] = textsOf(value).join(',');
        break;
      case 'path':
        fillPath(key, value);
        break;
      case 'body':
        if (!body) break;
        // A list appended without a template adds each item ("tags[]" with ["a", "b"]).
        if (key.endsWith('[]') && Array.isArray(value) && !control.template)
          for (const item of value) setPath(body, key, item);
        else setPath(body, key, value);
        break;
    }
  };

  for (const control of controls) {
    const parts = partsOf(control, resolved[control.id]);
    if (!parts) continue;
    const key = control.key;
    if (typeof key === 'string') place(control, key, shaped(control, parts));
    else if ('lat' in key) {
      place(control, key.lat, parts.lat);
      place(control, key.lng, parts.lng);
      place(control, key.radius, parts.radius);
    } else {
      place(control, key.min, parts.min);
      place(control, key.max, parts.max);
    }
  }

  for (const [name, value] of Object.entries(extra.params ?? {})) {
    if (path.includes(`{${name}}`)) fillPath(name, value);
    else query.set(name, { values: [String(value)], controls: 1 });
  }

  /** A pagination parameter: a query name, or a body dot path when it starts with "$.". */
  const setParam = (name: string | undefined, value: string | number) => {
    if (!name) return;
    if (name.startsWith('$.') && body) setPath(body, name, value);
    else query.set(name, { values: [String(value)], controls: 1 });
  };
  let pageUrl: string | null = null;
  const p = endpoint.pagination;
  if (p && p.type !== 'none') {
    const setByControl = (name: string) =>
      controls.some((c) => typeof c.key === 'string' && c.key === name && !isEmptyValue(resolved[c.id]));
    if (p.sizeParam && p.size && !setByControl(p.sizeParam)) setParam(p.sizeParam, p.size);
    if (page) {
      if (p.type === 'page' && page.page !== undefined) setParam(p.param, page.page);
      if (p.type === 'offset' && page.offset !== undefined) setParam(p.param, page.offset);
      if (p.type === 'cursor' && page.cursor) setParam(p.param, page.cursor);
      if (p.type === 'link' && page.url) pageUrl = page.url;
    }
  }

  const unfilled = /\{([^}]+)\}/.exec(path);
  if (unfilled) {
    const control = controls.find((c) => c.in === 'path' && c.key === unfilled[1]);
    throw new ApiError(
      'bad_input',
      control ? `${control.label} needs a value.` : `The "${unfilled[1]}" part of the address needs a value.`,
      422,
      [{ path: control?.id ?? unfilled[1], message: `${control?.label ?? unfilled[1]} needs a value.` }],
    );
  }

  let url: string;
  if (pageUrl) url = pageUrl;
  else {
    const search = new URLSearchParams();
    for (const [key, entry] of query) {
      if (entry.controls > 1) search.append(key, entry.values.join(','));
      else for (const value of entry.values) search.append(key, value);
    }
    const qs = search.toString();
    url = `${spec.api.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }

  let text: string | null = null;
  if (body) {
    if (endpoint.body === 'form') {
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(body))
        if (value !== undefined && value !== null) for (const item of textsOf(value)) form.append(key, item);
      text = form.toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
    } else {
      text = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
  }

  return { endpointId: endpoint.id, method: endpoint.method, url, headers, body: text, json: body, secretHeaders: [] };
}

// ---------- Keys ----------

export type ApiKeyForCall = { secret: string; host: string };

const globals = globalThis as unknown as { __dialedPlainHttpKeys?: boolean };

/** Tests talk to a local http server; they may let keys go over plain http to it (Vitest only). */
export function allowPlainHttpKeysForTests(allow: boolean) {
  if (!process.env.VITEST) throw new Error('allowPlainHttpKeysForTests only works under Vitest.');
  globals.__dialedPlainHttpKeys = allow;
}

const MASK_TOKEN = 'DIALEDMASKEDKEY';

/**
 * Adds the key the way the spec's auth says: a header (with its prefix), a query parameter, a bearer token
 * or basic auth. Only over https, and only when the request's host is the key's own host; anything else
 * throws and sends nothing. Returns the request to send and a masked copy for logs and the Request tab.
 */
export function withKey(
  request: BuiltRequest,
  auth: Auth,
  key: ApiKeyForCall | null,
): { request: BuiltRequest; masked: BuiltRequest } {
  if (auth.type === 'none') return { request, masked: request };
  if (!key) throw new ApiError('needs_key', 'This API needs a key. Add one in Settings.', 400);

  const url = new URL(request.url);
  const plainOk = Boolean(process.env.VITEST && globals.__dialedPlainHttpKeys && url.protocol === 'http:');
  if (url.protocol !== 'https:' && !plainOk)
    throw new ApiError('wrong_host', 'A key is only ever sent over https.', 403);
  if (url.host.toLowerCase() !== key.host.toLowerCase())
    throw new ApiError('wrong_host', `This key is saved for ${key.host}, so it isn’t sent to ${url.host}.`, 403);

  const show = maskedText(last4(key.secret));
  const apply = (secret: string): BuiltRequest => {
    const headers = { ...request.headers };
    let target = request.url;
    const secretHeaders: string[] = [];
    switch (auth.type) {
      case 'header': {
        const name = auth.name.toLowerCase();
        const prefix = auth.prefix ? (auth.prefix.endsWith(' ') ? auth.prefix : `${auth.prefix} `) : '';
        headers[name] = `${prefix}${secret}`;
        secretHeaders.push(name);
        break;
      }
      case 'query': {
        const next = new URL(target);
        next.searchParams.set(auth.name, secret);
        target = next.toString();
        break;
      }
      case 'bearer':
        headers.authorization = `Bearer ${secret}`;
        secretHeaders.push('authorization');
        break;
      case 'basic': {
        const pair = secret.includes(':') ? secret : `${secret}:`;
        headers.authorization = `Basic ${secret === MASK_TOKEN ? MASK_TOKEN : Buffer.from(pair).toString('base64')}`;
        secretHeaders.push('authorization');
        break;
      }
    }
    return { ...request, url: target, headers, secretHeaders };
  };

  const real = apply(key.secret);
  const shown = apply(MASK_TOKEN);
  const unmask = (text: string) => text.split(MASK_TOKEN).join(show);
  const masked: BuiltRequest = {
    ...shown,
    url: unmask(shown.url),
    headers: Object.fromEntries(Object.entries(shown.headers).map(([k, v]) => [k, unmask(v)])),
  };
  return { request: real, masked };
}

/** Removes a secret from any text that might echo it (an API's error body, a redirect URL). */
export function scrub(text: string, secret: string | null | undefined): string {
  if (!secret || secret.length < 4) return text;
  const show = maskedText(last4(secret));
  return text
    .split(secret)
    .join(show)
    .split(encodeURIComponent(secret))
    .join(show);
}

// ---------- Reading responses ----------

/** The records in a response, as a list: "$" may be a list or one object. */
export function readRecords(endpoint: Endpoint, data: unknown): unknown[] {
  const found = readPath(data, endpoint.records);
  if (found === undefined || found === null) return [];
  return Array.isArray(found) ? found : [found];
}

function headerOrPath(path: string, data: unknown, headers: Headers): unknown {
  if (path.startsWith('header:')) return headers.get(path.slice('header:'.length).trim());
  return readPath(data, path);
}

/** The API's own match count, from the body or a header, or null. */
export function readTotal(endpoint: Endpoint, data: unknown, headers: Headers): number | null {
  if (!endpoint.total) return null;
  const raw =
    endpoint.total.from === 'header' ? headers.get(endpoint.total.path) : readPath(data, endpoint.total.path);
  const total = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(total) ? total : null;
}

/** A record's id: its idPath, the record itself when it's a bare id, or its "id" field. */
export function readId(endpoint: Endpoint | undefined, record: unknown): string | null {
  let id: unknown;
  if (endpoint?.idPath) id = readPath(record, endpoint.idPath);
  else if (typeof record === 'string' || typeof record === 'number') id = record;
  else id = readPath(record, 'id');
  if (typeof id === 'string' && id) return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return null;
}

/** The rel="next" URL of a Link header, made absolute. */
export function linkNext(header: string | null, base: string): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;(.*)/.exec(part.trim());
    if (match && /rel\s*=\s*"?([^";]*\s)?next(\s[^";]*)?"?/i.test(match[2])) {
      try {
        return new URL(match[1], base).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The page number or offset the first call starts at: the endpoint's fixed value for that parameter, else 0. */
function startOf(endpoint: Endpoint, name: string | undefined): number {
  if (!name) return 0;
  const fixed = name.startsWith('$.')
    ? readPath(endpoint.fixed?.body, name)
    : (endpoint.fixed?.query as Record<string, unknown> | undefined)?.[name];
  const n = Number(fixed);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Where the next page is, or null when this was the last one: maxPages reached, an empty page, a short page,
 * no cursor or no next link. The first page leaves the page parameter out (the API's own first page), so the
 * runner drops a second page that repeats it (an API whose pages start at 1).
 */
export function nextPage(
  endpoint: Endpoint,
  state: PageState,
  response: { data: unknown; headers: Headers; url: string },
  count: number,
  pageSize?: number,
): PageState | null {
  const p = endpoint.pagination;
  if (!p || p.type === 'none') return null;
  const index = state.index + 1;
  if (index >= p.maxPages || count === 0) return null;
  const size = pageSize ?? p.size;
  switch (p.type) {
    case 'page':
      if (size && count < size) return null;
      return { index, page: (state.page ?? startOf(endpoint, p.param)) + 1 };
    case 'offset':
      if (size && count < size) return null;
      return { index, offset: (state.offset ?? startOf(endpoint, p.param)) + count };
    case 'cursor': {
      const cursor = p.cursorPath ? headerOrPath(p.cursorPath, response.data, response.headers) : undefined;
      if (cursor === undefined || cursor === null || cursor === '' || String(cursor) === state.cursor) return null;
      return { index, cursor: String(cursor) };
    }
    case 'link': {
      const next = linkNext(response.headers.get('link'), response.url);
      return next && next !== state.url ? { index, url: next } : null;
    }
  }
}
