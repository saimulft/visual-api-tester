import { ApiError } from '@/contracts/common';
import { hostOf } from '@/contracts/api-keys';
import type { Project } from '@/contracts/projects';
import { capRecords, columnsOf, flattenRecord } from '@/contracts/rows';
import {
  SAMPLE_ROWS,
  type RecordRow,
  type RunError,
  type RunRequestLog,
  type RunResult,
  type RunStatus,
  type RunTrigger,
  type TestResult,
} from '@/contracts/runs';
import { allControls, checkSpec, type ApiSpec, type Endpoint, type Values } from '@/contracts/spec';
import { resolveValues } from '@/contracts/values';
import type { RequestView, RunPreviewDetail } from '@/contracts/workspace';
import { db, json, newId, now } from '../db';
import type { SaveMode } from '../db/schema';
import { saveRecords } from '../datasets/save';
import * as apiKeys from '../services/api-keys';
import { requireCheckedEmail, type Ctx } from '../services/context';
import * as projects from '../services/projects';
import { toRunResult } from '../services/runs';
import { callApi, CallError, CallErrorWithLog, dailyCapReached, runErrorOf } from './call';
import { readPath } from './paths';
import {
  buildRequest,
  endpointOf,
  inputError,
  nextPage,
  readId,
  readRecords,
  readTotal,
  withKey,
  type BuiltRequest,
  type PageState,
} from './request';
import { rememberRecords } from './results';

/**
 * Running a project: a test call on a free endpoint, the live preview, and a run (one endpoint, or a free
 * search for ids then a paid collect of the first `take`). A run never spends past its limit: a manual run
 * over the project's credit limit asks first (409 confirm_credits), and a scheduled run over its schedule's
 * limit spends nothing and ends as "stopped".
 */

/** The most bytes of records a run keeps in runs.sample (the rest go to a dataset when one is picked). */
export const SAMPLE_BYTES = 256 * 1024;
/** Collect calls in flight at once. */
const COLLECT_CONCURRENCY = 3;

type Env = {
  ctx: Ctx;
  project: Project;
  spec: ApiSpec;
  /** The saved key for this API, or null (the spec may need none). */
  key: { id: string; host: string } | null;
};

async function envFor(ctx: Ctx, projectId: string, specOverride?: unknown): Promise<Env> {
  requireCheckedEmail(ctx);
  const project = await projects.get(ctx, projectId);
  let spec = project.spec;
  if (specOverride !== undefined) {
    const checked = checkSpec(specOverride);
    if (!checked.ok) throw new ApiError('invalid_spec', 'The spec needs a fix first.', 422, checked.problems);
    spec = checked.spec;
  }
  if (!spec) throw new ApiError('no_spec', 'This project isn’t set up yet. Set it up first.', 409);
  return { ctx, project, spec, key: await keyFor(ctx, project, spec) };
}

/** The project's key, or the person's key saved for this API's host. */
async function keyFor(ctx: Ctx, project: Project, spec: ApiSpec): Promise<Env['key']> {
  if (spec.api.auth.type === 'none') return null;
  if (project.apiKeyId) {
    const key = await apiKeys.get(ctx, project.apiKeyId).catch(() => null);
    if (key) return { id: key.id, host: key.host };
  }
  const host = hostOf(spec.api.baseUrl);
  const match = (await apiKeys.list(ctx, { apiSlug: spec.api.slug })).find((k) => k.host === host);
  return match ? { id: match.id, host: match.host } : null;
}

function needsKey(env: Env): boolean {
  return env.spec.api.auth.type !== 'none' && !env.key;
}

function needsKeyError(env: Env): ApiError {
  return new ApiError('needs_key', `${env.spec.api.name} needs a key. Add yours in Settings.`, 400);
}

/** The request with the key added (only for its own host, over https), its masked copy and the plain key. */
async function keyed(env: Env, built: BuiltRequest) {
  if (env.spec.api.auth.type === 'none') return { request: built, masked: built, secret: null as string | null };
  if (!env.key) throw needsKeyError(env);
  const secret = await apiKeys.secretFor(env.ctx, env.key.id, built.url);
  const { request, masked } = withKey(built, env.spec.api.auth, { secret, host: env.key.host });
  return { request, masked, secret };
}

