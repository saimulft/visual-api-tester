import { columnsOf, flattenRecord } from '../src/contracts/rows';
import { checkSpec, type ApiSpec, type Values } from '../src/contracts/spec';
import { closeDb, db, dialect, json, newId, now } from '../src/server/db';
import { migrate } from '../src/server/db/migrate';
import { recount } from '../src/server/datasets/save';
import { nextRunAfter, nextRuns } from '../src/server/schedules/timing';
import { seal } from '../src/server/secrets';
import { assertLocalDatabase } from '../src/server/seed';
import { ctxFor } from '../src/server/services/context';
import * as projects from '../src/server/services/projects';

/**
 * npm run db:seed, then: npx tsx --env-file-if-exists=.env scripts/seed-data.ts
 *
 * Chat B's seed on top of chat F's: presets, runs, datasets with rows and schedules for nadia@dialed.test,
 * matching the canvas (6 datasets and 6,818 rows; AU software with 234 rows over 8 runs and 96 repeats
 * skipped), so every screen has real-looking data locally. It adds two more projects the canvas shows
 * (Hiring: data roles, Cafés near the office). Times are relative to now. Safe to run again: it clears and
 * rebuilds nadia's runs, datasets, presets and schedules. Local databases only.
 */

const DAY = 24 * 60 * 60 * 1000;
const ZONE = 'Australia/Sydney';

// A small seeded random, so every run of the seed makes the same rows.
let state = 20261117;
const rand = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));

// ---------- Two more specs the canvas shows ----------

const JOBS_SPEC = {
  version: 1,
  api: {
    name: 'CoreSignal',
    slug: 'coresignal',
    baseUrl: 'https://api.coresignal.com/cdapi/v2',
    docsUrl: 'https://docs.coresignal.com/jobs-api',
    auth: { type: 'header', name: 'apikey' },
    credits: { from: 'header', name: 'x-credits-remaining' },
  },
  endpoints: [
    {
      id: 'search',
      label: 'Job search',
      description: 'Finds job posts that match the filters and returns their ids. Searching is free.',
      method: 'POST',
      path: '/job_multi_source/search/es_dsl',
      body: 'json',
      fixed: { body: { query: { bool: { filter: [] } }, sort: ['id'] } },
      records: '$',
      total: { from: 'header', path: 'x-total-results' },
      pagination: { type: 'cursor', param: 'after', cursorPath: 'header:x-next-page-after', maxPages: 10 },
      cost: { perCall: 0, perRecord: 0, unit: 'credits' },
      free: true,
    },
    {
      id: 'collect',
      label: 'Job post',
      description: 'One job post in full by id: title, company, location, salary and when it was posted.',
      method: 'GET',
      path: '/job_multi_source/collect/{job_id}',
      records: '$',
      idPath: 'id',
      cost: { perCall: 0, perRecord: 1, unit: 'credits' },
      free: false,
    },
  ],
  channels: [
    {
      id: 'role',
      title: 'Role',
      controls: [
        {
          id: 'title',
          label: 'Job title has',
          param: 'title',
          endpointId: 'search',
          in: 'body',
          key: 'query.bool.filter[]',
          kind: 'keywords',
          format: 'comma',
          template: { match: { title: '{value}' } },
          default: ['data analyst', 'data engineer'],
          by: 'ai',
        },
        {
          id: 'type',
          label: 'Employment',
          param: 'employment_type',
          endpointId: 'search',
          in: 'body',
          key: 'query.bool.filter[]',
          kind: 'choice',
          options: [
            { value: 'Full-time', label: 'Full-time' },
            { value: 'Part-time', label: 'Part-time' },
            { value: 'Contract', label: 'Contract' },
          ],
          template: { term: { employment_type: '{value}' } },
          default: 'Full-time',
          by: 'ai',
        },
      ],
    },
    {
      id: 'where',
      title: 'Location',
      controls: [
        {
          id: 'country',
          label: 'Country',
          param: 'country',
          endpointId: 'search',
          in: 'body',
          key: 'query.bool.filter[]',
          kind: 'places',
          template: { terms: { 'country.exact': '{value}' } },
          default: ['Australia'],
          by: 'ai',
        },
      ],
    },
    {
      id: 'when',
      title: 'Freshness',
      controls: [
        {
          id: 'days',
          label: 'Posted in the last',
          param: 'date_posted',
          endpointId: 'search',
          in: 'body',
          key: 'query.bool.filter[]',
          kind: 'dial',
          min: 1,
          max: 30,
          step: 1,
          unit: 'days',
          template: { range: { date_posted: { gte: 'now-{value}d/d' } } },
          default: 7,
          by: 'ai',
        },
        {
          id: 'active',
          label: 'Active posts only',
          param: 'status',
          endpointId: 'search',
          in: 'body',
          key: 'query.bool.filter[]',
          kind: 'toggle',
          template: { term: { active: '{value}' } },
          default: true,
          by: 'ai',
        },
      ],
    },
    {
      id: 'take',
      title: 'How many',
      controls: [
        {
          id: 'take',
          label: 'Posts to collect',
          help: 'Each full post costs 1 credit.',
          param: 'items_per_page',
          endpointId: 'search',
          in: 'query',
          key: 'items_per_page',
          kind: 'amount',
          min: 1,
          max: 200,
          step: 1,
          unit: 'posts',
          default: 20,
          required: true,
          by: 'ai',
        },
      ],
    },
  ],
  notes: [
    { kind: 'cost', text: 'Searching is free and returns ids. Each full job post costs 1 credit.' },
    {
      kind: 'tip',
      text: 'A seed example for local screens: check the job fields against the CoreSignal docs before relying on it.',
    },
  ],
  run: {
    mode: 'searchThenCollect',
    searchId: 'search',
    collectId: 'collect',
    idParam: 'job_id',
    takeControlId: 'take',
  },
};

