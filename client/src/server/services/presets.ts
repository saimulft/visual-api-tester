import type { Selectable } from 'kysely';
import { errors } from '@/contracts/common';
import { ValuesSchema } from '@/contracts/spec';
import { PresetCreateSchema, PresetUpdateSchema, type Preset } from '@/contracts/workspace';
import { db, json, newId, parseJson } from '../db';
import type { PresetsTable } from '../db/schema';
import { checkBody } from '../http/inputs';
import type { Ctx } from './context';
import * as projects from './projects';

/** Presets: named sets of control values for a project. Scoped through the project's owner. */
type Row = Selectable<PresetsTable>;
const ValuesOrEmpty = ValuesSchema.catch({});

function toPreset(row: Row, usedBy: string[]): Preset {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    values: parseJson(ValuesOrEmpty, row.values),
    usedBy,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

async function usedBy(ctx: Ctx, presetIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!presetIds.length) return out;
  const rows = await db
    .selectFrom('schedules')
    .select(['preset_id', 'name'])
    .where('user_id', '=', ctx.user.id)
    .where('preset_id', 'in', presetIds)
    .execute();
  for (const r of rows) if (r.preset_id) out.set(r.preset_id, [...(out.get(r.preset_id) ?? []), r.name]);
  return out;
}

async function row(ctx: Ctx, id: string): Promise<Row> {
  const found = await db
    .selectFrom('presets')
    .innerJoin('projects', 'projects.id', 'presets.project_id')
    .selectAll('presets')
    .where('presets.id', '=', id)
    .where('projects.user_id', '=', ctx.user.id)
    .executeTakeFirst();
  if (!found) throw errors.notFound('That preset');
  return found;
}

/** A project's presets, newest first. */
export async function list(ctx: Ctx, projectId: string): Promise<Preset[]> {
  await projects.get(ctx, projectId);
  const rows = await db
    .selectFrom('presets')
    .selectAll()
    .where('project_id', '=', projectId)
    .orderBy('updated_at', 'desc')
    .execute();
  const used = await usedBy(
    ctx,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toPreset(r, used.get(r.id) ?? []));
}

export async function get(ctx: Ctx, id: string): Promise<Preset> {
  const found = await row(ctx, id);
  return toPreset(found, (await usedBy(ctx, [id])).get(id) ?? []);
}

export async function create(ctx: Ctx, input: unknown): Promise<Preset> {
  const data = checkBody(PresetCreateSchema, input);
  await projects.get(ctx, data.projectId);
  const id = newId();
  await db
    .insertInto('presets')
    .values({
      id,
      project_id: data.projectId,
      name: data.name,
      values: json(data.values) ?? '{}',
      created_at: ctx.now,
      updated_at: ctx.now,
    })
    .execute();
  return get(ctx, id);
}

/** Renames a preset, or saves new values into it. */
export async function update(ctx: Ctx, id: string, input: unknown): Promise<Preset> {
  const patch = checkBody(PresetUpdateSchema, input);
  await row(ctx, id);
  await db
    .updateTable('presets')
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.values !== undefined && { values: json(patch.values) ?? '{}' }),
      updated_at: ctx.now,
    })
    .where('id', '=', id)
    .execute();
  return get(ctx, id);
}

/** Deletes a preset. Schedules that used it keep their own copy of the values. */
export async function remove(ctx: Ctx, id: string): Promise<void> {
  await row(ctx, id);
  await db.deleteFrom('presets').where('id', '=', id).execute();
}
