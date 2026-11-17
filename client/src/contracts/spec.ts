import { z } from 'zod';
import { problemsOf, type Problem } from './common';

/**
 * The API spec: one validated JSON document per project (common.md › The spec). Chat A's AI writes it, and
 * chat B builds requests and draws controls from it. The messages are plain on purpose: an AI reads them and
 * fixes the spec.
 *
 * How a control's value reaches the request (the request builder follows these):
 * 1. An empty value (null, "", [], {}) leaves the parameter out.
 * 2. `format` shapes it: comma joins a list into "a,b"; array keeps the list; iso-date gives YYYY-MM-DD;
 *    unix gives seconds since 1970; year gives the four-digit year.
 * 3. `template` (optional, added by chat F) wraps it: in a string, "{value}" is replaced by the value
 *    ("points>={value}"); in a JSON template, a string that is exactly "{value}", "{min}", "{max}", "{lat}",
 *    "{lng}" or "{radius}" becomes that part of the value with its type kept. Object entries left unfilled
 *    (a range with only a min) are dropped.
 * 4. `key` says where it goes: a parameter name for query, header and path; a dot path for body
 *    ("filters.country"). A body key ending in "[]" appends to that array ("query.bool.filter[]"), which is
 *    how Elasticsearch-style APIs take one clause per control.
 * 5. Two query controls with the same key join their parts with commas (numericFilters=points>=100,created_at_i>1700000000).
 * 6. pagination.cursorPath is a dot path into the body ("$.next"), or "header:<name>" for a cursor the API
 *    sends in a response header ("header:x-next-page-after"). total works the same way through `from`.
 */

export const SPEC_LIMITS = { endpoints: 20, channels: 8, controls: 40, options: 200, notes: 20 } as const;

export const CONTROL_KINDS = [
  'text',
  'keywords',
  'choice',
  'multi',
  'toggle',
  'range',
  'logRange',
  'dial',
  'date',
  'amount',
  'places',
  'mapRadius',
] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

const slug = (what: string) =>
  z
    .string({ error: `Give the ${what} an id.` })
    .regex(
      /^[a-z0-9][a-z0-9_-]{0,47}$/,
      `A ${what} id is a short slug: lowercase letters, digits, "-" or "_", up to 48 characters, like "company-search".`,
    );

const text = (what: string, max = 200) =>
  z
    .string({ error: `Give the ${what}.` })
    .trim()
    .min(1, `The ${what} can't be empty.`)
    .max(max, `Keep the ${what} under ${max} characters.`);

// ---------- Values ----------

export const MinMaxSchema = z
  .object({
    min: z.union([z.number(), z.string()]).optional(),
    max: z.union([z.number(), z.string()]).optional(),
  })
  .strict();
export const PointRadiusSchema = z.object({ lat: z.number(), lng: z.number(), radius: z.number() }).strict();

/** A control's value: what the person dialled in. */
export const ValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
  PointRadiusSchema,
  MinMaxSchema,
]);
export type Value =
  | string
  | number
  | boolean
  | string[]
  | null
  | { min?: number | string; max?: number | string }
  | { lat: number; lng: number; radius: number };
/** Values by control id. */
export type Values = Record<string, Value>;
export const ValuesSchema = z.record(z.string(), ValueSchema);

// ---------- Auth ----------

export const AuthSchema = z.discriminatedUnion(
  'type',
  [
    z.object({ type: z.literal('none') }).strict(),
    z
      .object({ type: z.literal('header'), name: text('header name', 80), prefix: z.string().max(40).optional() })
      .strict(),
    z.object({ type: z.literal('query'), name: text('query parameter name', 80) }).strict(),
    z.object({ type: z.literal('bearer') }).strict(),
    z.object({ type: z.literal('basic') }).strict(),
  ],
  { error: 'auth.type must be one of: none, header, query, bearer, basic.' },
);
export type Auth = z.infer<typeof AuthSchema>;

// ---------- Endpoints ----------