const PLACES_SPEC = {
  version: 1,
  api: {
    name: 'Google Places',
    slug: 'google-places',
    baseUrl: 'https://places.googleapis.com/v1',
    docsUrl: 'https://developers.google.com/maps/documentation/places/web-service/nearby-search',
    auth: { type: 'header', name: 'X-Goog-Api-Key' },
  },
  endpoints: [
    {
      id: 'nearby',
      label: 'Nearby search',
      description: 'Places of a type inside a circle, up to 20 per call.',
      method: 'POST',
      path: '/places:searchNearby',
      body: 'json',
      fixed: {
        headers: {
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri',
        },
      },
      records: '$.places',
      idPath: 'id',
      pagination: { type: 'none', maxPages: 1 },
      cost: { perCall: 1, perRecord: 0, unit: 'calls' },
      free: false,
    },
  ],
  channels: [
    {
      id: 'what',
      title: 'What',
      controls: [
        {
          id: 'type',
          label: 'Place type',
          param: 'includedTypes',
          endpointId: 'nearby',
          in: 'body',
          key: 'includedTypes',
          kind: 'multi',
          options: [
            { value: 'cafe', label: 'Café' },
            { value: 'bakery', label: 'Bakery' },
            { value: 'restaurant', label: 'Restaurant' },
            { value: 'bar', label: 'Bar' },
          ],
          default: ['cafe'],
          by: 'ai',
        },
        {
          id: 'rank',
          label: 'Rank by',
          param: 'rankPreference',
          endpointId: 'nearby',
          in: 'body',
          key: 'rankPreference',
          kind: 'choice',
          options: [
            { value: 'POPULARITY', label: 'Popularity' },
            { value: 'DISTANCE', label: 'Distance' },
          ],
          default: 'POPULARITY',
          by: 'ai',
        },
      ],
    },
    {
      id: 'where',
      title: 'Where',
      controls: [
        {
          id: 'near',
          label: 'Near',
          param: 'locationRestriction.circle',
          endpointId: 'nearby',
          in: 'body',
          key: {
            lat: 'locationRestriction.circle.center.latitude',
            lng: 'locationRestriction.circle.center.longitude',
            radius: 'locationRestriction.circle.radius',
          },
          kind: 'mapRadius',
          min: 100,
          max: 5000,
          step: 100,
          unit: 'm',
          default: { lat: -33.8853, lng: 151.2108, radius: 1500 },
          by: 'ai',
        },
      ],
    },
    {
      id: 'take',
      title: 'How many',
      controls: [
        {
          id: 'take',
          label: 'Places',
          param: 'maxResultCount',
          endpointId: 'nearby',
          in: 'body',
          key: 'maxResultCount',
          kind: 'amount',
          min: 1,
          max: 20,
          step: 1,
          unit: 'places',
          default: 20,
          by: 'ai',
        },
      ],
    },
  ],
  notes: [
    { kind: 'limit', text: 'Up to 20 places come back per call, with no next page.' },
    { kind: 'cost', text: 'Google bills each call to your Maps account.' },
    { kind: 'tip', text: 'A seed example for local screens: check it against the Places docs before relying on it.' },
  ],
  run: { mode: 'single', endpointId: 'nearby', takeControlId: 'take' },
};

// ---------- Record makers ----------

