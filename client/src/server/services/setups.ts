import type { Selectable } from 'kysely';
import { z } from 'zod';
import { hostOf } from '@/contracts/api-keys';
import { ApiError, errors } from '@/contracts/common';
import { SetupEventDataSchema, type SetupEvent, type SetupEventData } from '@/contracts/events';
import type { TestResult } from '@/contracts/runs';
import {
  KIND_LABELS,
  SetupChangeSchema,
  SetupStartSchema,
  type SetupStatus,
  type SetupView,
  type SpecOp,
  type SpecOpResult,
} from '@/contracts/setup';
import { allControls, type ApiSpec } from '@/contracts/spec';
import { resolveValues } from '@/contracts/values';
import { limitSetups, MAX_RUNNING_SETUPS } from '../ai/limits';
import { prettyModel } from '../ai/models';
import { bool, db, json, newId, now, transaction } from '../db';
import type { SetupsTable } from '../db/schema';
import { checkBody } from '../http/inputs';
import { testCall } from '../runner';
import { applyOp, draftOf, draftProblems, emptyDraft, SpecOpError, type Draft } from '../setup/spec-ops';
import * as apiKeys from './api-keys';
import { requireCheckedEmail, type Ctx } from './context';
import * as projects from './projects';

/**
 * AI setups. A setup belongs to a project and builds its spec in a draft, one operation at a time, from the
 * built-in assistant (server/setup/loop.ts) or the person's own AI over MCP. Everything it does lands in
 * setup_events, which the Setup screen follows over SSE. Every read and write is scoped to the person through
 * the project.
 */
type Row = Selectable<SetupsTable>;

const DraftSchema = z.custom<Draft>((v) => typeof v === 'object' && v !== null);
const PlanSchema = z.record(z.string(), z.array(z.string())).nullable();

const ACTIVE: SetupStatus[] = ['waiting', 'running'];

// ---------- Rows and events ----------

async function row(ctx: Ctx, id: string): Promise<Row & { project_user: string }> {
  const found = await db
    .selectFrom('setups')
    .innerJoin('projects', 'projects.id', 'setups.project_id')
    .selectAll('setups')
    .select('projects.user_id as project_user')
    .where('setups.id', '=', id)
    .where('projects.user_id', '=', ctx.user.id)
    .executeTakeFirst();
  if (!found) throw errors.notFound('That setup');
  return found;
}

const readDraft = (r: Pick<Row, 'draft'>): Draft => {
  try {
    return r.draft ? (DraftSchema.parse(JSON.parse(r.draft)) as Draft) : emptyDraft();
  } catch {
    return emptyDraft();
  }
};

const readPlan = (r: Pick<Row, 'plan'>): Record<string, string[]> => {
  try {
    return (r.plan ? PlanSchema.parse(JSON.parse(r.plan)) : null) ?? {};
  } catch {
    return {};
  }
};

/** Adds one event to the setup's stream and touches the setup, so the screen knows to redraw. */
export async function emit(setupId: string, data: SetupEventData) {
  const at = now();
  await db
    .insertInto('setup_events')
    .values({ setup_id: setupId, at, kind: data.kind, data: json(data)!, created_at: at })
    .execute();
  await db.updateTable('setups').set({ updated_at: at }).where('id', '=', setupId).execute();
}

/** Moves the stepper forward to `step`: earlier steps done, this one running. Never moves back. */
async function reachStep(setup: Pick<Row, 'id' | 'step'>, step: number) {
  if (setup.step >= step) return;
  for (let s = setup.step; s < step; s++) await emit(setup.id, { kind: 'step', step: s, status: 'done' });
  await emit(setup.id, { kind: 'step', step, status: 'running' });
  await db.updateTable('setups').set({ step, updated_at: now() }).where('id', '=', setup.id).execute();
  setup.step = step;
}

export async function events(ctx: Ctx, setupId: string, after = 0, limit = 500): Promise<SetupEvent[]> {
  await row(ctx, setupId);
  return eventsAfter(setupId, after, limit);
}

