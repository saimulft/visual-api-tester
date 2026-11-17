import { randomBytes } from 'node:crypto';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import { ApiError, errors } from '@/contracts/common';
import {
  DatasetCreateSchema,
  DatasetUpdateSchema,
  SaveRunSchema,
  type Dataset,
  type DatasetRowsPage,
  type DatasetSource,
  type DatasetSummary,
  type SaveResult,
} from '@/contracts/datasets';
import { columnsOf, flattenRecord, type Column } from '@/contracts/rows';
import { allControls, type ApiSpec } from '@/contracts/spec';
import { db, likePattern, newId, parseJson, transaction } from '../db';
import type { DatasetsTable } from '../db/schema';
import { saveRecords } from '../datasets/save';
import { checkBody } from '../http/inputs';
import { recallRecords } from '../runner/results';
import type { Ctx } from './context';
import * as projects from './projects';

/**
 * Datasets: rows kept from runs, scoped to the person. Saving goes through datasets/save.ts (the three
 * save modes); exports stream from datasets/export.ts; the live CSV link is a 32-byte token here.
 */
type Row = Selectable<DatasetsTable>;

const ColumnsSchema = z.array(z.object({ key: z.string(), label: z.string(), type: z.string() })).catch([]);

const appUrl = () => (process.env.APP_URL || 'http://localhost:3300').replace(/\/$/, '');

function summaryQuery(ctx: Ctx) {
  return db
    .selectFrom('datasets')
    .innerJoin('projects', 'projects.id', 'datasets.project_id')
    .selectAll('datasets')
    .select(['projects.name as project_name', 'projects.api_name', 'projects.monogram'])
    .where('datasets.user_id', '=', ctx.user.id);
}
type SummaryRow = Awaited<ReturnType<ReturnType<typeof summaryQuery>['execute']>>[number];

/** The schedule feeding each dataset, and whether its last run failed. */
async function sources(ctx: Ctx, datasetIds: string[]): Promise<Map<string, DatasetSource>> {
  const out = new Map<string, DatasetSource>();
  if (!datasetIds.length) return out;
  const rows = await db
    .selectFrom('schedules')
    .leftJoin('runs', 'runs.id', 'schedules.last_run_id')
    .select([
      'schedules.id',
      'schedules.name',
      'schedules.cadence',
      'schedules.status',
      'schedules.dataset_id',
      'runs.status as last_status',
    ])
    .where('schedules.user_id', '=', ctx.user.id)
    .where('schedules.dataset_id', 'in', datasetIds)
    .orderBy('schedules.created_at')
    .execute();
  for (const row of rows) {
    if (!row.dataset_id || out.has(row.dataset_id)) continue;
    out.set(row.dataset_id, {
      scheduleId: row.id,
      scheduleName: row.name,
      cadence: row.cadence,
      state: row.last_status === 'failed' ? 'failed' : row.status === 'on' ? 'on' : 'paused',
    });
  }
  return out;
}

const MANUAL: DatasetSource = { scheduleId: null, scheduleName: null, cadence: null, state: 'manual' };

function toSummary(row: SummaryRow, source: DatasetSource | undefined): DatasetSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    apiName: row.api_name,
    monogram: row.monogram,
    name: row.name,
    saveMode: row.save_mode,
    keyPath: row.key_path,
    keyLabel: row.key_label,
    columns: parseJson(ColumnsSchema, row.columns) as Column[],
    rows: Number(row.rows),
    bytes: Number(row.bytes),
    runs: Number(row.runs),
    repeatsSkipped: Number(row.repeats_skipped),
    csvOn: Boolean(row.csv_token),
    source: source ?? MANUAL,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export type DatasetFilter = { projectId?: string; since?: number; q?: string };