const WORDS_A = [
  'Kestrel',
  'Tidepool',
  'Ironbark',
  'Quokka',
  'Harbourline',
  'Southerly',
  'Wattle',
  'Moorland',
  'Brightwave',
  'Saltbush',
  'Banksia',
  'Coral',
  'Redgum',
  'Lyrebird',
  'Mallee',
  'Dune',
  'Ember',
  'Granite',
  'Kookaburra',
  'Outback',
  'Pelican',
  'Riverbend',
  'Spinifex',
  'Tasman',
  'Waratah',
  'Yarra',
  'Bluegum',
  'Cassowary',
  'Fernleaf',
  'Highline',
];
const WORDS_B = [
  'Labs',
  'Analytics',
  'Systems',
  'Pay',
  'Health',
  'Cloud',
  'Software',
  'Learning',
  'Data',
  'Logistics',
  'Studio',
  'Robotics',
  'Security',
  'Commerce',
  'Energy',
  'Insights',
];
const CITIES = [
  'Sydney',
  'Melbourne',
  'Brisbane',
  'Perth',
  'Adelaide',
  'Canberra',
  'Hobart',
  'Newcastle',
  'Gold Coast',
];
const INDUSTRIES = ['Software Development', 'Computer Software', 'IT System Custom Software Development'];

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');

function company(id: number) {
  const name = `${pick(WORDS_A)} ${pick(WORDS_B)}`;
  const domain = `${slug(name)}.${pick(['com.au', 'com.au', 'io', 'co', 'dev'])}`;
  return {
    id,
    company_name: name,
    website_domain: domain,
    industry: pick(INDUSTRIES),
    employees_count: between(50, 200),
    founded_year: String(between(2008, 2022)),
    hq: { city: pick(CITIES), country: 'Australia' },
    last_updated_at: new Date(now() - between(1, 40) * DAY).toISOString().slice(0, 19).replace('T', ' '),
  };
}

const STORES = [
  { store: 'Sydney', lat: -33.87, lng: 151.21 },
  { store: 'Melbourne', lat: -37.81, lng: 144.96 },
  { store: 'Brisbane', lat: -27.47, lng: 153.03 },
  { store: 'Perth', lat: -31.95, lng: 115.86 },
  { store: 'Adelaide', lat: -34.93, lng: 138.6 },
  { store: 'Canberra', lat: -35.28, lng: 149.13 },
  { store: 'Hobart', lat: -42.88, lng: 147.33 },
];

function weatherRows(day: number) {
  // One row per store per day ahead, seven days.
  const rows = [];
  for (const s of STORES)
    for (let d = 0; d < 7; d++) {
      const date = new Date(day + d * DAY).toISOString().slice(0, 10);
      const high = between(17, 33) - (s.store === 'Hobart' ? 6 : 0);
      rows.push({
        store: s.store,
        date,
        temperature_2m_max: high,
        temperature_2m_min: high - between(6, 12),
        precipitation_sum: rand() < 0.6 ? 0 : Number((rand() * 18).toFixed(1)),
        key: `${s.store}:${date}`,
      });
    }
  return rows;
}

const HN_TOPICS = [
  'an open-source vector database',
  'a local-first AI notebook',
  'an LLM eval harness',
  'a voice agent kit',
  'an AI code reviewer',
  'a tiny inference server',
  'a prompt diff tool',
  'a RAG starter in Go',
  'an AI meeting summariser',
  'a model routing proxy',
  'an agent sandbox',
  'an AI SQL assistant',
];

function hnPost(id: number, at: number) {
  const title = `Show HN: I built ${pick(HN_TOPICS)}`;
  return {
    objectID: String(id),
    title,
    url: `https://${pick(['github.com', 'news.example.dev', 'blog.example.io'])}/${slug(title).slice(0, 24)}`,
    author: pick(['pg', 'dang', 'tptacek', 'patio11', 'simonw', 'jacquesm', 'kristianp', 'mooreds']),
    points: between(50, 900),
    num_comments: between(4, 320),
    created_at: new Date(at - between(0, 50) * 60_000).toISOString(),
  };
}

const ROLES = [
  'Data Analyst',
  'Senior Data Engineer',
  'Analytics Engineer',
  'Data Scientist',
  'BI Developer',
  'Lead Data Analyst',
];

function job(id: number) {
  return {
    id,
    title: pick(ROLES),
    company_name: `${pick(WORDS_A)} ${pick(WORDS_B)}`,
    location: `${pick(CITIES)}, Australia`,
    employment_type: 'Full-time',
    salary: `${between(95, 190)}k`,
    date_posted: new Date(now() - between(0, 7) * DAY).toISOString().slice(0, 10),
  };
}

const CAFES = [
  'Single O',
  'Reuben Hills',
  'Paramount Coffee Project',
  'Edition Coffee Roasters',
  'Bourke Street Bakery',
  'Artificer',
  'Room Ten',
  'The Grounds',
  'Mecca',
  'Toby’s Estate',
];

