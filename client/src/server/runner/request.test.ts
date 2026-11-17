import { describe, expect, it } from 'vitest';
import { checkSpec, type ApiSpec } from '@/contracts/spec';
import coresignalJson from '../seed/specs/coresignal.json';
import hackerNewsJson from '../seed/specs/hacker-news.json';
import openMeteoJson from '../seed/specs/open-meteo.json';
import {
  buildRequest,
  linkNext,
  nextPage,
  readId,
  readRecords,
  readTotal,
  withKey,
  type BuiltRequest,
} from './request';
import { readPath, setPath } from './paths';

function spec(input: unknown): ApiSpec {
  const checked = checkSpec(input);
  if (!checked.ok) throw new Error(JSON.stringify(checked.problems));
  return checked.spec;
}

const hn = spec(hackerNewsJson);
const meteo = spec(openMeteoJson);
const cs = spec(coresignalJson);

const query = (req: BuiltRequest) => new URL(req.url).searchParams;
const body = (req: BuiltRequest) => JSON.parse(req.body ?? 'null');

describe('paths', () => {
  it('reads and sets dot paths', () => {
    const data = { a: { b: [{ c: 1 }, { c: 2 }] }, hits: [1, 2] };
    expect(readPath(data, '$')).toBe(data);
    expect(readPath(data, '$.hits')).toEqual([1, 2]);
    expect(readPath(data, 'a.b[1].c')).toBe(2);
    expect(readPath(data, '$.a.b[*].c')).toEqual([1, 2]);
    expect(readPath(data, '$.missing.deeper')).toBeUndefined();
    const target: Record<string, unknown> = {};
    setPath(target, 'query.bool.filter[]', { a: 1 });
    setPath(target, 'query.bool.filter[]', { b: 2 });
    setPath(target, 'size', 10);
    expect(target).toEqual({ query: { bool: { filter: [{ a: 1 }, { b: 2 }] } }, size: 10 });
  });
});

describe('the seed specs', () => {
  it('builds Hacker News with defaults, and joins numericFilters with commas', () => {
    const first = buildRequest(hn, 'search', {});
    expect(first.method).toBe('GET');
    expect(first.url.startsWith('https://hn.algolia.com/api/v1/search?')).toBe(true);
    expect(query(first).get('query')).toBe('AI launch');
    expect(query(first).get('tags')).toBe('show_hn');
    expect(query(first).getAll('numericFilters')).toEqual(['points>=50']);
    expect(query(first).get('hitsPerPage')).toBe('50');
    expect(query(first).has('page')).toBe(false);
    expect(first.body).toBeNull();

    const since = buildRequest(hn, 'search', { since: '2026-11-01', points: 100, type: 'story' });
    const unix = Date.UTC(2026, 10, 1) / 1000;
    expect(query(since).getAll('numericFilters')).toEqual([`points>=100,created_at_i>${unix}`]);
    expect(query(since).get('tags')).toBe('story');

    // An empty value leaves the parameter out.
    const empty = buildRequest(hn, 'search', { query: '', points: null });
    expect(query(empty).has('query')).toBe(false);
    expect(query(empty).has('numericFilters')).toBe(false);
  });

  it('builds Open-Meteo with comma lists and the fixed time zone', () => {
    const req = buildRequest(meteo, 'forecast', { days: 3, units: 'fahrenheit' });
    const q = query(req);
    expect(q.get('latitude')).toBe('-33.87,-37.81,-27.47');
    expect(q.get('longitude')).toBe('151.21,144.96,153.03');
    expect(q.get('daily')).toBe('temperature_2m_max,temperature_2m_min,precipitation_sum');
    expect(q.get('forecast_days')).toBe('3');
    expect(q.get('temperature_unit')).toBe('fahrenheit');
    expect(q.get('timezone')).toBe('auto');
  });

  it('names the control when a required value is missing', () => {
    expect(() => buildRequest(meteo, 'forecast', { latitudes: [] })).toThrow(/Latitudes needs a value/);
    try {
      buildRequest(meteo, 'forecast', { days: 40 });
    } catch (error) {
      expect((error as { code: string }).code).toBe('bad_input');
      expect((error as Error).message).toBe('Days ahead must stay between 1 and 16.');
    }
  });

  it('builds the CoreSignal search as Elasticsearch DSL, one clause per control', () => {
    const req = buildRequest(cs, 'search', { keywords: ['payments', 'fintech'] });
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.coresignal.com/cdapi/v2/company_multi_source/search/es_dsl?items_per_page=25');
    expect(req.headers['content-type']).toBe('application/json');
    expect(body(req)).toEqual({
      query: {
        bool: {
          filter: [
            { terms: { 'industry.exact': ['Software Development', 'Computer Software'] } },
            { match: { description: 'payments,fintech' } },
            { terms: { 'hq_country.exact': ['Australia'] } },
            { range: { employees_count: { gte: 50, lte: 200 } } },
          ],
        },
      },
      sort: ['id'],
    });
    // The top of a log scale is open ("10,000+"), and a missing side is dropped from the range clause.
    const open = body(buildRequest(cs, 'search', { employees: { min: 200, max: 10000 }, industry: [] }));
    expect(open.query.bool.filter).toEqual([
      { terms: { 'hq_country.exact': ['Australia'] } },
      { range: { employees_count: { gte: 200 } } },
    ]);
    // The fixed body is copied, never changed.
    expect(cs.endpoints[0].fixed?.body).toEqual({ query: { bool: { filter: [] } }, sort: ['id'] });
  });

  it('fills the collect step’s id into the path', () => {
    const req = buildRequest(cs, 'collect', {}, undefined, { params: { company_id: 81244310 } });
    expect(req.url).toBe('https://api.coresignal.com/cdapi/v2/company_multi_source/collect/81244310');
    expect(() => buildRequest(cs, 'collect', {})).toThrow(/company_id/);
  });
});