/** Records as rows for the results: a bare value (an id) becomes { value }. */
function asRow(record: unknown): RecordRow {
  return record && typeof record === 'object' && !Array.isArray(record)
    ? (record as RecordRow)
    : { value: record as unknown };
}

// ---------- Paging ----------

type PageRun = {
  records: unknown[];
  total: number | null;
  logs: RunRequestLog[];
  retries: number;
  rateWait: number;
  httpStatus: number | null;
  credits: number;
  /** Set when a later page failed: what was fetched stays. */
  error: RunError | null;
  stoppedAtLimit: boolean;
};

/** A cheap fingerprint of a page, to drop a second page that repeats the first. */
function fingerprint(endpoint: Endpoint, records: unknown[]): string {
  return JSON.stringify(records.slice(0, 3).map((r) => readId(endpoint, r) ?? r));
}

/**
 * Fetches an endpoint page by page until it has `take` records, the API says there's no more, or maxPages.
 * Credits for a paid endpoint count as they're spent, and the next page isn't fetched when it would pass
 * `limit`. Throws on the first page's failure; a later page's failure ends it with what it has.
 */
async function fetchPages(
  env: Env,
  endpoint: Endpoint,
  values: Values,
  opts: { take: number | null; limit: number | null; waitForSlot: boolean; maxPages?: number },
): Promise<PageRun> {
  const out: PageRun = {
    records: [],
    total: null,
    logs: [],
    retries: 0,
    rateWait: 0,
    httpStatus: null,
    credits: 0,
    error: null,
    stoppedAtLimit: false,
  };
  let state: PageState = { index: 0 };
  let skippedRepeat = false;
  let firstPrint: string | null = null;
  const maxPages = Math.min(opts.maxPages ?? Infinity, endpoint.pagination?.maxPages ?? 1);

  for (let calls = 0; calls < maxPages + 1; calls++) {
    const want = opts.take === null ? null : opts.take - out.records.length;
    const pageCost = endpoint.cost.perCall + endpoint.cost.perRecord * (want ?? 0);
    if (opts.limit !== null && pageCost > 0 && out.credits + pageCost > opts.limit) {
      out.stoppedAtLimit = true;
      break;
    }
    let result;
    try {
      const built = buildRequest(env.spec, endpoint.id, values, state.index === 0 ? undefined : state);
      const { request, masked, secret } = await keyed(env, built);
      result = await callApi(request, masked, {
        userId: env.ctx.user.id,
        apiName: env.spec.api.name,
        waitForSlot: opts.waitForSlot,
        secret,
      });
    } catch (error) {
      if (error instanceof CallErrorWithLog && error.log) out.logs.push(error.log);
      if (error instanceof CallError && error.status !== null) out.httpStatus = error.status;
      if (state.index === 0) throw Object.assign(error as object, { partial: out });
      out.error = runErrorOf(error, env.spec.api.name);
      break;
    }

    let records = readRecords(endpoint, result.data);
    out.retries += result.retries;
    out.rateWait += result.rateWaitSeconds;
    out.httpStatus = result.response.status;
    if (state.index === 0) out.total = readTotal(endpoint, result.data, result.response.headers);

    const print = fingerprint(endpoint, records);
    const repeat = state.index === 1 && !skippedRepeat && records.length > 0 && print === firstPrint;
    if (state.index === 0) firstPrint = print;
    result.log.records = repeat ? 0 : records.length;
    out.logs.push(result.log);

    if (repeat) {
      // The API's pages start at 1, and leaving the page out gave page 1: ask for the one after.
      skippedRepeat = true;
    } else {
      if (want !== null) records = records.slice(0, Math.max(0, want));
      out.records.push(...records);
      out.credits += endpoint.cost.perCall + endpoint.cost.perRecord * records.length;
    }

    if (opts.take !== null && out.records.length >= opts.take) break;
    if (out.total !== null && out.records.length >= out.total) break;
    const next = nextPage(
      endpoint,
      state,
      { data: result.data, headers: result.response.headers, url: result.response.url },
      readRecords(endpoint, result.data).length,
    );
    if (!next) break;
    state = next;
  }
  return out;
}

// ---------- Take and cost ----------