function cafe(i: number) {
  const name =
    i < CAFES.length
      ? CAFES[i]
      : `${pick(['Little', 'Corner', 'Laneway', 'Morning', 'Daily'])} ${pick(['Brew', 'Beans', 'Roast', 'Grind', 'Cup'])} ${i}`;
  return {
    id: `ChIJ${slug(name).slice(0, 10)}${i}`,
    displayName: { text: name, languageCode: 'en' },
    formattedAddress: `${between(1, 400)} ${pick(['Crown', 'Bourke', 'Riley', 'Foveaux', 'Oxford'])} St, Surry Hills NSW 2010`,
    rating: Number((3.9 + rand() * 1).toFixed(1)),
    userRatingCount: between(40, 2400),
  };
}

// ---------- Writing ----------

type Ctx = ReturnType<typeof ctxFor>;

async function ensureProject(
  ctx: Ctx,
  name: string,
  monogram: string,
  spec: unknown,
  brief: string,
  creditLimit: number,
) {
  const existing = (await projects.list(ctx)).find((p) => p.name === name);
  if (existing) return projects.get(ctx, existing.id);
  const checked = checkSpec(spec);
  if (!checked.ok) throw new Error(`${name}: ${checked.problems.map((p) => `${p.path} ${p.message}`).join('; ')}`);
  const project = await projects.create(ctx, {
    name,
    apiName: checked.spec.api.name,
    apiSlug: checked.spec.api.slug,
    monogram,
    docsUrl: checked.spec.api.docsUrl,
    brief,
    setupVia: 'builtin',
    creditLimit,
  });
  return projects.saveSpec(ctx, project.id, checked.spec, { author: 'ai', note: 'Seed: worked example' });
}

function requestLog(
  spec: ApiSpec,
  endpointId: string,
  at: number,
  records: number,
  status = 200,
  error: string | null = null,
) {
  const endpoint = spec.endpoints.find((e) => e.id === endpointId)!;
  return {
    endpointId,
    method: endpoint.method,
    url: `${spec.api.baseUrl}${endpoint.path.replace(/\{[^}]+\}/, String(81244310 + records))}`,
    headers: spec.api.auth.type === 'header' ? { [spec.api.auth.name.toLowerCase()]: '••••7Qk1' } : {},
    body: endpoint.method === 'POST' ? '{}' : null,
    status,
    ms: between(180, 900),
    bytes: between(800, 40_000),
    records,
    retries: 0,
    error,
    at,
  };
}

type RunPlan = {
  at: number;
  records: unknown[];
  newRows: number;
  skipped?: number;
  status?: 'ok' | 'failed' | 'partial' | 'stopped';
  error?: { code: string; text: string } | null;
  retries?: number;
  credits?: number;
  matches?: number | null;
  calls?: number;
  trigger?: 'manual' | 'schedule';
  keys?: (string | null)[];
};