const every = spec({
  version: 1,
  api: {
    name: 'Every kind',
    slug: 'every',
    baseUrl: 'https://api.example.com/v1',
    docsUrl: 'https://example.com/docs',
    auth: { type: 'none' },
  },
  endpoints: [
    {
      id: 'get',
      label: 'Get',
      description: 'A GET with every query kind.',
      method: 'GET',
      path: '/items/{region}',
      records: '$.items',
      cost: { perCall: 0, perRecord: 0, unit: 'calls' },
      free: true,
    },
    {
      id: 'form',
      label: 'Form',
      description: 'A form POST.',
      method: 'POST',
      path: '/form',
      body: 'form',
      records: '$',
      cost: { perCall: 0, perRecord: 0, unit: 'calls' },
      free: true,
    },
  ],
  channels: [
    {
      id: 'all',
      title: 'All',
      controls: [
        { id: 'text', label: 'Name', param: 'name', endpointId: 'get', in: 'query', key: 'name', kind: 'text', by: 'ai' },
        { id: 'words', label: 'Words', param: 'tag', endpointId: 'get', in: 'query', key: 'tag', kind: 'keywords', by: 'ai' },
        {
          id: 'choice',
          label: 'Sort',
          param: 'sort',
          endpointId: 'get',
          in: 'query',
          key: 'sort',
          kind: 'choice',
          options: [
            { value: 'new', label: 'Newest' },
            { value: 'top', label: 'Top' },
          ],
          by: 'ai',
        },
        {
          id: 'multi',
          label: 'Countries',
          param: 'country',
          endpointId: 'get',
          in: 'query',
          key: 'country',
          kind: 'multi',
          format: 'array',
          options: [
            { value: 'AU', label: 'Australia' },
            { value: 'NZ', label: 'New Zealand' },
          ],
          by: 'ai',
        },
        { id: 'toggle', label: 'Active', param: 'active', endpointId: 'get', in: 'query', key: 'active', kind: 'toggle', by: 'ai' },
        {
          id: 'range',
          label: 'Founded',
          param: 'founded',
          endpointId: 'get',
          in: 'query',
          key: { min: 'founded_from', max: 'founded_to' },
          kind: 'range',
          min: 1990,
          max: 2025,
          by: 'ai',
        },
        {
          id: 'log',
          label: 'Staff',
          param: 'staff',
          endpointId: 'get',
          in: 'query',
          key: 'staff',
          kind: 'logRange',
          min: 1,
          max: 10000,
          template: 'staff:{min}..{max}',
          by: 'ai',
        },
        { id: 'dial', label: 'Days', param: 'days', endpointId: 'get', in: 'query', key: 'days', kind: 'dial', min: 1, max: 30, by: 'ai' },
        {
          id: 'date',
          label: 'Since',
          param: 'since',
          endpointId: 'get',
          in: 'query',
          key: 'since',
          kind: 'date',
          format: 'iso-date',
          by: 'ai',
        },
        {
          id: 'dates',
          label: 'Window',
          param: 'window',
          endpointId: 'get',
          in: 'query',
          key: { min: 'from_year', max: 'to_year' },
          kind: 'date',
          range: true,
          format: 'year',
          by: 'ai',
        },
        { id: 'amount', label: 'How many', param: 'limit', endpointId: 'get', in: 'query', key: 'limit', kind: 'amount', min: 1, max: 100, by: 'ai' },
        { id: 'places', label: 'Cities', param: 'city', endpointId: 'get', in: 'query', key: 'city', kind: 'places', format: 'comma', by: 'ai' },
        {
          id: 'map',
          label: 'Near',
          param: 'near',
          endpointId: 'get',
          in: 'query',
          key: { lat: 'lat', lng: 'lon', radius: 'radius_km' },
          kind: 'mapRadius',
          by: 'ai',
        },
        { id: 'region', label: 'Region', param: 'region', endpointId: 'get', in: 'path', key: 'region', kind: 'text', default: 'apac', by: 'ai' },
        { id: 'lang', label: 'Language', param: 'Accept-Language', endpointId: 'get', in: 'header', key: 'Accept-Language', kind: 'text', by: 'ai' },
        { id: 'formq', label: 'Form query', param: 'q', endpointId: 'form', in: 'body', key: 'q', kind: 'text', by: 'ai' },
        { id: 'formtags', label: 'Form tags', param: 'tags', endpointId: 'form', in: 'body', key: 'tags', kind: 'keywords', by: 'ai' },
      ],
    },
  ],
  notes: [],
  run: { mode: 'single', endpointId: 'get' },
});