/** How many records the run takes: the take control's value, or null for "all pages". */
export function takeOf(spec: ApiSpec, values: Values): number | null {
  const id = spec.run.takeControlId;
  if (!id) return null;
  const control = allControls(spec).find((c) => c.id === id);
  const value = values[id];
  if (!control || typeof value !== 'number' || !Number.isFinite(value)) return null;
  const max = control.max ?? value;
  return Math.max(0, Math.min(Math.floor(value), max));
}

/** What a run would cost at most, before it spends anything. */
export function estimateCredits(spec: ApiSpec, take: number | null): number {
  const run = spec.run;
  if (run.mode === 'searchThenCollect') {
    const collect = endpointOf(spec, run.collectId);
    return (take ?? 0) * (collect.cost.perCall + collect.cost.perRecord);
  }
  const endpoint = endpointOf(spec, run.endpointId);
  if (endpoint.free) return 0;
  const pages = endpoint.pagination?.maxPages ?? 1;
  const size = endpoint.pagination?.size;
  const calls = take !== null && size ? Math.min(pages, Math.ceil(take / size)) : pages;
  const records = take ?? (size ? size * pages : 0);
  return endpoint.cost.perCall * calls + endpoint.cost.perRecord * records;
}

function costUnit(spec: ApiSpec): string {
  const run = spec.run;
  const endpoint = endpointOf(spec, run.mode === 'searchThenCollect' ? run.collectId : run.endpointId);
  return endpoint.cost.unit;
}

// ---------- Test call ----------

/**
 * One page of a free endpoint, for the AI's check and the Setup page's Test. Never spends credits: a paid
 * endpoint is refused. `spec` tests a draft that isn't saved yet.
 */
export async function testCall(
  ctx: Ctx,
  projectId: string,
  endpointId: string,
  values: Values = {},
  spec?: unknown,
): Promise<TestResult> {
  const env = await envFor(ctx, projectId, spec);
  const endpoint = endpointOf(env.spec, endpointId);
  if (!endpoint.free)
    throw new ApiError(
      'not_free',
      `Test calls only use free endpoints, and "${endpoint.label}" costs ${endpoint.cost.unit}.`,
      400,
    );
  const built = buildRequest(env.spec, endpoint.id, values);
  const started = now();
  let result: TestResult;
  let maskedLog: RunRequestLog | null = null;
  try {
    const { request, masked, secret } = await keyed(env, built);
    const call = await callApi(request, masked, {
      userId: ctx.user.id,
      apiName: env.spec.api.name,
      waitForSlot: false,
      secret,
    });
    const records = readRecords(endpoint, call.data);
    call.log.records = records.length;
    maskedLog = call.log;
    const rows = records.map(asRow);
    await noteCredits(env, call.response.headers, call.data);
    if (env.key) await apiKeys.markTested(ctx, env.key.id, { ok: true }).catch(() => {});
    result = {
      ok: true,
      endpointId,
      status: call.response.status,
      ms: now() - started,
      records: records.length,
      total: readTotal(endpoint, call.data, call.response.headers),
      fields: columnsOf(rows.slice(0, 100).map((r) => flattenRecord(r))).map((c) => c.key),
      sample: capRecords(rows.slice(0, SAMPLE_ROWS), SAMPLE_BYTES).kept,
      request: call.log,
      error: null,
    };
  } catch (error) {
    const failure = runErrorOf(error, env.spec.api.name);
    if (error instanceof CallErrorWithLog && error.log) maskedLog = error.log;
    if (failure.code === 'key_refused' && env.key)
      await apiKeys.markTested(ctx, env.key.id, { ok: false }).catch(() => {});
    result = {
      ok: false,
      endpointId,
      status: error instanceof CallError ? error.status : null,
      ms: now() - started,
      records: 0,
      total: null,
      fields: [],
      sample: [],
      request: maskedLog ?? {
        endpointId,
        method: built.method,
        url: built.url,
        headers: built.headers,
        body: built.body,
        status: null,
        ms: 0,
        bytes: 0,
        records: 0,
        retries: 0,
        error: failure.text,
        at: now(),
      },
      error: failure,
    };
  }
  await recordTest(env, result);
  return result;
}