async function seedDataset(
  ctx: Ctx,
  project: { id: string; spec: ApiSpec | null },
  input: {
    name: string;
    saveMode: 'append' | 'replace' | 'keep';
    keyPath: string | null;
    keyLabel: string | null;
    values: Values;
    runs: RunPlan[];
    scheduleId?: string | null;
    presetId?: string | null;
  },
) {
  const spec = project.spec!;
  const datasetId = newId();
  const first = input.runs[0]?.at ?? now();
  await db
    .insertInto('datasets')
    .values({
      id: datasetId,
      user_id: ctx.user.id,
      project_id: project.id,
      name: input.name,
      save_mode: input.saveMode,
      key_path: input.keyPath,
      key_label: input.keyLabel,
      columns: '[]',
      rows: 0,
      bytes: 0,
      runs: 0,
      repeats_skipped: 0,
      csv_token: null,
      csv_token_at: null,
      created_at: first,
      updated_at: first,
    })
    .execute();

  let repeats = 0;
  let last: string | null = null;
  const sampleForColumns: unknown[] = [];
  const searchFirst = spec.run.mode === 'searchThenCollect';

  for (const plan of input.runs) {
    const runId = newId();
    last = runId;
    const status = plan.status ?? 'ok';
    const calls = plan.calls ?? (searchFirst ? 1 + plan.records.length : 1);
    const run = spec.run;
    const stepOf = (i: number) =>
      run.mode === 'searchThenCollect' ? (i === 0 ? run.searchId : run.collectId) : run.endpointId;
    const logs = Array.from({ length: Math.max(1, calls) }, (_, i) =>
      requestLog(
        spec,
        stepOf(i),
        plan.at + i * 400,
        searchFirst ? (i === 0 ? plan.records.length + (plan.skipped ?? 0) : 1) : plan.records.length,
        status === 'failed' ? 0 : 200,
        status === 'failed' ? (plan.error?.text ?? null) : null,
      ),
    );
    if (plan.retries) logs[0].retries = plan.retries;
    await db
      .insertInto('runs')
      .values({
        id: runId,
        project_id: project.id,
        user_id: ctx.user.id,
        trigger: plan.trigger ?? (input.scheduleId ? 'schedule' : 'manual'),
        preset_id: input.presetId ?? null,
        schedule_id: plan.trigger === 'manual' ? null : (input.scheduleId ?? null),
        values: json(input.values) ?? '{}',
        status,
        matches: plan.matches ?? null,
        rows: plan.records.length,
        credits: plan.credits ?? 0,
        http_status: status === 'failed' ? null : 200,
        error_code: plan.error?.code ?? null,
        error_text: plan.error?.text ?? null,
        retries: plan.retries ?? 0,
        requests: json(logs) ?? '[]',
        sample: json(plan.records.slice(0, 50)),
        dataset_id: status === 'failed' ? null : datasetId,
        new_rows: plan.newRows,
        started_at: plan.at,
        finished_at: plan.at + between(800, 9000),
        created_at: plan.at,
      })
      .execute();
    if (status === 'failed') continue;
    repeats += plan.skipped ?? 0;
    const rows = plan.records.map((record, i) => ({
      dataset_id: datasetId,
      run_id: runId,
      row_key: plan.keys ? plan.keys[i] : null,
      data: json(record) ?? 'null',
      created_at: plan.at,
    }));
    for (let i = 0; i < rows.length; i += 200)
      await db
        .insertInto('dataset_rows')
        .values(rows.slice(i, i + 200))
        .execute();
    if (sampleForColumns.length < 300) sampleForColumns.push(...plan.records.slice(0, 50));
  }
  const totals = await recount(datasetId);
  const saved = input.runs.filter((r) => r.status !== 'failed');
  await db
    .updateTable('datasets')
    .set({
      rows: totals.rows,
      bytes: totals.bytes,
      runs: saved.length,
      repeats_skipped: repeats,
      columns: json(columnsOf(sampleForColumns.map((r) => flattenRecord(r)))) ?? '[]',
      updated_at: saved[saved.length - 1]?.at ?? first,
    })
    .where('id', '=', datasetId)
    .execute();
  return { datasetId, lastRunId: last, rows: totals.rows };
}

async function preset(projectId: string, name: string, values: Values, at: number) {
  const id = newId();
  await db
    .insertInto('presets')
    .values({ id, project_id: projectId, name, values: json(values) ?? '{}', created_at: at, updated_at: at })
    .execute();
  return id;
}

async function schedule(
  ctx: Ctx,
  input: {
    projectId: string;
    name: string;
    cadence: 'hourly' | 'daily' | 'weekly' | 'monthly';
    days?: number[];
    dayOfMonth?: number | null;
    time: string;
    creditLimit: number;
    values: Values;
    presetId?: string | null;
    status?: 'on' | 'paused';
    pausedAt?: number | null;
    emailCsv?: boolean;
  },
) {
  const id = newId();
  const timing = {
    cadence: input.cadence,
    days: input.days ?? [],
    dayOfMonth: input.dayOfMonth ?? null,
    time: input.time,
    timezone: ZONE,
  };
  const at = now();
  await db
    .insertInto('schedules')
    .values({
      id,
      user_id: ctx.user.id,
      project_id: input.projectId,
      preset_id: input.presetId ?? null,
      values: json(input.values) ?? '{}',
      dataset_id: null,
      name: input.name,
      cadence: input.cadence,
      days: json(timing.days) ?? '[]',
      day_of_month: timing.dayOfMonth,
      time: input.time,
      timezone: ZONE,
      credit_limit: input.creditLimit,
      email_on_fail: true,
      email_csv: input.emailCsv ?? false,
      status: input.status ?? 'on',
      paused_at: input.pausedAt ?? null,
      next_run_at: input.status === 'paused' ? null : nextRunAfter(timing, at),
      locked_until: null,
      last_run_id: null,
      created_at: at - 60 * DAY,
      updated_at: at,
    })
    .execute();
  return { id, timing };
}

/** The scheduled times before now, newest last. */
function pastRuns(timing: Parameters<typeof nextRuns>[0], count: number, step: number): number[] {
  const from = now() - step * (count + 2);
  return nextRuns(timing, from, count + 4)
    .filter((t) => t < now())
    .slice(-count);
}