export const PaginationSchema = z
  .object({
    type: z.enum(['none', 'page', 'offset', 'cursor', 'link'], {
      error: 'pagination.type must be one of: none, page, offset, cursor, link.',
    }),
    param: z.string().max(80).optional(),
    sizeParam: z.string().max(80).optional(),
    size: z.number().int().positive('pagination.size must be a positive whole number.').max(1000).optional(),
    cursorPath: z.string().max(200).optional(),
    maxPages: z
      .number({ error: 'pagination.maxPages is required: the most pages one run may fetch.' })
      .int()
      .min(1, 'pagination.maxPages must be at least 1.')
      .max(100, 'pagination.maxPages can be at most 100.'),
  })
  .strict();

export const CostSchema = z
  .object({
    perCall: z.number({ error: 'cost.perCall is required (0 when calls are free).' }).min(0),
    perRecord: z.number({ error: 'cost.perRecord is required (0 when records are free).' }).min(0),
    unit: text('cost unit, like "credits"', 40),
  })
  .strict();

const fixedSchema = z
  .object({
    query: z.record(z.string(), z.unknown()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const dotPath = (what: string) =>
  z
    .string({ error: `Give the ${what} as a dot path, like "$.hits".` })
    .regex(/^\$(\.[A-Za-z0-9_\-[\]*]+)*$/, `The ${what} is a dot path that starts with "$", like "$" or "$.hits".`);

export const EndpointSchema = z
  .object({
    id: slug('endpoint'),
    label: text('endpoint label', 80),
    description: text('endpoint description', 500),
    method: z.enum(['GET', 'POST'], { error: 'method must be GET or POST.' }),
    path: z
      .string({ error: 'Give the endpoint path, like "/v1/search".' })
      .regex(/^\/\S*$/, 'path starts with "/" and has no spaces. Mark path parameters as {name}.'),
    body: z.enum(['json', 'form']).optional(),
    fixed: fixedSchema.optional(),
    records: dotPath('records path'),
    total: z
      .object({ from: z.enum(['body', 'header']), path: z.string().min(1) })
      .strict()
      .optional(),
    idPath: z.string().min(1).max(200).optional(),
    pagination: PaginationSchema.optional(),
    cost: CostSchema,
    free: z.boolean({ error: 'free is required: true when the endpoint is safe for test calls and live counts.' }),
  })
  .strict();
export type Endpoint = z.infer<typeof EndpointSchema>;

// ---------- Controls and channels ----------

const keySchema = z.union([
  z.string().min(1, 'key is the request field the control sets.').max(200),
  z.object({ min: z.string().min(1), max: z.string().min(1) }).strict(),
  z.object({ lat: z.string().min(1), lng: z.string().min(1), radius: z.string().min(1) }).strict(),
]);

export const ControlSchema = z
  .object({
    id: slug('control'),
    label: text('control label', 60),
    help: z.string().max(300).optional(),
    param: text('raw parameter name', 120),
    endpointId: slug('endpoint'),
    in: z.enum(['query', 'body', 'path', 'header'], { error: 'in must be one of: query, body, path, header.' }),
    key: keySchema,
    kind: z.enum(CONTROL_KINDS, { error: `kind must be one of: ${CONTROL_KINDS.join(', ')}.` }),
    options: z
      .array(z.object({ value: z.string().min(1).max(200), label: z.string().min(1).max(120) }).strict())
      .max(SPEC_LIMITS.options, `A control can list at most ${SPEC_LIMITS.options} options.`)
      .optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    unit: z.string().max(30).optional(),
    range: z.boolean().optional(),
    format: z.enum(['comma', 'array', 'iso-date', 'unix', 'year']).optional(),
    template: z
      .union([z.string().min(1).max(500), z.record(z.string(), z.unknown())])
      .optional()
      .refine(
        (t) => t === undefined || JSON.stringify(t).includes('{'),
        'A template needs a placeholder like "{value}".',
      ),
    default: ValueSchema.optional(),
    required: z.boolean().optional(),
    by: z.enum(['ai', 'user'], { error: 'by must be "ai" or "user".' }),
  })
  .strict();
export type Control = z.infer<typeof ControlSchema>;

export const ChannelSchema = z
  .object({
    id: slug('channel'),
    title: text('channel title', 60),
    hint: z.string().max(200).optional(),
    controls: z.array(ControlSchema).min(1, 'Every channel needs at least one control.'),
  })
  .strict();
export type Channel = z.infer<typeof ChannelSchema>;

export const NoteSchema = z
  .object({
    kind: z.enum(['limit', 'cost', 'tip'], { error: 'A note kind is limit, cost or tip.' }),
    text: text('note text', 400),
  })
  .strict();
export type Note = z.infer<typeof NoteSchema>;

export const RunPlanSchema = z.discriminatedUnion(
  'mode',
  [
    z
      .object({ mode: z.literal('single'), endpointId: slug('endpoint'), takeControlId: slug('control').optional() })
      .strict(),
    z
      .object({
        mode: z.literal('searchThenCollect'),
        searchId: slug('endpoint'),
        collectId: slug('endpoint'),
        idParam: text('id parameter name', 80),
        takeControlId: slug('control'),
      })
      .strict(),
  ],
  { error: 'run.mode must be "single" or "searchThenCollect".' },
);
export type RunPlan = z.infer<typeof RunPlanSchema>;

const CreditsSchema = z
  .object({
    from: z.enum(['header', 'endpoint']),
    name: text('credits header or field name', 120),
    endpointId: slug('endpoint').optional(),
    path: z.string().max(200).optional(),
  })
  .strict();

const ApiSchema = z
  .object({
    name: text('API name', 80),
    slug: slug('API'),
    baseUrl: z
      .string({ error: 'Give the API base URL, like "https://api.example.com".' })
      .regex(
        /^https:\/\/[^\s/?#]+[^\s?#]*$/,
        'baseUrl must be a full https:// URL with no query, like "https://api.example.com/v2".',
      )
      .refine((v) => !v.endsWith('/'), 'baseUrl has no trailing "/": endpoint paths start with one.'),
    docsUrl: z
      .string({ error: 'Give the docs URL.' })
      .refine((v) => /^https?:\/\//.test(v) && URL.canParse(v), 'docsUrl must be a full URL.'),
    auth: AuthSchema,
    credits: CreditsSchema.optional(),
  })
  .strict();

const BaseSpecSchema = z
  .object({
    version: z.literal(1, { error: 'version must be 1.' }),
    api: ApiSchema,
    endpoints: z
      .array(EndpointSchema)
      .min(1, 'Add at least one endpoint.')
      .max(SPEC_LIMITS.endpoints, `Keep it to ${SPEC_LIMITS.endpoints} endpoints or fewer.`),
    channels: z
      .array(ChannelSchema)
      .min(1, 'Add at least one channel.')
      .max(SPEC_LIMITS.channels, `Keep it to ${SPEC_LIMITS.channels} channels or fewer.`),
    notes: z.array(NoteSchema).max(SPEC_LIMITS.notes, `Keep it to ${SPEC_LIMITS.notes} notes or fewer.`),
    run: RunPlanSchema,
  })
  .strict();

// ---------- Cross-checks ----------

type Ctx = z.RefinementCtx;
type BaseSpec = z.infer<typeof BaseSpecSchema>;

const list = (ids: string[]) => (ids.length ? ids.map((id) => `"${id}"`).join(', ') : 'none yet');

function duplicates(ids: string[]) {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const id of ids) (seen.has(id) ? twice : seen).add(id);
  return [...twice];
}

/** The shape of a value each kind takes; checks a default or a person's value. Returns a problem or null. */
export function valueProblem(control: Control, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const allowed = new Set((control.options ?? []).map((o) => o.value));
  const isMinMax = (v: unknown): v is { min?: unknown; max?: unknown } =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && !('lat' in v);
  const inBounds = (n: unknown) =>
    typeof n !== 'number' ||
    ((control.min === undefined || n >= control.min) && (control.max === undefined || n <= control.max));
  switch (control.kind) {
    case 'text':
      return typeof value === 'string' ? null : `"${control.id}" is a text control: its value is a string.`;
    case 'keywords':
    case 'places':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? null
        : `"${control.id}" takes a list of strings, like ["fintech", "payments"].`;
    case 'choice':
      if (typeof value !== 'string') return `"${control.id}" is a choice: its value is one option value.`;
      return allowed.has(value) ? null : `"${control.id}" has no option "${value}". Use one of: ${list([...allowed])}.`;
    case 'multi': {
      if (!Array.isArray(value)) return `"${control.id}" is a multi-select: its value is a list of option values.`;
      const unknown = value.filter((v) => typeof v !== 'string' || !allowed.has(v));
      return unknown.length ? `"${control.id}" has no option ${list(unknown.map(String))}.` : null;
    }
    case 'toggle':
      return typeof value === 'boolean' ? null : `"${control.id}" is a toggle: its value is true or false.`;
    case 'range':
    case 'logRange':
      if (!isMinMax(value)) return `"${control.id}" is a range: its value is { "min": number, "max": number }.`;
      if (!inBounds(value.min) || !inBounds(value.max))
        return `"${control.id}" must stay between ${control.min} and ${control.max}.`;
      if (typeof value.min === 'number' && typeof value.max === 'number' && value.min > value.max)
        return `"${control.id}" has min above max.`;
      return null;
    case 'dial':
    case 'amount':
      if (typeof value !== 'number') return `"${control.id}" takes a number.`;
      return inBounds(value) ? null : `"${control.id}" must stay between ${control.min} and ${control.max}.`;
    case 'date': {
      const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
      if (control.range) {
        if (!isMinMax(value))
          return `"${control.id}" is a date range: its value is { "min": "YYYY-MM-DD", "max": "YYYY-MM-DD" }.`;
        return (value.min === undefined || isDate(value.min)) && (value.max === undefined || isDate(value.max))
          ? null
          : `"${control.id}" dates are written YYYY-MM-DD.`;
      }
      return isDate(value) ? null : `"${control.id}" is a date: write it as "YYYY-MM-DD".`;
    }
    case 'mapRadius':
      return typeof value === 'object' && value !== null && 'lat' in value && 'lng' in value && 'radius' in value
        ? null
        : `"${control.id}" is a map radius: its value is { "lat": number, "lng": number, "radius": number }.`;
  }
}

function checkControl(spec: BaseSpec, control: Control, path: (string | number)[], ctx: Ctx) {
  const at = (key: string) => [...path, key];
  const endpoint = spec.endpoints.find((e) => e.id === control.endpointId);
  if (!endpoint)
    ctx.addIssue({
      code: 'custom',
      path: at('endpointId'),
      message: `Control "${control.id}" points at endpoint "${control.endpointId}", which doesn't exist. Use one of: ${list(spec.endpoints.map((e) => e.id))}.`,
    });

  const key = control.key;
  const keyIsMinMax = typeof key === 'object' && 'min' in key;
  const keyIsPoint = typeof key === 'object' && 'lat' in key;
  if (keyIsPoint !== (control.kind === 'mapRadius'))
    ctx.addIssue({
      code: 'custom',
      path: at('key'),
      message:
        control.kind === 'mapRadius'
          ? `Control "${control.id}" is a mapRadius: its key is { "lat": "...", "lng": "...", "radius": "..." }.`
          : `Control "${control.id}": only a mapRadius control has a { lat, lng, radius } key.`,
    });
  const canMinMax =
    control.kind === 'range' || control.kind === 'logRange' || (control.kind === 'date' && control.range);
  if (keyIsMinMax && !canMinMax)
    ctx.addIssue({
      code: 'custom',
      path: at('key'),
      message: `Control "${control.id}": a { min, max } key fits only range, logRange or a date with "range": true.`,
    });

  if (control.in === 'path' && typeof key === 'string' && endpoint && !endpoint.path.includes(`{${key}}`))
    ctx.addIssue({
      code: 'custom',
      path: at('key'),
      message: `Control "${control.id}" sets path parameter "${key}", but endpoint "${endpoint.id}" has no {${key}} in its path "${endpoint.path}".`,
    });
  if (typeof key === 'string' && key.endsWith('[]') && control.in !== 'body')
    ctx.addIssue({
      code: 'custom',
      path: at('key'),
      message: `Control "${control.id}": a key ending in "[]" appends to a body array, so "in" must be "body".`,
    });
  if (control.in === 'body' && endpoint?.method === 'GET')
    ctx.addIssue({
      code: 'custom',
      path: at('in'),
      message: `Control "${control.id}" sets the body, but endpoint "${endpoint.id}" is a GET. Use "query", or make the endpoint a POST.`,
    });

  const options = control.options ?? [];
  if (control.kind === 'choice' && (options.length < 2 || options.length > 8))
    ctx.addIssue({
      code: 'custom',
      path: at('options'),
      message: `Control "${control.id}" is a choice, which shows 2 to 8 options as pills. It has ${options.length}. For a longer list use "multi".`,
    });
  if (control.kind === 'multi' && options.length < 2)
    ctx.addIssue({
      code: 'custom',
      path: at('options'),
      message: `Control "${control.id}" is a multi-select: give it the list of options (at least 2).`,
    });
  if (options.length && control.kind !== 'choice' && control.kind !== 'multi')
    ctx.addIssue({
      code: 'custom',
      path: at('options'),
      message: `Control "${control.id}" is a ${control.kind}: only choice and multi take options.`,
    });
  const dupOptions = duplicates(options.map((o) => o.value));
  if (dupOptions.length)
    ctx.addIssue({
      code: 'custom',
      path: at('options'),
      message: `Control "${control.id}" lists option ${list(dupOptions)} twice.`,
    });

  const needsBounds = control.kind === 'range' || control.kind === 'logRange' || control.kind === 'dial';
  if (needsBounds && (control.min === undefined || control.max === undefined))
    ctx.addIssue({
      code: 'custom',
      path: at('min'),
      message: `Control "${control.id}" is a ${control.kind}: give it "min" and "max" so the scale can be drawn.`,
    });
  if (control.min !== undefined && control.max !== undefined && control.min >= control.max)
    ctx.addIssue({ code: 'custom', path: at('max'), message: `Control "${control.id}" needs "max" above "min".` });
  if (control.kind === 'logRange' && control.min !== undefined && control.min < 0)
    ctx.addIssue({
      code: 'custom',
      path: at('min'),
      message: `Control "${control.id}" is a log range: "min" can't be below 0.`,
    });
  if (control.range !== undefined && control.kind !== 'date')
    ctx.addIssue({
      code: 'custom',
      path: at('range'),
      message: `Control "${control.id}": "range" only applies to a date control.`,
    });

  if (control.default !== undefined) {
    const problem = valueProblem(control, control.default);
    if (problem) ctx.addIssue({ code: 'custom', path: at('default'), message: `Default: ${problem}` });
  }
}

function crossCheck(spec: BaseSpec, ctx: Ctx) {
  const endpointIds = spec.endpoints.map((e) => e.id);
  const controls = spec.channels.flatMap((c) => c.controls);
  const controlIds = controls.map((c) => c.id);

  for (const [group, ids] of [
    ['endpoint', endpointIds],
    ['channel', spec.channels.map((c) => c.id)],
    ['control', controlIds],
  ] as const)
    for (const id of duplicates([...ids]))
      ctx.addIssue({
        code: 'custom',
        path: [`${group}s`],
        message: `Two ${group}s share the id "${id}". Ids must be unique.`,
      });

  if (controls.length > SPEC_LIMITS.controls)
    ctx.addIssue({
      code: 'custom',
      path: ['channels'],
      message: `There are ${controls.length} controls; keep it to ${SPEC_LIMITS.controls} or fewer. Drop the least useful ones.`,
    });

  spec.endpoints.forEach((endpoint, i) => {
    if (endpoint.free && (endpoint.cost.perCall !== 0 || endpoint.cost.perRecord !== 0))
      ctx.addIssue({
        code: 'custom',
        path: ['endpoints', i, 'cost'],
        message: `Endpoint "${endpoint.id}" is marked free, so its cost must be 0 per call and 0 per record.`,
      });
    if (endpoint.body && endpoint.method === 'GET')
      ctx.addIssue({
        code: 'custom',
        path: ['endpoints', i, 'body'],
        message: `Endpoint "${endpoint.id}" is a GET, which has no body.`,
      });
    const p = endpoint.pagination;
    if (p && p.type !== 'none' && p.type !== 'link' && !p.param && p.type !== 'cursor')
      ctx.addIssue({
        code: 'custom',
        path: ['endpoints', i, 'pagination', 'param'],
        message: `Endpoint "${endpoint.id}" pages by ${p.type}: name the parameter that sets it in pagination.param.`,
      });
    if (p?.type === 'cursor' && (!p.param || !p.cursorPath))
      ctx.addIssue({
        code: 'custom',
        path: ['endpoints', i, 'pagination'],
        message: `Endpoint "${endpoint.id}" pages by cursor: give pagination.param (where the cursor goes) and pagination.cursorPath (where the next cursor is in the response).`,
      });
  });

  spec.channels.forEach((channel, ci) =>
    channel.controls.forEach((control, ki) => checkControl(spec, control, ['channels', ci, 'controls', ki], ctx)),
  );

  const credits = spec.api.credits;
  if (credits?.from === 'endpoint' && (!credits.endpointId || !endpointIds.includes(credits.endpointId)))
    ctx.addIssue({
      code: 'custom',
      path: ['api', 'credits', 'endpointId'],
      message: `api.credits reads from an endpoint: set endpointId to one of ${list(endpointIds)}.`,
    });

  const endpointMissing = (id: string, path: (string | number)[]) => {
    if (!endpointIds.includes(id))
      ctx.addIssue({
        code: 'custom',
        path,
        message: `run points at endpoint "${id}", which doesn't exist. Use one of: ${list(endpointIds)}.`,
      });
  };
  const takeCheck = (id: string | undefined) => {
    if (!id) return;
    const control = controls.find((c) => c.id === id);
    if (!control)
      ctx.addIssue({
        code: 'custom',
        path: ['run', 'takeControlId'],
        message: `run.takeControlId is "${id}", but no control has that id. Use one of: ${list(controlIds)}.`,
      });
    else if (control.kind !== 'amount' && control.kind !== 'dial')
      ctx.addIssue({
        code: 'custom',
        path: ['run', 'takeControlId'],
        message: `run.takeControlId must point at an amount (or dial) control: "${id}" is a ${control.kind}.`,
      });
  };
  const run = spec.run;
  if (run.mode === 'single') {
    endpointMissing(run.endpointId, ['run', 'endpointId']);
    takeCheck(run.takeControlId);
  } else {
    endpointMissing(run.searchId, ['run', 'searchId']);
    endpointMissing(run.collectId, ['run', 'collectId']);
    if (run.searchId === run.collectId)
      ctx.addIssue({
        code: 'custom',
        path: ['run', 'collectId'],
        message: 'run.searchId and run.collectId must be two different endpoints.',
      });
    takeCheck(run.takeControlId);
    const search = spec.endpoints.find((e) => e.id === run.searchId);
    if (search && !search.free)
      ctx.addIssue({
        code: 'custom',
        path: ['run', 'searchId'],
        message: `In searchThenCollect the search step finds ids before anything is spent, so endpoint "${search.id}" should be free. If searching costs credits, use mode "single".`,
      });
  }
}

export const ApiSpecSchema = BaseSpecSchema.superRefine(crossCheck);
export type ApiSpec = z.infer<typeof ApiSpecSchema>;

export type SpecCheck = { ok: true; spec: ApiSpec } | { ok: false; problems: Problem[] };

/** Checks a spec. On failure, each problem has a dot path and a plain message an AI can act on. */
export function checkSpec(input: unknown): SpecCheck {
  const result = ApiSpecSchema.safeParse(input);
  return result.success ? { ok: true, spec: result.data } : { ok: false, problems: problemsOf(result.error) };
}

/** Every control, in channel order. */
export function allControls(spec: ApiSpec): Control[] {
  return spec.channels.flatMap((channel) => channel.controls);
}

/** "CH 01" for the first channel. */
export function channelNumber(index: number): string {
  return `CH ${String(index + 1).padStart(2, '0')}`;
}