describe('every control kind', () => {
  it('puts each kind where its key says', () => {
    const req = buildRequest(every, 'get', {
      text: 'kestrel',
      words: ['saas', 'b2b'],
      choice: 'top',
      multi: ['AU', 'NZ'],
      toggle: true,
      range: { min: 2000, max: 2020 },
      log: { min: 10, max: 500 },
      dial: 7,
      date: '2026-11-01T10:00:00Z',
      dates: { min: '2015-01-01', max: '2024-12-31' },
      amount: 25,
      places: ['Sydney', 'Melbourne'],
      map: { lat: -33.87, lng: 151.21, radius: 25 },
      lang: 'en-AU',
    });
    const q = query(req);
    expect(new URL(req.url).pathname).toBe('/v1/items/apac');
    expect(q.get('name')).toBe('kestrel');
    expect(q.getAll('tag')).toEqual(['saas', 'b2b']);
    expect(q.get('sort')).toBe('top');
    expect(q.getAll('country')).toEqual(['AU', 'NZ']);
    expect(q.get('active')).toBe('true');
    expect(q.get('founded_from')).toBe('2000');
    expect(q.get('founded_to')).toBe('2020');
    expect(q.get('staff')).toBe('staff:10..500');
    expect(q.get('days')).toBe('7');
    expect(q.get('since')).toBe('2026-11-01');
    expect(q.get('from_year')).toBe('2015');
    expect(q.get('to_year')).toBe('2024');
    expect(q.get('limit')).toBe('25');
    expect(q.get('city')).toBe('Sydney,Melbourne');
    expect(q.get('lat')).toBe('-33.87');
    expect(q.get('lon')).toBe('151.21');
    expect(q.get('radius_km')).toBe('25');
    expect(req.headers['accept-language']).toBe('en-AU');
  });

  it('leaves out empty values and a string template missing a part', () => {
    const req = buildRequest(every, 'get', { toggle: false, log: { min: 10 }, words: [], map: null });
    const q = query(req);
    expect(q.get('active')).toBe('false');
    expect(q.has('staff')).toBe(false);
    expect(q.has('tag')).toBe(false);
    expect(q.has('lat')).toBe(false);
  });

  it('sends a form body', () => {
    const req = buildRequest(every, 'form', { formq: 'hello world', formtags: ['a', 'b'] });
    expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(req.body).toBe('q=hello+world&tags=a&tags=b');
  });

  it('refuses a value of the wrong shape, naming the control', () => {
    expect(() => buildRequest(every, 'get', { choice: 'oldest' })).toThrow(/Sort has no option "oldest"/);
    expect(() => buildRequest(every, 'get', { dial: 99 })).toThrow(/Days must stay between 1 and 30/);
  });
});