async function main() {
  assertLocalDatabase();
  await migrate(undefined, () => {});
  const user = await db.selectFrom('users').selectAll().where('email', '=', 'nadia@dialed.test').executeTakeFirst();
  if (!user) throw new Error('Run npm run db:seed first: nadia@dialed.test is missing.');
  const ctx = ctxFor(user);

  // Start clean: nadia's runs, rows, datasets, schedules and presets.
  const mine = (await db.selectFrom('projects').select('id').where('user_id', '=', user.id).execute()).map((p) => p.id);
  await db
    .updateTable('schedules')
    .set({ dataset_id: null, last_run_id: null })
    .where('user_id', '=', user.id)
    .execute();
  await db.deleteFrom('schedules').where('user_id', '=', user.id).execute();
  const datasetIds = (await db.selectFrom('datasets').select('id').where('user_id', '=', user.id).execute()).map(
    (d) => d.id,
  );
  if (datasetIds.length) await db.deleteFrom('dataset_rows').where('dataset_id', 'in', datasetIds).execute();
  await db.deleteFrom('runs').where('user_id', '=', user.id).execute();
  await db.deleteFrom('datasets').where('user_id', '=', user.id).execute();
  if (mine.length) await db.deleteFrom('presets').where('project_id', 'in', mine).execute();

  const all = await projects.list(ctx);
  const byName = async (name: string) => {
    const found = all.find((p) => p.name === name);
    if (!found) throw new Error(`Project "${name}" is missing: run npm run db:seed first.`);
    return projects.get(ctx, found.id);
  };
  const cs = await byName('AU software companies');
  const om = await byName('Store weather');
  const hn = await byName('AI launch posts');
  const jobs = await ensureProject(
    ctx,
    'Hiring: data roles',
    'CS',
    JOBS_SPEC,
    'Data analyst and engineer roles posted in Australia this week.',
    1000,
  );
  const places = await ensureProject(
    ctx,
    'Cafés near the office',
    'GP',
    PLACES_SPEC,
    'Cafés within 1.5 km of the Surry Hills office, rated 4 or more.',
    100,
  );

  // A demo CoreSignal key, so the CoreSignal screens read as they do on the canvas. It isn't a real key:
  // replace it in Settings to run CoreSignal for real.
  const host = 'api.coresignal.com';
  let key = await db
    .selectFrom('api_keys')
    .select('id')
    .where('user_id', '=', user.id)
    .where('host', '=', host)
    .executeTakeFirst();
  if (!key) {
    const id = newId();
    await db
      .insertInto('api_keys')
      .values({
        id,
        user_id: user.id,
        api_slug: 'coresignal',
        api_name: 'CoreSignal',
        host,
        label: 'Demo key, replace it',
        secret: seal('cs-demo-not-a-real-key-7Qk1'),
        last4: '7Qk1',
        credits_left: 11_480,
        credits_checked_at: now(),
        last_test_at: null,
        last_test_ok: null,
        created_at: now(),
        updated_at: now(),
      })
      .execute();
    key = { id };
  }
  await db.updateTable('projects').set({ api_key_id: key.id }).where('id', 'in', [cs.id, jobs.id]).execute();

  // ---------- AU software companies: weekly, 8 runs, 234 rows, 96 repeats ----------
  const seriesA: Values = {
    industry: ['Software Development', 'Computer Software'],
    country: ['Australia'],
    employees: { min: 50, max: 200 },
    take: 25,
  };
  const seriesAId = await preset(cs.id, 'Series A, 50 to 200 staff', seriesA, now() - 50 * DAY);
  const melbourne: Values = {
    industry: ['Software Development'],
    keywords: ['fintech', 'payments'],
    country: ['Australia'],
    employees: { min: 1, max: 50 },
    take: 40,
  };
  const melbourneId = await preset(cs.id, 'Melbourne fintech', melbourne, now() - 14 * DAY);
  await preset(
    cs.id,
    'All AU software, any size',
    { country: ['Australia'], employees: {}, take: 50 },
    now() - 19 * DAY,
  );

  const weekly = await schedule(ctx, {
    projectId: cs.id,
    name: 'Weekly: AU software companies',
    cadence: 'weekly',
    days: [1],
    time: '09:00',
    creditLimit: 600,
    values: seriesA,
    presetId: seriesAId,
  });
  const newPerRun = [38, 25, 31, 28, 30, 27, 30, 25];
  const repeatsPerRun = [0, 13, 9, 14, 12, 15, 13, 20];
  let nextCompany = 81_244_310;
  const weeklyTimes = pastRuns(weekly.timing, 8, 7 * DAY);
  const csRuns: RunPlan[] = weeklyTimes.map((at, i) => {
    const records = Array.from({ length: newPerRun[i] }, () => company(nextCompany++));
    return {
      at,
      records,
      keys: records.map((r) => String(r.id)),
      newRows: newPerRun[i],
      skipped: repeatsPerRun[i],
      credits: newPerRun[i] * 20,
      matches: 3412 - (7 - i) * 9,
      retries: i === 5 ? 1 : 0,
      error: i === 5 ? { code: 'rate_limited', text: 'Rate limited, retried after 2 s' } : null,
    };
  });
  const auSoftware = await seedDataset(ctx, cs, {
    name: 'AU software, 50 to 200 staff',
    saveMode: 'append',
    keyPath: 'id',
    keyLabel: 'company_id',
    values: seriesA,
    runs: csRuns,
    scheduleId: weekly.id,
    presetId: seriesAId,
  });
  await db
    .updateTable('schedules')
    .set({ dataset_id: auSoftware.datasetId, last_run_id: auSoftware.lastRunId })
    .where('id', '=', weekly.id)
    .execute();

  // Seed fintech, Melbourne: one run by hand on 3 Nov, 38 rows; the paused monthly schedule points at it.
  const monthly = await schedule(ctx, {
    projectId: cs.id,
    name: 'Monthly: Melbourne fintech',
    cadence: 'monthly',
    dayOfMonth: 1,
    time: '08:00',
    creditLimit: 800,
    values: melbourne,
    presetId: melbourneId,
    status: 'paused',
    pausedAt: now() - 3 * DAY,
  });
  const fintechRecords = Array.from({ length: 38 }, () => ({
    ...company(nextCompany++),
    industry: 'Software Development',
    hq: { city: 'Melbourne', country: 'Australia' },
  }));
  const fintech = await seedDataset(ctx, cs, {
    name: 'Seed fintech, Melbourne',
    saveMode: 'append',
    keyPath: 'id',
    keyLabel: 'company_id',
    values: melbourne,
    runs: [
      {
        at: now() - 14 * DAY,
        records: fintechRecords,
        keys: fintechRecords.map((r) => String(r.id)),
        newRows: 38,
        credits: 760,
        matches: 212,
        trigger: 'manual',
      },
    ],
    presetId: melbourneId,
  });
  await db
    .updateTable('schedules')
    .set({ dataset_id: fintech.datasetId, last_run_id: fintech.lastRunId })
    .where('id', '=', monthly.id)
    .execute();

  // ---------- Store weather: daily 06:00, 2,170 rows ----------
  const storeValues: Values = {
    latitudes: STORES.map((s) => String(s.lat)),
    longitudes: STORES.map((s) => String(s.lng)),
    days: 7,
    daily: ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum'],
    units: 'celsius',
  };
  const daily = await schedule(ctx, {
    projectId: om.id,
    name: 'Daily: store weather',
    cadence: 'daily',
    time: '06:00',
    creditLimit: 0,
    values: storeValues,
  });
  const dailyTimes = pastRuns(daily.timing, 45, DAY);
  const weatherRuns: RunPlan[] = dailyTimes.map((at, i) => {
    const records = weatherRows(at).slice(0, i === 0 ? 14 : 49);
    return {
      at,
      records: records.map((r) => ({
        store: r.store,
        date: r.date,
        temperature_2m_max: r.temperature_2m_max,
        temperature_2m_min: r.temperature_2m_min,
        precipitation_sum: r.precipitation_sum,
      })),
      newRows: records.length,
      calls: 1,
    };
  });
  const weather = await seedDataset(ctx, om, {
    name: 'Store weather, next 7 days',
    saveMode: 'keep',
    keyPath: null,
    keyLabel: null,
    values: storeValues,
    runs: weatherRuns,
    scheduleId: daily.id,
  });
  await db
    .updateTable('schedules')
    .set({ dataset_id: weather.datasetId, last_run_id: weather.lastRunId })
    .where('id', '=', daily.id)
    .execute();

  // ---------- AI launch posts: hourly, 3,904 rows, the last run timed out ----------
  const hnValues: Values = { query: 'AI launch', type: 'show_hn', points: 50, take: 50 };
  const hourly = await schedule(ctx, {
    projectId: hn.id,
    name: 'Hourly: AI launch posts',
    cadence: 'hourly',
    time: '00:00',
    creditLimit: 0,
    values: hnValues,
  });
  const hourlyTimes = pastRuns(hourly.timing, 160, 60 * 60 * 1000);
  let post = 38_810_000;
  // 3,904 rows over the hourly runs before the last one, which timed out.
  const saves = hourlyTimes.length - 1;
  const counts = Array.from({ length: saves }, () => between(18, 30));
  let spread = counts.reduce((a, b) => a + b, 0);
  for (let i = 0; spread !== 3904; i = (i + 1) % saves) {
    if (spread > 3904 && counts[i] > 1) {
      counts[i]--;
      spread--;
    } else if (spread < 3904) {
      counts[i]++;
      spread++;
    }
  }
  const hnRuns: RunPlan[] = hourlyTimes.map((at, i): RunPlan => {
    if (i === hourlyTimes.length - 1)
      return {
        at,
        records: [],
        newRows: 0,
        status: 'failed',
        error: { code: 'timeout', text: 'The API took too long.' },
        retries: 1,
      };
    const records = Array.from({ length: counts[i] }, () => hnPost(post++, at));
    return { at, records, keys: records.map((r) => r.objectID), newRows: records.length, matches: 1284, calls: 1 };
  });
  const hnData = await seedDataset(ctx, hn, {
    name: 'AI launch posts',
    saveMode: 'append',
    keyPath: 'objectID',
    keyLabel: 'objectID',
    values: hnValues,
    runs: hnRuns,
    scheduleId: hourly.id,
  });
  await db
    .updateTable('schedules')
    .set({ dataset_id: hnData.datasetId, last_run_id: hnData.lastRunId })
    .where('id', '=', hourly.id)
    .execute();

  // ---------- Hiring: data roles: daily 07:30, 412 rows ----------
  const jobValues: Values = {
    title: ['data analyst', 'data engineer'],
    type: 'Full-time',
    country: ['Australia'],
    days: 7,
    active: true,
    take: 20,
  };
  const jobDaily = await schedule(ctx, {
    projectId: jobs.id,
    name: 'Daily: data roles hiring',
    cadence: 'daily',
    time: '07:30',
    creditLimit: 40,
    values: jobValues,
  });
  const jobTimes = pastRuns(jobDaily.timing, 23, DAY);
  let jobId = 912_300_000;
  let jobsLeft = 412;
  const jobRuns: RunPlan[] = jobTimes.map((at, i) => {
    const n = i === jobTimes.length - 1 ? 18 : i === jobTimes.length - 2 ? jobsLeft - 18 : Math.min(jobsLeft - 18, 18);
    jobsLeft -= n;
    const records = Array.from({ length: n }, () => job(jobId++));
    const last = i === jobTimes.length - 1;
    return {
      at,
      records,
      keys: records.map((r) => String(r.id)),
      newRows: n,
      skipped: between(0, 4),
      credits: n,
      matches: 640,
      retries: last ? 1 : 0,
      error: last ? { code: 'rate_limited', text: 'Rate limited, retried after 2 s' } : null,
    };
  });
  const jobData = await seedDataset(ctx, jobs, {
    name: 'Data roles, Australia',
    saveMode: 'append',
    keyPath: 'id',
    keyLabel: 'job_id',
    values: jobValues,
    runs: jobRuns,
    scheduleId: jobDaily.id,
  });
  await db
    .updateTable('schedules')
    .set({ dataset_id: jobData.datasetId, last_run_id: jobData.lastRunId })
    .where('id', '=', jobDaily.id)
    .execute();

  // ---------- Cafés near the office: 60 rows, three runs by hand ----------
  const placeValues: Values = {
    type: ['cafe'],
    rank: 'POPULARITY',
    near: { lat: -33.8853, lng: 151.2108, radius: 1500 },
    take: 20,
  };
  let cafeIndex = 0;
  const cafeRuns: RunPlan[] = [now() - 9 * DAY, now() - 7 * DAY, now() - 5 * DAY].map((at) => {
    const records = Array.from({ length: 20 }, () => cafe(cafeIndex++));
    return { at, records, keys: records.map((r) => r.id), newRows: 20, credits: 1, trigger: 'manual' };
  });
  await seedDataset(ctx, places, {
    name: 'Cafés within 1.5 km',
    saveMode: 'append',
    keyPath: 'id',
    keyLabel: 'place id',
    values: placeValues,
    runs: cafeRuns,
  });

  const totals = await db
    .selectFrom('datasets')
    .select((eb) => [eb.fn.countAll<number>().as('n'), eb.fn.sum<number>('rows').as('rows')])
    .where('user_id', '=', user.id)
    .executeTakeFirst();
  console.log(
    `[seed-data] ${totals?.n} datasets, ${Number(totals?.rows ?? 0).toLocaleString('en-US')} rows, on ${dialect}`,
  );
  console.log(
    `[seed-data] AU software: ${auSoftware.rows} rows over ${csRuns.length} runs, ${repeatsPerRun.reduce((a, b) => a + b, 0)} repeats skipped`,
  );
}

main()
  .catch((error) => {
    console.error('[seed-data] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