/** A test call is kept as a run (trigger "test") so the caps count it and the Setup page can show it. */
async function recordTest(env: Env, result: TestResult) {
  const at = now();
  await db
    .insertInto('runs')
    .values({
      id: newId(),
      project_id: env.project.id,
      user_id: env.ctx.user.id,
      trigger: 'test',
      preset_id: null,
      schedule_id: null,
      values: '{}',
      status: result.ok ? 'ok' : 'failed',
      matches: result.total,
      rows: result.records,
      credits: 0,
      http_status: result.status,
      error_code: result.error?.code ?? null,
      error_text: result.error?.text ?? null,
      retries: result.request.retries,
      requests: json([result.request]) ?? '[]',
      sample: json(result.sample),
      dataset_id: null,
      new_rows: 0,
      started_at: at - result.ms,
      finished_at: at,
      created_at: at,
    })
    .execute();
}

// ---------- Credits left ----------

async function noteCredits(env: Env, headers: Headers, data: unknown) {
  const credits = env.spec.api.credits;
  if (!credits || !env.key) return;
  let raw: unknown = null;
  if (credits.from === 'header') raw = headers.get(credits.name);
  else raw = readPath(data, credits.path ?? `$.${credits.name}`);
  const left = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(left)) return;
  await db
    .updateTable('api_keys')
    .set({ credits_left: left, credits_checked_at: now() })
    .where('id', '=', env.key.id)
    .where('user_id', '=', env.ctx.user.id)
    .execute();
}

/** For credits read from an endpoint: one call to it, when it's free. */
async function refreshCreditsFromEndpoint(env: Env) {
  const credits = env.spec.api.credits;
  if (credits?.from !== 'endpoint' || !credits.endpointId || !env.key) return;
  const endpoint = env.spec.endpoints.find((e) => e.id === credits.endpointId);
  if (!endpoint?.free) return;
  try {
    const { request, masked, secret } = await keyed(env, buildRequest(env.spec, endpoint.id, {}));
    const call = await callApi(request, masked, {
      userId: env.ctx.user.id,
      apiName: env.spec.api.name,
      waitForSlot: true,
      secret,
    });
    await noteCredits(env, call.response.headers, call.data);
  } catch {
    // Credits left is a nice-to-have: a failed check never fails the run.
  }
}

// ---------- Preview ----------

const previewCache = new Map<string, { at: number; matches: number | null }>();
const PREVIEW_TTL = 60_000;

/**
 * The Run module's live line. The match count comes from a free search: the run plan's search, or a free
 * single endpoint that reports a total. Asks for the smallest page it can. Nothing is spent.
 */
export async function previewRun(ctx: Ctx, projectId: string, input: Values = {}): Promise<RunPreviewDetail> {
  const env = await envFor(ctx, projectId);
  const { spec } = env;
  const { values } = resolveValues(spec, input);
  const takeWanted = takeOf(spec, values);
  const keyInfo = env.key ? await apiKeys.get(ctx, env.key.id).catch(() => null) : null;
  const base = {
    unit: costUnit(spec),
    creditLimit: env.project.creditLimit,
    creditsLeft: keyInfo?.creditsLeft ?? null,
    needsKey: needsKey(env),
  };

  const run = spec.run;
  const countId = run.mode === 'searchThenCollect' ? run.searchId : run.endpointId;
  const countEndpoint = endpointOf(spec, countId);
  let matches: number | null = null;
  let note: string | null = null;

  if (!countEndpoint.free || !countEndpoint.total) note = 'This API gives no free count.';
  else if (base.needsKey) note = `Add your ${spec.api.name} key to see the count.`;
  else {
    // Ask for as few records as the take control allows: only the count matters here.
    const small = { ...values };
    const takeControl = allControls(spec).find((c) => c.id === run.takeControlId);
    if (takeControl && takeControl.endpointId === countId) small[takeControl.id] = Math.max(1, takeControl.min ?? 1);
    try {
      const built = buildRequest(spec, countId, small);
      const cacheKey = `${ctx.user.id}|${built.method}|${built.url}|${built.body ?? ''}`;
      const hit = previewCache.get(cacheKey);
      if (hit && now() - hit.at < PREVIEW_TTL) matches = hit.matches;
      else {
        const { request, masked, secret } = await keyed(env, built);
        const call = await callApi(request, masked, {
          userId: ctx.user.id,
          apiName: spec.api.name,
          waitForSlot: false,
          secret,
        });
        matches = readTotal(countEndpoint, call.data, call.response.headers);
        if (previewCache.size > 1000) previewCache.clear();
        previewCache.set(cacheKey, { at: now(), matches });
        await noteCredits(env, call.response.headers, call.data);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'bad_input') note = error.message;
      else note = runErrorOf(error, spec.api.name).text;
    }
  }

  const take = takeWanted === null ? (matches ?? 0) : matches === null ? takeWanted : Math.min(takeWanted, matches);
  const credits = estimateCredits(spec, takeWanted === null ? null : take);
  return { ...base, matches, take, credits, free: credits === 0, note, requests: requestViews(spec, values, keyInfo, take) };
}