/** Events after an id, without the ownership check (the SSE route checks once). */
export async function eventsAfter(setupId: string, after = 0, limit = 500): Promise<SetupEvent[]> {
  const rows = await db
    .selectFrom('setup_events')
    .selectAll()
    .where('setup_id', '=', setupId)
    .where('id', '>', after)
    .orderBy('id')
    .limit(limit)
    .execute();
  return rows.flatMap((r) => {
    const parsed = SetupEventDataSchema.safeParse(JSON.parse(r.data));
    return parsed.success ? [{ id: Number(r.id), setupId: r.setup_id, at: Number(r.at), ...parsed.data }] : [];
  });
}

// ---------- Starting ----------

async function runningCount(ctx: Ctx) {
  const r = await db
    .selectFrom('setups')
    .innerJoin('projects', 'projects.id', 'setups.project_id')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('projects.user_id', '=', ctx.user.id)
    .where('setups.status', '=', 'running')
    .where('setups.via', '=', 'builtin')
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/** What the built-in loop is, so start() can run it without an import cycle (loop.ts registers itself). */
type Launcher = (setupId: string, userId: string) => void;
const launch = globalThis as unknown as { __dialedSetupLauncher?: Launcher };
export function setLauncher(fn: Launcher) {
  launch.__dialedSetupLauncher = fn;
}
function startLoop(setupId: string, userId: string) {
  const fn = launch.__dialedSetupLauncher;
  if (fn) fn(setupId, userId);
  else console.warn('[setup] the built-in loop is not loaded; the setup waits');
}

async function needsBuiltinKey(ctx: Ctx) {
  const key = await db.selectFrom('ai_keys').select('id').where('user_id', '=', ctx.user.id).executeTakeFirst();
  if (!key)
    throw new ApiError(
      'no_ai',
      'Add an AI key in Settings, or pick your own AI over MCP, before the setup starts.',
      422,
    );
  if ((await runningCount(ctx)) >= MAX_RUNNING_SETUPS)
    throw new ApiError(
      'busy',
      `You have ${MAX_RUNNING_SETUPS} setups running. Wait for one to finish, or stop one.`,
      429,
    );
}

/** A new setup row for a project, with its first event. */
async function newSetup(
  ctx: Ctx,
  project: { id: string; spec: ApiSpec | null },
  opts: { via: 'builtin' | 'mcp'; brief: string; docsEndpoints?: number | null; fromSpec: boolean },
): Promise<string> {
  const id = newId();
  const at = now();
  const draft = opts.fromSpec && project.spec ? draftOf(project.spec) : emptyDraft();
  // The built-in assistant starts on the first key (fallback may move it), so the screen can name it at once.
  const firstKey =
    opts.via === 'builtin'
      ? await db
          .selectFrom('ai_keys')
          .select(['id', 'model'])
          .where('user_id', '=', ctx.user.id)
          .orderBy('position')
          .orderBy('created_at')
          .executeTakeFirst()
      : undefined;
  await db
    .insertInto('setups')
    .values({
      id,
      project_id: project.id,
      via: opts.via,
      status: opts.via === 'mcp' ? 'waiting' : 'running',
      ai_key_id: firstKey?.id ?? null,
      model: firstKey?.model ?? null,
      brief: opts.brief,
      step: 1,
      pages_read: 0,
      controls_built: 0,
      error: null,
      started_at: opts.via === 'mcp' ? null : at,
      finished_at: null,
      draft: json(draft),
      docs_endpoints: opts.docsEndpoints ?? null,
      plan: null,
      created_at: at,
      updated_at: at,
    })
    .execute();
  await projects.update(ctx, project.id, { status: opts.via === 'mcp' ? 'waiting' : 'setting_up', setupVia: opts.via });
  if (opts.via === 'builtin') await emit(id, { kind: 'step', step: 1, status: 'running' });
  else await emit(id, { kind: 'log', text: 'Waiting for your AI to start over MCP' });
  return id;
}

/** New project's "Set up project": saves the key, creates the project and its setup, and starts it. */
export async function start(ctx: Ctx, input: unknown): Promise<{ projectId: string; setupId: string }> {
  requireCheckedEmail(ctx);
  const data = checkBody(SetupStartSchema, input);
  if (data.via === 'builtin') await needsBuiltinKey(ctx);
  limitSetups(ctx);
  const ids = await transaction(async () => {
    let apiKeyId = data.apiKeyId ?? null;
    if (apiKeyId) await apiKeys.get(ctx, apiKeyId);
    if (data.apiKey)
      apiKeyId = (
        await apiKeys.create(ctx, {
          apiSlug: data.apiSlug || 'api',
          apiName: data.apiName,
          host: data.apiKey.host,
          label: data.apiKey.label ?? '',
          secret: data.apiKey.secret,
        })
      ).id;
    const project = await projects.create(ctx, {
      name: data.name,
      apiName: data.apiName,
      apiSlug: data.apiSlug,
      monogram: data.monogram,
      docsUrl: data.docsUrl,
      apiKeyId,
      brief: data.brief,
      setupVia: data.via,
    });
    const setupId = await newSetup(ctx, project, {
      via: data.via,
      brief: data.brief,
      docsEndpoints: data.docsEndpoints,
      fromSpec: false,
    });
    return { projectId: project.id, setupId };
  });
  if (data.via === 'builtin') startLoop(ids.setupId, ctx.user.id);
  return ids;
}

/** "Ask for changes" (?change=1): a new setup on the same project that starts from its spec. */
export async function change(ctx: Ctx, projectId: string, input: unknown): Promise<{ setupId: string }> {
  requireCheckedEmail(ctx);
  const data = checkBody(SetupChangeSchema, input);
  const project = await projects.get(ctx, projectId);
  const via = data.via ?? project.setupVia;
  const active = await activeFor(ctx, projectId);
  if (active) throw new ApiError('busy', 'This project is being set up right now. Wait for it, or stop it first.', 409);
  if (via === 'builtin') await needsBuiltinKey(ctx);
  limitSetups(ctx);
  const setupId = await newSetup(ctx, project, { via, brief: data.brief, fromSpec: true });
  if (via === 'builtin') startLoop(setupId, ctx.user.id);
  return { setupId };
}

/** Try again after a failed or stopped setup: the same brief and way, from the current spec if there is one. */
export async function retry(ctx: Ctx, setupId: string): Promise<{ setupId: string }> {
  const old = await row(ctx, setupId);
  if (ACTIVE.includes(old.status)) return { setupId };
  const project = await projects.get(ctx, old.project_id);
  if (old.via === 'builtin') await needsBuiltinKey(ctx);
  limitSetups(ctx);
  const id = await newSetup(ctx, project, {
    via: old.via,
    brief: old.brief,
    docsEndpoints: old.docs_endpoints,
    fromSpec: true,
  });
  if (old.via === 'builtin') startLoop(id, ctx.user.id);
  return { setupId: id };
}

// ---------- Stopping and failing ----------

const aborts = globalThis as unknown as { __dialedSetupAborts?: Map<string, AbortController> };
export const setupAborts = (aborts.__dialedSetupAborts ??= new Map());

async function settleProject(projectId: string) {
  const p = await db.selectFrom('projects').select(['spec']).where('id', '=', projectId).executeTakeFirst();
  await db
    .updateTable('projects')
    .set({ status: p?.spec ? 'ready' : 'failed', updated_at: now() })
    .where('id', '=', projectId)
    .execute();
}

export async function cancel(ctx: Ctx, setupId: string): Promise<void> {
  const r = await row(ctx, setupId);
  if (!ACTIVE.includes(r.status)) return;
  await db
    .updateTable('setups')
    .set({ status: 'cancelled', error: 'You stopped the setup.', finished_at: now(), updated_at: now() })
    .where('id', '=', setupId)
    .execute();
  setupAborts.get(setupId)?.abort();
  await emit(setupId, { kind: 'error', message: 'You stopped the setup.', code: 'cancelled' });
  await settleProject(r.project_id);
}

/** Ends a setup with a plain-words error (the loop, a limit, or the stale-setup job). */
export async function fail(setupId: string, message: string, code = 'failed') {
  const r = await db.selectFrom('setups').select(['status', 'project_id']).where('id', '=', setupId).executeTakeFirst();
  if (!r || !ACTIVE.includes(r.status)) return;
  await db
    .updateTable('setups')
    .set({ status: 'failed', error: message, finished_at: now(), updated_at: now() })
    .where('id', '=', setupId)
    .execute();
  await emit(setupId, { kind: 'error', message, code });
  await settleProject(r.project_id);
}

/** True when the setup is still going (the loop checks between steps). */
export async function isActive(setupId: string): Promise<boolean> {
  const r = await db.selectFrom('setups').select('status').where('id', '=', setupId).executeTakeFirst();
  return Boolean(r && ACTIVE.includes(r.status));
}

// ---------- Doing the work (the loop and MCP) ----------

/** The setup an MCP call on a project works on: the active one, or a new MCP setup when there's none. */
export async function activeFor(ctx: Ctx, projectId: string): Promise<Row | null> {
  const found = await db
    .selectFrom('setups')
    .innerJoin('projects', 'projects.id', 'setups.project_id')
    .selectAll('setups')
    .where('setups.project_id', '=', projectId)
    .where('projects.user_id', '=', ctx.user.id)
    .where('setups.status', 'in', ACTIVE)
    .orderBy('setups.created_at', 'desc')
    .executeTakeFirst();
  return found ?? null;
}

/** For MCP: the setup to work on, started (running) and named after the client. */
export async function forMcp(ctx: Ctx, projectId: string, clientName: string): Promise<string> {
  let active = await activeFor(ctx, projectId);
  if (!active) {
    const project = await projects.get(ctx, projectId);
    const id = await newSetup(ctx, project, { via: 'mcp', brief: 'Changes asked for through MCP', fromSpec: true });
    active = (await db.selectFrom('setups').selectAll().where('id', '=', id).executeTakeFirstOrThrow()) as Row;
  }
  if (active.status === 'waiting') {
    await db
      .updateTable('setups')
      .set({ status: 'running', started_at: now(), model: clientName, updated_at: now() })
      .where('id', '=', active.id)
      .execute();
    await db
      .updateTable('projects')
      .set({ status: 'setting_up', updated_at: now() })
      .where('id', '=', projectId)
      .execute();
    await emit(active.id, { kind: 'log', text: `${clientName} connected` });
    await emit(active.id, { kind: 'step', step: 1, status: 'running' });
  }
  return active.id;
}

/** Notes that the AI read a docs page (step 1), counting toward the page limit. */
export async function markRead(setupId: string, url: string, title: string | null) {
  let short = url;
  try {
    const u = new URL(url);
    short = `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    /* as it is */
  }
  await db
    .updateTable('setups')
    .set((eb) => ({ pages_read: eb('pages_read', '+', 1), updated_at: now() }))
    .where('id', '=', setupId)
    .execute();
  await emit(setupId, { kind: 'log', text: title ? `Read ${title}` : `Opened ${short}`, url });
}

export async function pagesRead(setupId: string): Promise<number> {
  const r = await db.selectFrom('setups').select('pages_read').where('id', '=', setupId).executeTakeFirst();
  return r?.pages_read ?? 0;
}

/** The host a saved key pins the base URL to. */
async function pinnedHost(ctx: Ctx, projectId: string): Promise<string | null> {
  const p = await db
    .selectFrom('projects')
    .select('api_key_id')
    .where('id', '=', projectId)
    .where('user_id', '=', ctx.user.id)
    .executeTakeFirst();
  if (!p?.api_key_id) return null;
  return (await apiKeys.get(ctx, p.api_key_id).catch(() => null))?.host ?? null;
}

/**
 * Applies spec operations in order, stopping at the first one that's rejected. Each accepted one is saved to
 * the draft and emits its events; once the draft passes the contract it's also saved as a spec version.
 * `finish` here only checks the draft: finishSetup completes the setup.
 */
export async function applyOps(
  ctx: Ctx,
  setupId: string,
  ops: SpecOp[],
): Promise<{
  results: SpecOpResult[];
  error: { message: string; problems: { path: string; message: string }[] } | null;
}> {
  const setup = await row(ctx, setupId);
  if (!ACTIVE.includes(setup.status)) throw new ApiError('setup_over', 'This setup has ended. Start a new one.', 409);
  const pin = await pinnedHost(ctx, setup.project_id);
  let draft = readDraft(setup);
  const plan = readPlan(setup);
  const results: SpecOpResult[] = [];
  const pending: SetupEventData[] = [];
  let error: { message: string; problems: { path: string; message: string }[] } | null = null;
  let valid: ApiSpec | null = null;
  let controlsAdded = 0;
  let stepWanted = setup.step;
  for (const op of ops) {
    try {
      const applied = applyOp(draft, op, { pinnedHost: pin });
      draft = applied.draft;
      valid = applied.spec;
      results.push(applied.result);
      pending.push(...applied.events);
      if (applied.planned) plan[applied.planned.channelId] = applied.planned.labels;
      if (op.op === 'add_endpoint' || op.op === 'set_api') stepWanted = Math.max(stepWanted, 2);
      if (op.op === 'add_channel' || op.op === 'add_control') stepWanted = Math.max(stepWanted, 3);
      if (op.op === 'add_control') controlsAdded++;
    } catch (thrown) {
      if (!(thrown instanceof SpecOpError)) throw thrown;
      error = { message: thrown.message, problems: thrown.problems };
      results.push({
        ok: false,
        op: op.op,
        message: [thrown.message, ...thrown.problems.map((p) => `${p.path || '(spec)'}: ${p.message}`)].join('\n'),
        todo: [],
        valid: false,
      });
      break;
    }
  }
  if (results.some((r) => r.ok)) {
    await db
      .updateTable('setups')
      .set((eb) => ({
        draft: json(draft),
        plan: json(plan),
        controls_built: eb('controls_built', '+', controlsAdded),
        updated_at: now(),
      }))
      .where('id', '=', setupId)
      .execute();
    await reachStep(setup, stepWanted);
    for (const event of pending) await emit(setupId, event);
    if (valid)
      await projects.saveSpec(ctx, setup.project_id, valid, {
        author: 'ai',
        note: `Setup in progress (${results.map((r) => r.op).join(', ')})`,
        status: 'setting_up',
      });
  }
  return { results, error };
}

/** What test_call answers the AI: the outcome and a small look at the records. */
export type TestForAi = Pick<TestResult, 'ok' | 'status' | 'records' | 'total' | 'ms' | 'error'> & {
  fields: string[];
  sample: unknown[];
};

/**
 * Step 4: one call on a free endpoint with the draft spec (chat B's testCall), never spending credits. The
 * values are the controls' defaults with the AI's on top.
 */
export async function testStep(
  ctx: Ctx,
  setupId: string,
  endpointId: string,
  values: Record<string, unknown> = {},
): Promise<TestForAi> {
  const setup = await row(ctx, setupId);
  if (!ACTIVE.includes(setup.status)) throw new ApiError('setup_over', 'This setup has ended.', 409);
  const { problems, spec } = draftProblems(readDraft(setup));
  if (!spec)
    throw new ApiError('invalid_spec', 'The spec doesn’t pass the contract yet. Fix these, then test:', 422, problems);
  const endpoint = spec.endpoints.find((e) => e.id === endpointId);
  if (!endpoint) throw new ApiError('not_found', `There’s no endpoint "${endpointId}".`, 404);
  if (!endpoint.free)
    throw new ApiError(
      'not_free',
      `"${endpoint.label}" costs ${endpoint.cost.unit}, and test calls never spend credits. Test a free endpoint.`,
      400,
    );
  await reachStep(setup, 4);
  const resolved = resolveValues(spec, values as never);
  if (resolved.problems.length)
    throw new ApiError('invalid_values', 'Some values don’t fit their controls:', 422, resolved.problems);
  const result = await testCall(ctx, setup.project_id, endpointId, resolved.values, spec);
  await emit(setupId, {
    kind: 'test',
    ok: result.ok,
    endpointId,
    records: result.records,
    ms: result.ms,
    error: result.error?.text ?? null,
  });
  if (result.ok) await emit(setupId, { kind: 'step', step: 4, status: 'done' });
  return {
    ok: result.ok,
    status: result.status,
    records: result.records,
    total: result.total,
    ms: result.ms,
    error: result.error,
    fields: result.fields.slice(0, 60),
    sample: result.sample.slice(0, 3).map((r) => {
      const text = JSON.stringify(r);
      return text.length > 2_000 ? `${text.slice(0, 2_000)}…` : r;
    }),
  };
}

/** Whether a test call passed in this setup. */
async function testedOk(setupId: string): Promise<boolean> {
  const rows = await db
    .selectFrom('setup_events')
    .select('data')
    .where('setup_id', '=', setupId)
    .where('kind', '=', 'test')
    .orderBy('id', 'desc')
    .limit(1)
    .execute();
  if (!rows.length) return false;
  return bool((JSON.parse(rows[0].data) as { ok?: boolean }).ok);
}

/**
 * finish: the draft must pass the contract, and a test call must have passed when the spec has a free endpoint.
 * Saves the spec as a new version, marks the project ready and the setup done.
 */
export async function finishSetup(ctx: Ctx, setupId: string, summary?: string): Promise<{ specVersion: number }> {
  const setup = await row(ctx, setupId);
  if (!ACTIVE.includes(setup.status)) throw new ApiError('setup_over', 'This setup has ended.', 409);
  const { problems, spec } = draftProblems(readDraft(setup));
  if (!spec)
    throw new ApiError(
      'invalid_spec',
      'The spec doesn’t pass the contract yet, so the setup can’t finish:',
      422,
      problems,
    );
  const hasFree = spec.endpoints.some((e) => e.free);
  if (hasFree && !(await testedOk(setupId)))
    throw new ApiError('untested', 'Run test_call on a free endpoint first, and finish once it passes.', 409);
  if (!hasFree) await emit(setupId, { kind: 'log', text: 'No free endpoint, so no test call' });
  await reachStep(setup, 4);
  const project = await projects.saveSpec(ctx, setup.project_id, spec, {
    author: 'ai',
    note: summary?.slice(0, 200) || 'Set up by the AI',
    status: 'ready',
  });
  await db
    .updateTable('setups')
    .set({ status: 'done', finished_at: now(), updated_at: now() })
    .where('id', '=', setupId)
    .execute();
  await emit(setupId, { kind: 'step', step: 4, status: 'done' });
  await emit(setupId, {
    kind: 'done',
    channels: spec.channels.length,
    controls: allControls(spec).length,
    specVersion: project.specVersion,
  });
  return { specVersion: project.specVersion };
}

/** Records which key and model the built-in assistant is on (the key that answered). */
export async function noteModel(setupId: string, keyId: string, model: string) {
  await db
    .updateTable('setups')
    .set({ ai_key_id: keyId, model, updated_at: now() })
    .where('id', '=', setupId)
    .execute();
}

export async function countToolCall(setupId: string): Promise<number> {
  await db
    .updateTable('setups')
    .set((eb) => ({ tool_calls: eb('tool_calls', '+', 1) }))
    .where('id', '=', setupId)
    .execute();
  const r = await db.selectFrom('setups').select('tool_calls').where('id', '=', setupId).executeTakeFirst();
  return Number(r?.tool_calls ?? 0);
}

// ---------- The Setup screen ----------

/** Who's working: "Claude" for an Anthropic key, the MCP client's name, and so on. */
function whoOf(setup: Pick<Row, 'via' | 'model' | 'ai_key_id'>, provider: string | null): string {
  if (setup.via === 'mcp') return setup.model?.trim() || 'Your AI';
  const model = setup.model ?? '';
  if (provider === 'anthropic' || /claude/i.test(model)) return 'Claude';
  if (provider === 'gemini' || /gemini/i.test(model)) return 'Gemini';
  if (provider === 'openai' || /^(gpt|o\d)/i.test(model)) return 'GPT';
  return model ? prettyModel(model.split('/').pop() ?? model) : 'The assistant';
}

export async function view(ctx: Ctx, setupId: string): Promise<SetupView> {
  const setup = await row(ctx, setupId);
  const project = await projects.get(ctx, setup.project_id);
  const provider = setup.ai_key_id
    ? ((await db.selectFrom('ai_keys').select('provider').where('id', '=', setup.ai_key_id).executeTakeFirst())
        ?.provider ?? null)
    : null;
  const draft = readDraft(setup);
  const plan = readPlan(setup);
  const lastTest = await db
    .selectFrom('setup_events')
    .select('data')
    .where('setup_id', '=', setupId)
    .where('kind', '=', 'test')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const last = await db
    .selectFrom('setup_events')
    .select((eb) => eb.fn.max('id').as('max'))
    .where('setup_id', '=', setupId)
    .executeTakeFirst();
  const test = lastTest ? (JSON.parse(lastTest.data) as SetupEventData & { kind: 'test' }) : null;
  const runEndpoint = draft.run ? (draft.run.mode === 'single' ? draft.run.endpointId : draft.run.searchId) : null;
  const main = draft.endpoints.find((e) => e.id === runEndpoint) ?? draft.endpoints[0] ?? null;
  const channels = draft.channels.map((c) => {
    const built = c.controls.map((k) => ({ id: k.id, label: k.label, kind: k.kind, kindLabel: KIND_LABELS[k.kind] }));
    const builtLabels = new Set(built.map((b) => b.label.toLowerCase()));
    return {
      id: c.id,
      title: c.title,
      controls: built,
      waiting: (plan[c.id] ?? []).filter((l) => !builtLabels.has(l.toLowerCase())).slice(0, 12),
    };
  });
  let docsHost: string | null = null;
  try {
    docsHost = project.docsUrl ? new URL(project.docsUrl).host : null;
  } catch {
    docsHost = null;
  }
  return {
    setup: {
      id: setup.id,
      projectId: setup.project_id,
      via: setup.via,
      status: setup.status,
      who: whoOf(setup, provider),
      model: setup.model,
      brief: setup.brief,
      step: setup.step,
      pagesRead: setup.pages_read,
      controlsBuilt: channels.reduce((n, c) => n + c.controls.length, 0),
      toolCalls: Number(setup.tool_calls ?? 0),
      error: setup.error,
      startedAt: setup.started_at,
      finishedAt: setup.finished_at,
      createdAt: setup.created_at,
      change: setup.brief !== project.brief,
    },
    project: {
      id: project.id,
      name: project.name,
      apiName: project.apiName,
      monogram: project.monogram,
      docsUrl: project.docsUrl,
      status: project.status,
    },
    docsHost,
    docsEndpoints: setup.docs_endpoints,
    endpoints: draft.endpoints.map((e) => ({ id: e.id, label: e.label, method: e.method, path: e.path, free: e.free })),
    mainEndpoint: main?.label ?? null,
    channels,
    planned: channels.reduce((n, c) => n + c.controls.length + c.waiting.length, 0),
    notes: draft.notes.map((n) => ({ kind: n.kind, text: n.text })),
    test: test
      ? { ok: test.ok, records: test.records, ms: test.ms, error: test.error ?? null, endpointId: test.endpointId }
      : null,
    askAi: `Set up my Dialed project ${project.name}`,
    lastEventId: Number(last?.max ?? 0),
  };
}

/** The newest setup of a project (the Setup page opens it). */
export async function latestFor(ctx: Ctx, projectId: string): Promise<string | null> {
  const found = await db
    .selectFrom('setups')
    .innerJoin('projects', 'projects.id', 'setups.project_id')
    .select('setups.id')
    .where('setups.project_id', '=', projectId)
    .where('projects.user_id', '=', ctx.user.id)
    .orderBy('setups.created_at', 'desc')
    .executeTakeFirst();
  return found?.id ?? null;
}

/** The setup's updated_at, for the SSE route to notice changes cheaply. */
export async function stamp(setupId: string): Promise<{ updatedAt: number; status: SetupStatus } | null> {
  const r = await db.selectFrom('setups').select(['updated_at', 'status']).where('id', '=', setupId).executeTakeFirst();
  return r ? { updatedAt: Number(r.updated_at), status: r.status } : null;
}

/** Setups that stopped moving (a server restart mid-setup) end as failed, with a way to try again. */
export async function failStale(olderThanMs: number) {
  const stale = await db
    .selectFrom('setups')
    .select('id')
    .where('status', '=', 'running')
    .where('via', '=', 'builtin')
    .where('updated_at', '<', now() - olderThanMs)
    .execute();
  for (const s of stale)
    if (!setupAborts.has(s.id)) await fail(s.id, 'The setup stopped when the server restarted. Try again.', 'stale');
}

export { hostOf };