/** The person's datasets, most recently updated first. */
export async function list(ctx: Ctx, filter: DatasetFilter = {}): Promise<DatasetSummary[]> {
  let query = summaryQuery(ctx);
  if (filter.projectId) query = query.where('datasets.project_id', '=', filter.projectId);
  if (filter.since !== undefined) query = query.where('datasets.updated_at', '>=', filter.since);
  if (filter.q?.trim()) {
    const pattern = likePattern(filter.q.trim());
    query = query.where((eb) =>
      eb.or([
        eb(eb.fn('lower', ['datasets.name']), 'like', pattern),
        eb(eb.fn('lower', ['projects.name']), 'like', pattern),
      ]),
    );
  }
  const rows = await query.orderBy('datasets.updated_at', 'desc').execute();
  const src = await sources(
    ctx,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toSummary(r, src.get(r.id)));
}

async function row(ctx: Ctx, id: string): Promise<Row> {
  const found = await db
    .selectFrom('datasets')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .executeTakeFirst();
  if (!found) throw errors.notFound('That dataset');
  return found;
}

/** "companies" from the run plan's take control unit, else "rows". */
function nounOf(spec: ApiSpec | null): string {
  if (!spec?.run.takeControlId) return 'rows';
  const control = allControls(spec).find((c) => c.id === spec.run.takeControlId);
  return control?.unit || 'rows';
}

/** The key a project's rows are matched on: the records' id path, and what to call it. */
export function defaultKey(spec: ApiSpec | null): { keyPath: string | null; keyLabel: string | null } {
  if (!spec) return { keyPath: null, keyLabel: null };
  const run = spec.run;
  const endpointId = run.mode === 'searchThenCollect' ? run.collectId : run.endpointId;
  const endpoint = spec.endpoints.find((e) => e.id === endpointId);
  if (!endpoint?.idPath) return { keyPath: null, keyLabel: null };
  return { keyPath: endpoint.idPath, keyLabel: run.mode === 'searchThenCollect' ? run.idParam : endpoint.idPath };
}

export async function get(ctx: Ctx, id: string): Promise<Dataset> {
  const found = await summaryQuery(ctx).where('datasets.id', '=', id).executeTakeFirst();
  if (!found) throw errors.notFound('That dataset');
  const src = await sources(ctx, [id]);
  const perRun = await db
    .selectFrom('runs')
    .select(['id', 'started_at', 'new_rows'])
    .where('user_id', '=', ctx.user.id)
    .where('dataset_id', '=', id)
    .orderBy('started_at', 'desc')
    .limit(12)
    .execute();
  const project = await projects.get(ctx, found.project_id).catch(() => null);
  return {
    ...toSummary(found, src.get(id)),
    csvUrl: found.csv_token ? `${appUrl()}/csv/${found.csv_token}` : null,
    perRun: perRun
      .reverse()
      .map((r) => ({ runId: r.id, at: Number(r.started_at), newRows: Number(r.new_rows) })),
    noun: nounOf(project?.spec ?? null),
  };
}

export async function create(ctx: Ctx, input: unknown): Promise<Dataset> {
  const data = checkBody(DatasetCreateSchema, input);
  const project = await projects.get(ctx, data.projectId);
  const key = defaultKey(project.spec);
  const id = newId();
  await db
    .insertInto('datasets')
    .values({
      id,
      user_id: ctx.user.id,
      project_id: project.id,
      name: data.name,
      save_mode: data.saveMode,
      key_path: data.keyPath !== undefined ? data.keyPath : key.keyPath,
      key_label: data.keyLabel !== undefined ? data.keyLabel : key.keyLabel,
      columns: '[]',
      rows: 0,
      bytes: 0,
      runs: 0,
      repeats_skipped: 0,
      csv_token: null,
      csv_token_at: null,
      created_at: ctx.now,
      updated_at: ctx.now,
    })
    .execute();
  if (data.runId) await saveRun(ctx, id, { runId: data.runId });
  return get(ctx, id);
}

export async function update(ctx: Ctx, id: string, input: unknown): Promise<Dataset> {
  const patch = checkBody(DatasetUpdateSchema, input);
  await row(ctx, id);
  await db
    .updateTable('datasets')
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.saveMode !== undefined && { save_mode: patch.saveMode }),
      ...(patch.keyPath !== undefined && { key_path: patch.keyPath }),
      ...(patch.keyLabel !== undefined && { key_label: patch.keyLabel }),
      updated_at: ctx.now,
    })
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .execute();
  return get(ctx, id);
}