const ID_SLOT = 'DIALEDIDSLOT';

/** What Run will send, masked with the key's last four (the key itself is never read here). */
function requestViews(
  spec: ApiSpec,
  values: Values,
  key: { last4: string; host: string } | null,
  take: number,
): RequestView[] {
  const run = spec.run;
  const steps: { id: string; params?: Record<string, string>; times: number | null }[] =
    run.mode === 'searchThenCollect'
      ? [
          { id: run.searchId, times: null },
          { id: run.collectId, params: { [run.idParam]: ID_SLOT }, times: take },
        ]
      : [{ id: run.endpointId, times: null }];
  const views: RequestView[] = [];
  steps.forEach((step, i) => {
    const endpoint = endpointOf(spec, step.id);
    const cost = endpoint.free
      ? 'free'
      : endpoint.cost.perRecord
        ? `${endpoint.cost.perRecord.toLocaleString('en-US')} ${endpoint.cost.unit} each`
        : `${endpoint.cost.perCall.toLocaleString('en-US')} ${endpoint.cost.unit} a call`;
    let built: BuiltRequest;
    try {
      built = buildRequest(spec, step.id, values, undefined, { params: step.params });
    } catch {
      return;
    }
    let shown = built;
    if (spec.api.auth.type !== 'none' && key) {
      try {
        shown = withKey(built, spec.api.auth, { secret: `xxxxxxxx${key.last4}`, host: key.host }).masked;
      } catch {
        shown = built;
      }
    }
    const slot = (text: string) => text.split(ID_SLOT).join(`{${run.mode === 'searchThenCollect' ? run.idParam : 'id'}}`);
    views.push({
      step: `${i + 1} · ${endpoint.label}, ${cost}`,
      endpointId: endpoint.id,
      method: shown.method,
      url: slot(shown.url),
      headers: Object.fromEntries(Object.entries(shown.headers).filter(([k]) => k !== 'accept' && k !== 'content-type')),
      body: shown.json ? JSON.stringify(shown.json, null, 2) : null,
      times: step.times,
    });
  });
  return views;
}

// ---------- Run ----------

export type RunOptions = {
  values: Values;
  presetId?: string | null;
  trigger: RunTrigger;
  datasetId?: string | null;
  /** Overrides the dataset's save mode for this save. */
  saveMode?: SaveMode;
  /** Credits the person agreed to in the "over your limit" dialog (manual and MCP runs). */
  confirmCredits?: number;
  /** A scheduled run: its schedule and its own credit limit. */
  scheduleId?: string | null;
  creditLimit?: number;
};

const globals = globalThis as unknown as { __dialedRunning?: Set<string> };
const running = (globals.__dialedRunning ??= new Set<string>());

type Finish = {
  status: RunStatus;
  matches: number | null;
  records: unknown[];
  credits: number;
  httpStatus: number | null;
  error: RunError | null;
  retries: number;
  logs: RunRequestLog[];
  /** Ids already in the dataset, skipped before collecting (they cost nothing). */
  skipped?: number;
};

/** An add-new-rows dataset with a key: what's saved already, so the collect step can skip it. */
async function knownKeys(env: Env, datasetId: string | null | undefined) {
  if (!datasetId) return null;
  const dataset = await db
    .selectFrom('datasets')
    .select(['id', 'save_mode', 'key_path', 'rows'])
    .where('id', '=', datasetId)
    .where('user_id', '=', env.ctx.user.id)
    .executeTakeFirst();
  if (!dataset || dataset.save_mode !== 'append' || !dataset.key_path) return null;
  return {
    rows: Number(dataset.rows),
    async filter(ids: string[]): Promise<Set<string>> {
      const found = new Set<string>();
      for (let i = 0; i < ids.length; i += 500) {
        const rows = await db
          .selectFrom('dataset_rows')
          .select('row_key')
          .where('dataset_id', '=', dataset.id)
          .where('row_key', 'in', ids.slice(i, i + 500))
          .execute();
        for (const r of rows) if (r.row_key) found.add(r.row_key);
      }
      return found;
    },
  };
}