describe('keys', () => {
  const req = buildRequest(cs, 'search', {});

  it('adds a header key only for its own host over https, and masks the copy', () => {
    const { request, masked } = withKey(req, cs.api.auth, { secret: 'cs-live-abcdef7Qk1', host: 'api.coresignal.com' });
    expect(request.headers.apikey).toBe('cs-live-abcdef7Qk1');
    expect(request.secretHeaders).toEqual(['apikey']);
    expect(masked.headers.apikey).toBe('••••7Qk1');
    expect(JSON.stringify(masked)).not.toContain('abcdef');
    expect(() => withKey(req, cs.api.auth, { secret: 'cs-live-abcdef7Qk1', host: 'evil.example.com' })).toThrow(
      /isn’t sent to api.coresignal.com/,
    );
    const plain = { ...req, url: req.url.replace('https://', 'http://') };
    expect(() => withKey(plain, cs.api.auth, { secret: 'cs-live-abcdef7Qk1', host: 'api.coresignal.com' })).toThrow(
      /https/,
    );
    expect(() => withKey(req, cs.api.auth, null)).toThrow(/needs a key/);
  });

  it('handles query, bearer, basic and prefixed header auth', () => {
    const key = { secret: 'secret-key-9876', host: 'api.coresignal.com' };
    const q = withKey(req, { type: 'query', name: 'api_key' }, key);
    expect(new URL(q.request.url).searchParams.get('api_key')).toBe('secret-key-9876');
    expect(q.masked.url).toContain('api_key=••••9876');
    expect(q.masked.url).not.toContain('secret-key');
    expect(withKey(req, { type: 'bearer' }, key).request.headers.authorization).toBe('Bearer secret-key-9876');
    expect(withKey(req, { type: 'basic' }, key).request.headers.authorization).toBe(
      `Basic ${Buffer.from('secret-key-9876:').toString('base64')}`,
    );
    expect(withKey(req, { type: 'header', name: 'Authorization', prefix: 'Token' }, key).request.headers.authorization).toBe(
      'Token secret-key-9876',
    );
    expect(withKey(req, { type: 'none' }, null).request).toBe(req);
  });
});

