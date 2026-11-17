import type { Selectable } from 'kysely';
import { z } from 'zod';
import { ApiError, errors } from '@/contracts/common';
import {
  monogramOf,
  ProjectCreateSchema,
  ProjectUpdateSchema,
  type Project,
  type ProjectStatus,
  type ProjectSummary,
} from '@/contracts/projects';
import { allControls, ApiSpecSchema, checkSpec, type ApiSpec } from '@/contracts/spec';
import { db, json, newId, parseJson, transaction } from '../db';
import type { ProjectsTable } from '../db/schema';
import { checkBody } from '../http/inputs';
import type { Ctx } from './context';

/**
 * Projects: one API each, owned by one person. Chat A writes the spec and status (through saveSpec and
 * update), chat B marks runs (markRun). Every read and write is scoped to ctx.user.
 */
type Row = Selectable<ProjectsTable>;

const specOrNull = z.union([ApiSpecSchema, z.null()]);

function toProject(row: Row): Project {
  let spec: ApiSpec | null = null;
  try {
    spec = parseJson(specOrNull, row.spec);
  } catch {
    // A spec that no longer passes the contract reads as none, so the project shows "set up again".
    spec = null;
  }
  return {
    id: row.id,
    name: row.name,
    apiName: row.api_name,
    apiSlug: row.api_slug,
    monogram: row.monogram,
    docsUrl: row.docs_url,
    apiKeyId: row.api_key_id,
    brief: row.brief,
    setupVia: row.setup_via,
    status: row.status,
    spec,
    specVersion: row.spec_version,
    creditLimit: row.credit_limit,
    lastRunAt: row.last_run_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSummary(row: Row): ProjectSummary {
  const { spec, ...rest } = toProject(row);
  return { ...rest, channels: spec?.channels.length ?? 0, controls: spec ? allControls(spec).length : 0 };
}

async function row(ctx: Ctx, id: string): Promise<Row> {
  const found = await db
    .selectFrom('projects')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .executeTakeFirst();
  if (!found) throw errors.notFound('That project');
  return found;
}

async function assertOwnKey(ctx: Ctx, keyId: string | null | undefined) {
  if (!keyId) return;
  const key = await db
    .selectFrom('api_keys')
    .select('id')
    .where('id', '=', keyId)
    .where('user_id', '=', ctx.user.id)
    .executeTakeFirst();
  if (!key) throw errors.invalid([{ path: 'apiKeyId', message: 'Pick one of your saved keys.' }]);
}

export async function create(ctx: Ctx, input: unknown): Promise<Project> {
  const data = checkBody(ProjectCreateSchema, input);
  await assertOwnKey(ctx, data.apiKeyId);
  const id = newId();
  await db
    .insertInto('projects')
    .values({
      id,
      user_id: ctx.user.id,
      name: data.name,
      api_name: data.apiName,
      api_slug: data.apiSlug,
      monogram: data.monogram || monogramOf(data.apiName || data.name),
      docs_url: data.docsUrl,
      api_key_id: data.apiKeyId ?? null,
      brief: data.brief,
      setup_via: data.setupVia,
      status: 'draft',
      spec: null,
      spec_version: 0,
      credit_limit: data.creditLimit,
      last_run_at: null,
      archived_at: null,
      created_at: ctx.now,
      updated_at: ctx.now,
    })
    .execute();
  return get(ctx, id);
}

export async function get(ctx: Ctx, id: string): Promise<Project> {
  return toProject(await row(ctx, id));
}

/** The person's projects, most recently used first. Archived ones only when asked for. */
export async function list(ctx: Ctx, opts: { archived?: boolean } = {}): Promise<ProjectSummary[]> {
  const rows = await db
    .selectFrom('projects')
    .selectAll()
    .where('user_id', '=', ctx.user.id)
    .where('archived_at', opts.archived ? 'is not' : 'is', null)
    .orderBy('updated_at', 'desc')
    .execute();
  return rows.map(toSummary);
}

export async function update(ctx: Ctx, id: string, input: unknown): Promise<Project> {
  const patch = checkBody(ProjectUpdateSchema, input);
  await row(ctx, id);
  if (patch.apiKeyId !== undefined) await assertOwnKey(ctx, patch.apiKeyId);
  await db
    .updateTable('projects')
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.apiName !== undefined && { api_name: patch.apiName }),
      ...(patch.apiSlug !== undefined && { api_slug: patch.apiSlug }),
      ...(patch.monogram !== undefined && { monogram: patch.monogram }),
      ...(patch.docsUrl !== undefined && { docs_url: patch.docsUrl }),
      ...(patch.apiKeyId !== undefined && { api_key_id: patch.apiKeyId }),
      ...(patch.brief !== undefined && { brief: patch.brief }),
      ...(patch.setupVia !== undefined && { setup_via: patch.setupVia }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.creditLimit !== undefined && { credit_limit: patch.creditLimit }),
      updated_at: ctx.now,
    })
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .execute();
  return get(ctx, id);
}

/** Archives a project: it leaves the list, its data stays. Archiving twice is fine. */
export async function archive(ctx: Ctx, id: string): Promise<Project> {
  const found = await row(ctx, id);
  if (found.archived_at === null)
    await db
      .updateTable('projects')
      .set({ archived_at: ctx.now, updated_at: ctx.now })
      .where('id', '=', id)
      .where('user_id', '=', ctx.user.id)
      .execute();
  return get(ctx, id);
}

/** Brings an archived project back. */
export async function unarchive(ctx: Ctx, id: string): Promise<Project> {
  await row(ctx, id);
  await db
    .updateTable('projects')
    .set({ archived_at: null, updated_at: ctx.now })
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .execute();
  return get(ctx, id);
}

/**
 * Saves a new spec version: checks it against the contract, bumps spec_version, keeps the old one in
 * spec_versions and (by default) marks the project ready. Throws a 422 with the problems when it doesn't pass.
 */
export async function saveSpec(
  ctx: Ctx,
  id: string,
  input: unknown,
  opts: { author: 'ai' | 'user'; note?: string; status?: ProjectStatus } = { author: 'ai' },
): Promise<Project> {
  const checked = checkSpec(input);
  if (!checked.ok)
    throw new ApiError('invalid_spec', 'The spec needs a fix before it can be saved.', 422, checked.problems);
  await transaction(async () => {
    const found = await row(ctx, id);
    const version = found.spec_version + 1;
    const text = json(checked.spec)!;
    await db
      .insertInto('spec_versions')
      .values({
        id: newId(),
        project_id: id,
        version,
        spec: text,
        author: opts.author,
        note: opts.note ?? null,
        created_at: ctx.now,
      })
      .execute();
    await db
      .updateTable('projects')
      .set({
        spec: text,
        spec_version: version,
        status: opts.status ?? 'ready',
        api_name: found.api_name || checked.spec.api.name,
        api_slug: found.api_slug || checked.spec.api.slug,
        docs_url: found.docs_url || checked.spec.api.docsUrl,
        updated_at: ctx.now,
      })
      .where('id', '=', id)
      .where('user_id', '=', ctx.user.id)
      .execute();
  });
  return get(ctx, id);
}

/** Notes that a run started (chat B): the projects list sorts and shows "last run" from it. */
export async function markRun(ctx: Ctx, id: string, at: number = ctx.now): Promise<void> {
  await db
    .updateTable('projects')
    .set({ last_run_at: at, updated_at: at })
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .execute();
}