/** Deletes a dataset and its rows. Schedules that fed it keep going without one. */
export async function remove(ctx: Ctx, id: string): Promise<void> {
  await row(ctx, id);
  await transaction(async () => {
    await db.deleteFrom('dataset_rows').where('dataset_id', '=', id).execute();
    await db.deleteFrom('datasets').where('id', '=', id).where('user_id', '=', ctx.user.id).execute();
  });
}

/**
 * Saves a finished run's rows into a dataset ("Save to dataset" after a run). Every row while the run is
 * still in memory; after a restart, the rows kept in the run's sample (`fromSample` says so when that's
 * fewer than the run had).
 */
export async function saveRun(ctx: Ctx, id: string, input: unknown): Promise<SaveResult> {
  const data = checkBody(SaveRunSchema, input);
  const run = await db
    .selectFrom('runs')
    .select(['id', 'project_id', 'rows', 'sample', 'status'])
    .where('id', '=', data.runId)
    .where('user_id', '=', ctx.user.id)
    .executeTakeFirst();
  if (!run) throw errors.notFound('That run');
  const dataset = await row(ctx, id);
  if (dataset.project_id !== run.project_id)
    throw new ApiError('wrong_project', 'That dataset belongs to another project.', 422);
  let records: unknown[] | null = recallRecords(ctx.user.id, run.id);
  let fromSample = false;
  if (!records) {
    records = parseJson(z.array(z.unknown()).nullable().catch(null), run.sample) ?? [];
    fromSample = records.length < Number(run.rows);
  }
  if (!records.length) throw new ApiError('no_rows', 'This run has no rows to save.', 422);
  const saved = await saveRecords(ctx, id, { runId: run.id, records, mode: data.mode });
  await db
    .updateTable('runs')
    .set({ dataset_id: id, new_rows: saved.newRows })
    .where('id', '=', run.id)
    .where('user_id', '=', ctx.user.id)
    .execute();
  return { newRows: saved.newRows, skipped: saved.skipped, rows: saved.rows, fromSample };
}

/** A page of a dataset's rows, newest first, flattened into its columns. */
export async function rows(
  ctx: Ctx,
  id: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<DatasetRowsPage> {
  const dataset = await row(ctx, id);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 500);
  const page = Math.max(opts.page ?? 1, 1);
  const found = await db
    .selectFrom('dataset_rows')
    .select(['id', 'run_id', 'data', 'created_at'])
    .where('dataset_id', '=', id)
    .orderBy('id', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .execute();
  const flat = found.map((r) => ({
    ...flattenRecord(JSON.parse(r.data)),
    _at: Number(r.created_at),
    _run: r.run_id,
  }));
  const known = parseJson(ColumnsSchema, dataset.columns) as Column[];
  return { columns: known.length ? known : columnsOf(flat), rows: flat, total: Number(dataset.rows), page, pageSize };
}

/** Turns the live CSV link on (a new 32-byte token each time, so "New link" retires the old one) or off. */
export async function csvLink(ctx: Ctx, id: string, on: boolean): Promise<Dataset> {
  await row(ctx, id);
  await db
    .updateTable('datasets')
    .set({
      csv_token: on ? randomBytes(32).toString('base64url') : null,
      csv_token_at: on ? ctx.now : null,
      updated_at: ctx.now,
    })
    .where('id', '=', id)
    .where('user_id', '=', ctx.user.id)
    .execute();
  return get(ctx, id);
}

/** The dataset behind a live CSV link, or null (public: the token is the only key). */
export async function byCsvToken(token: string): Promise<Row | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  return (await db.selectFrom('datasets').selectAll().where('csv_token', '=', token).executeTakeFirst()) ?? null;
}

/** Totals for the Data page's line: datasets and rows. */
export async function totals(ctx: Ctx): Promise<{ datasets: number; rows: number }> {
  const found = await db
    .selectFrom('datasets')
    .select((eb) => [eb.fn.countAll<number>().as('n'), eb.fn.sum<number>('rows').as('rows')])
    .where('user_id', '=', ctx.user.id)
    .executeTakeFirst();
  return { datasets: Number(found?.n ?? 0), rows: Number(found?.rows ?? 0) };
}