async function insertRun(env: Env, opts: RunOptions, values: Values, at: number): Promise<string> {
  const id = newId();
  await db
    .insertInto('runs')
    .values({
      id,
      project_id: env.project.id,
      user_id: env.ctx.user.id,
      trigger: opts.trigger,
      preset_id: opts.presetId ?? null,
      schedule_id: opts.scheduleId ?? null,
      values: json(values) ?? '{}',
      status: 'running',
      matches: null,
      rows: 0,
      credits: 0,
      http_status: null,
      error_code: null,
      error_text: null,
      retries: 0,
      requests: '[]',
      sample: null,
      dataset_id: null,
      new_rows: 0,
      started_at: at,
      finished_at: null,
      created_at: at,
    })
    .execute();
  return id;
}

async function finishRun(env: Env, runId: string, opts: RunOptions, finish: Finish): Promise<RunResult> {
  const rows = finish.records.map(asRow);
  let datasetId: string | null = null;
  let newRows = 0;
  let error = finish.error;
  if (opts.datasetId && (rows.length || finish.skipped) && finish.status !== 'failed') {
    try {
      const saved = await saveRecords(env.ctx, opts.datasetId, {
        runId,
        records: rows,
        mode: opts.saveMode,
        skippedBefore: finish.skipped ?? 0,
      });
      datasetId = opts.datasetId;
      newRows = saved.newRows;
    } catch (e) {
      error = error ?? { code: 'save_failed', text: `The rows came back, but saving them failed: ${runErrorOf(e, env.spec.api.name).text}` };
    }
  }
  const at = now();
  await db
    .updateTable('runs')
    .set({
      status: finish.status,
      matches: finish.matches,
      rows: rows.length,
      credits: finish.credits,
      http_status: finish.httpStatus,
      error_code: error?.code ?? null,
      error_text: error?.text ?? null,
      retries: finish.retries,
      requests: json(finish.logs) ?? '[]',
      sample: json(capRecords(rows, SAMPLE_BYTES).kept),
      dataset_id: datasetId,
      new_rows: newRows,
      finished_at: at,
    })
    .where('id', '=', runId)
    .execute();
  if (rows.length) rememberRecords(env.ctx.user.id, runId, rows);
  const row = await db.selectFrom('runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
  return toRunResult(row);
}

/** A run that ends before calling anything (over a schedule's limit, a missing key, bad input). */
async function endEarly(env: Env, opts: RunOptions, values: Values, status: RunStatus, error: RunError) {
  const at = now();
  const runId = await insertRun(env, opts, values, at);
  await projects.markRun(env.ctx, env.project.id, at);
  return finishRun(env, runId, opts, {
    status,
    matches: null,
    records: [],
    credits: 0,
    httpStatus: null,
    error,
    retries: 0,
    logs: [],
  });
}

async function execute(
  env: Env,
  values: Values,
  take: number | null,
  limit: number | null,
  datasetId?: string | null,
): Promise<Finish> {
  const { spec } = env;
  const run = spec.run;
  const waitForSlot = true;
  let pages: PageRun | null = null;
  try {
    if (run.mode === 'single') {
      const endpoint = endpointOf(spec, run.endpointId);
      pages = await fetchPages(env, endpoint, values, { take, limit, waitForSlot });
      const rateNote = pages.rateWait ? { code: 'rate_limited', text: `Rate limited, retried after ${pages.rateWait} s` } : null;
      return {
        status: pages.error || pages.stoppedAtLimit ? 'partial' : 'ok',
        matches: pages.total,
        records: pages.records,
        credits: pages.credits,
        httpStatus: pages.httpStatus,
        error:
          pages.error ??
          (pages.stoppedAtLimit
            ? { code: 'credit_limit', text: `Stopped at the credit limit of ${limit?.toLocaleString('en-US')}.` }
            : rateNote),
        retries: pages.retries,
        logs: pages.logs,
      };
    }

    // Search (free) for ids, then collect the first `take`.
    const search = endpointOf(spec, run.searchId);
    const collect = endpointOf(spec, run.collectId);
    const want = take ?? 0;
    // Saving into an add-new-rows dataset: ask the free search for more ids, and skip the ones saved already,
    // so repeats are never collected (or paid for) again.
    const known = await knownKeys(env, datasetId);
    const takeControl = allControls(spec).find((c) => c.id === run.takeControlId);
    let searchValues = values;
    let searchTake = want;
    if (known && known.rows > 0 && takeControl?.endpointId === search.id) {
      searchTake = Math.min(takeControl.max ?? want + known.rows, want + known.rows);
      searchValues = { ...values, [takeControl.id]: searchTake };
    }
    pages = await fetchPages(env, search, searchValues, { take: searchTake, limit: null, waitForSlot });
    const found: string[] = [];
    for (const record of pages.records) {
      const id = readId(search, record);
      if (id !== null && !found.includes(id)) found.push(id);
    }
    const saved = known ? await known.filter(found) : new Set<string>();
    const ids: string[] = [];
    let skipped = 0;
    for (const id of found) {
      if (ids.length >= want) break;
      if (saved.has(id)) skipped++;
      else ids.push(id);
    }
    const logs = [...pages.logs];
    let retries = pages.retries;
    let rateWait = pages.rateWait;
    let credits = 0;
    let httpStatus = pages.httpStatus;
    let failure: RunError | null = pages.error;
    let stoppedAtLimit = false;
    const records: unknown[] = new Array(ids.length);
    let missing = 0;
    let fatal: unknown = null;
    let cursor = 0;
    const perRecord = collect.cost.perCall + collect.cost.perRecord;

    const worker = async () => {
      while (cursor < ids.length && !fatal) {
        const index = cursor++;
        if (limit !== null && perRecord > 0 && credits + perRecord > limit) {
          stoppedAtLimit = true;
          return;
        }
        credits += perRecord; // held while the call is out, given back if it fails
        try {
          const built = buildRequest(spec, collect.id, values, undefined, { params: { [run.idParam]: ids[index] } });
          const { request, masked, secret } = await keyed(env, built);
          const call = await callApi(request, masked, {
            userId: env.ctx.user.id,
            apiName: spec.api.name,
            waitForSlot,
            secret,
          });
          const found = readRecords(collect, call.data);
          call.log.records = found.length;
          logs.push(call.log);
          retries += call.retries;
          rateWait += call.rateWaitSeconds;
          httpStatus = call.response.status;
          records[index] = found.length === 1 ? found[0] : found.length ? found : undefined;
          if (!found.length) {
            credits -= perRecord;
            missing++;
          }
          await noteCredits(env, call.response.headers, call.data);
        } catch (error) {
          credits -= perRecord;
          if (error instanceof CallErrorWithLog && error.log) logs.push(error.log);
          if (error instanceof CallError && error.status !== null) httpStatus = error.status;
          const failed = runErrorOf(error, spec.api.name);
          if (failed.code === 'not_found') {
            missing++;
            continue;
          }
          // A refused key, the daily cap or a builder error stops every worker; other failures skip one record.
          if (['key_refused', 'daily_cap', 'needs_key', 'wrong_host', 'bad_input', 'no_credits'].includes(failed.code))
            fatal = error;
          failure = failure ?? failed;
          missing++;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(COLLECT_CONCURRENCY, Math.max(1, ids.length)) }, worker));

    const kept = records.flat().filter((r) => r !== undefined);
    if (fatal && !kept.length) throw Object.assign(fatal as object, { partial: { logs, retries, httpStatus } });
    const fatalError = fatal ? runErrorOf(fatal, spec.api.name) : null;
    const status: RunStatus = fatalError || failure || stoppedAtLimit || (missing && kept.length < ids.length) ? 'partial' : 'ok';
    return {
      status: ids.length === 0 && !pages.error ? 'ok' : status,
      matches: pages.total,
      records: kept,
      credits,
      httpStatus,
      error:
        fatalError ??
        failure ??
        (stoppedAtLimit
          ? { code: 'credit_limit', text: `Stopped at the credit limit of ${limit?.toLocaleString('en-US')}.` }
          : missing
            ? { code: 'not_found', text: `${missing} of ${ids.length} records weren’t found.` }
            : rateWait
              ? { code: 'rate_limited', text: `Rate limited, retried after ${rateWait} s` }
              : null),
      retries,
      logs,
      skipped,
    };
  } catch (error) {
    const partial = (error as { partial?: Partial<PageRun> }).partial;
    return {
      status: 'failed',
      matches: null,
      records: [],
      credits: 0,
      httpStatus: partial?.httpStatus ?? (error instanceof CallError ? error.status : null),
      error: runErrorOf(error, spec.api.name),
      retries: partial?.retries ?? 0,
      logs: partial?.logs ?? [],
    };
  }
}

/**
 * Starts a run and returns its id at once; `done` settles when it finishes. Bad input, a missing key and a
 * manual run over the credit limit throw before anything is written (a scheduled run records them instead,
 * so its history and alerts show them).
 */
export async function startRun(
  ctx: Ctx,
  projectId: string,
  opts: RunOptions,
): Promise<{ runId: string; done: Promise<RunResult> }> {
  const env = await envFor(ctx, projectId);
  const { spec } = env;
  const scheduled = opts.trigger === 'schedule';
  const { values, problems: mine } = resolveValues(spec, opts.values);

  const early = async (status: RunStatus, error: RunError) => {
    const result = await endEarly(env, opts, values, status, error);
    return { runId: result.runId, done: Promise.resolve(result) };
  };

  if (mine.length) {
    const error = inputError(spec, mine);
    if (!scheduled) throw error;
    return early('failed', { code: 'bad_input', text: error.message });
  }
  if (needsKey(env)) {
    if (!scheduled) throw needsKeyError(env);
    return early('failed', { code: 'needs_key', text: needsKeyError(env).message });
  }

  const take = takeOf(spec, values);
  const estimate = estimateCredits(spec, take);
  const unit = costUnit(spec);
  let limit: number | null = null;
  if (scheduled) {
    limit = opts.creditLimit ?? env.project.creditLimit;
    if (estimate > limit)
      return early('stopped', {
        code: 'credit_limit',
        text: `Stopped before spending: this run would use ${estimate.toLocaleString('en-US')} ${unit}, over the schedule’s limit of ${limit.toLocaleString('en-US')}.`,
      });
  } else if (estimate > env.project.creditLimit) {
    if ((opts.confirmCredits ?? -1) < estimate)
      throw new ApiError(
        'confirm_credits',
        `This run would use ${estimate.toLocaleString('en-US')} ${unit}, over this project’s limit of ${env.project.creditLimit.toLocaleString('en-US')}. Confirm to go ahead.`,
        409,
        // The number the dialog sends back as confirmCredits.
        [{ path: 'credits', message: String(estimate) }],
      );
    limit = opts.confirmCredits ?? estimate;
  } else limit = env.project.creditLimit;

  if (running.has(projectId))
    throw new ApiError('already_running', 'This project is already running. Wait for it to finish.', 409);
  running.add(projectId);
  try {
    // A daily cap reached already: say so now rather than start a run that can't call.
    const cap = await dailyCapReached(ctx.user.id);
    if (cap) throw new ApiError('daily_cap', cap, 429);
    const at = now();
    const runId = await insertRun(env, opts, values, at);
    await projects.markRun(ctx, projectId, at);
    const done = execute(env, values, take, limit, opts.datasetId)
      .then(async (finish) => {
        const result = await finishRun(env, runId, opts, finish);
        if (finish.status !== 'failed') await refreshCreditsFromEndpoint(env);
        return result;
      })
      .catch(async (error) => {
        console.error('[runner] run failed', error);
        return finishRun(env, runId, opts, {
          status: 'failed',
          matches: null,
          records: [],
          credits: 0,
          httpStatus: null,
          error: runErrorOf(error, spec.api.name),
          retries: 0,
          logs: [],
        });
      })
      .finally(() => running.delete(projectId));
    return { runId, done };
  } catch (error) {
    running.delete(projectId);
    throw error;
  }
}

/** Runs a project and waits for it (common.md › Services between chats). */
export async function runProject(ctx: Ctx, projectId: string, opts: RunOptions): Promise<RunResult> {
  const { done } = await startRun(ctx, projectId, opts);
  return done;
}