describe('reading answers', () => {
  it('reads records, totals and ids', () => {
    const [search, collect] = cs.endpoints;
    const headers = new Headers({ 'x-total-results': '3412', 'x-next-page-after': '99' });
    expect(readRecords(search, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(readTotal(search, [1, 2, 3], headers)).toBe(3412);
    expect(readId(search, 81244310)).toBe('81244310');
    expect(readRecords(collect, { id: 5, name: 'Kestrel Labs' })).toEqual([{ id: 5, name: 'Kestrel Labs' }]);
    expect(readId(collect, { id: 5 })).toBe('5');
    const hnSearch = hn.endpoints[0];
    expect(readRecords(hnSearch, { hits: [{ objectID: 'a' }], nbHits: 12 })).toEqual([{ objectID: 'a' }]);
    expect(readTotal(hnSearch, { hits: [], nbHits: 12 }, new Headers())).toBe(12);
    expect(readId(hnSearch, { objectID: 'a' })).toBe('a');
    expect(readRecords(hnSearch, {})).toEqual([]);
  });

  it('parses a Link header', () => {
    const header = '<https://api.example.com/v1/items?page=2>; rel="next", <https://api.example.com/v1/items?page=9>; rel="last"';
    expect(linkNext(header, 'https://api.example.com/v1/items')).toBe('https://api.example.com/v1/items?page=2');
    expect(linkNext('</items?page=3>; rel=next', 'https://api.example.com/v1/items')).toBe(
      'https://api.example.com/items?page=3',
    );
    expect(linkNext('<https://x.test/a>; rel="prev"', 'https://x.test')).toBeNull();
  });
});

function paged(pagination: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return spec({
    ...every,
    endpoints: [{ ...every.endpoints[0], path: '/items', pagination, ...extra }],
    channels: [{ id: 'c', title: 'C', controls: [{ ...every.channels[0].controls[0] }] }],
  });
}
const res = (data: unknown, headers: Record<string, string> = {}, url = 'https://api.example.com/v1/items') => ({
  data,
  headers: new Headers(headers),
  url,
});

describe('pagination', () => {
  it('pages by number: the first page leaves it out', () => {
    const s = paged({ type: 'page', param: 'page', sizeParam: 'per_page', size: 2, maxPages: 3 });
    const e = s.endpoints[0];
    expect(query(buildRequest(s, 'get', {})).has('page')).toBe(false);
    expect(query(buildRequest(s, 'get', {})).get('per_page')).toBe('2');
    const second = nextPage(e, { index: 0 }, res({ items: [1, 2] }), 2);
    expect(second).toEqual({ index: 1, page: 1 });
    expect(query(buildRequest(s, 'get', {}, second!)).get('page')).toBe('1');
    expect(nextPage(e, second!, res({ items: [1, 2] }), 2)).toEqual({ index: 2, page: 2 });
    expect(nextPage(e, { index: 2, page: 2 }, res({ items: [1, 2] }), 2)).toBeNull(); // maxPages
    expect(nextPage(e, { index: 0 }, res({ items: [1] }), 1)).toBeNull(); // a short page is the last
    expect(nextPage(e, { index: 0 }, res({ items: [] }), 0)).toBeNull();
  });

  it('starts at a fixed first page when the endpoint sets one', () => {
    const s = paged({ type: 'page', param: 'page', maxPages: 3 }, { fixed: { query: { page: 1 } } });
    expect(query(buildRequest(s, 'get', {})).get('page')).toBe('1');
    expect(nextPage(s.endpoints[0], { index: 0 }, res({ items: [1] }), 1)).toEqual({ index: 1, page: 2 });
  });

  it('pages by offset', () => {
    const s = paged({ type: 'offset', param: 'offset', sizeParam: 'limit', size: 50, maxPages: 5 });
    const next = nextPage(s.endpoints[0], { index: 0 }, res({ items: new Array(50).fill(0) }), 50);
    expect(next).toEqual({ index: 1, offset: 50 });
    expect(query(buildRequest(s, 'get', {}, next!)).get('offset')).toBe('50');
    expect(nextPage(s.endpoints[0], next!, res({}), 50)).toEqual({ index: 2, offset: 100 });
  });

  it('pages by cursor, from the body or a header', () => {
    const body = paged({ type: 'cursor', param: 'cursor', cursorPath: '$.meta.next', maxPages: 5 });
    const next = nextPage(body.endpoints[0], { index: 0 }, res({ items: [1], meta: { next: 'abc' } }), 1);
    expect(next).toEqual({ index: 1, cursor: 'abc' });
    expect(query(buildRequest(body, 'get', {}, next!)).get('cursor')).toBe('abc');
    expect(nextPage(body.endpoints[0], next!, res({ items: [1], meta: { next: 'abc' } }), 1)).toBeNull();
    expect(nextPage(body.endpoints[0], next!, res({ items: [1], meta: {} }), 1)).toBeNull();

    const [search] = cs.endpoints;
    const fromHeader = nextPage(search, { index: 0 }, res([1, 2], { 'x-next-page-after': '81244310' }), 2);
    expect(fromHeader).toEqual({ index: 1, cursor: '81244310' });
    const after = buildRequest(cs, 'search', {}, fromHeader!);
    expect(query(after).get('after')).toBe('81244310');
  });

  it('follows a Link header', () => {
    const s = paged({ type: 'link', maxPages: 3 });
    const next = nextPage(
      s.endpoints[0],
      { index: 0 },
      res({ items: [1] }, { link: '<https://api.example.com/v1/items?page=2>; rel="next"' }),
      1,
    );
    expect(next).toEqual({ index: 1, url: 'https://api.example.com/v1/items?page=2' });
    expect(buildRequest(s, 'get', {}, next!).url).toBe('https://api.example.com/v1/items?page=2');
  });
});
