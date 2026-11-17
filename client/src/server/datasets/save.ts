import { sql } from 'kysely';
import { z } from 'zod';
import { errors } from '@/contracts/common';
import { columnsOf, flattenRecord, type Column } from '@/contracts/rows';
import { changed, db, dialect, json, parseJson, transaction } from '../db';
import type { SaveMode } from '../db/schema';
import { readPath } from '../runner/paths';
import type { Ctx } from '../services/context';

/**
 * Saving a run's records into a dataset, in its save mode:
 * - append: add new rows, skipping repeats on the dataset's key_path (the unique row_key index does the
 *   skipping, so two saves at once can't double a row), and count the repeats;
 * - replace: the run's rows become the whole dataset;
 * - keep: every run's rows stay, side by side.
 * Rows, bytes, runs and the columns are kept current on `datasets`.
 */
const ColumnsSchema = z
  .array(z.object({ key: z.string(), label: z.string(), type: z.string() }))
  .catch([]) as unknown as z.ZodType<Column[]>;

export type SaveOutcome = { newRows: number; skipped: number; rows: number; bytes: number };

const BATCH = 200;

/** The row key a record is matched on, or null when the dataset has no key or the record lacks it. */
export function rowKeyOf(record: unknown, keyPath: string | null): string | null {
  if (!keyPath) return null;
  const value = readPath(record, keyPath);
  if (typeof value === 'string' && value) return value.slice(0, 500);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Recounts rows and bytes from dataset_rows. */
export async function recount(datasetId: string): Promise<{ rows: number; bytes: number }> {
  const length = dialect === 'postgres' ? sql<number>`octet_length(data)` : sql<number>`length(data)`;
  const totals = await db
    .selectFrom('dataset_rows')
    .select((eb) => [eb.fn.countAll<number>().as('rows'), eb.fn.sum<number>(length).as('bytes')])
    .where('dataset_id', '=', datasetId)
    .executeTakeFirst();
  return { rows: Number(totals?.rows ?? 0), bytes: Number(totals?.bytes ?? 0) };
}

/**
 * Saves records into one of the person's datasets. `mode` overrides the dataset's own save mode for this
 * save (the Save to dataset dialog), and becomes its mode from then on.
 */
export async function saveRecords(
  ctx: Ctx,
  datasetId: string,
  input: { runId: string | null; records: unknown[]; mode?: SaveMode; skippedBefore?: number },
): Promise<SaveOutcome> {
  return transaction(async () => {
    const dataset = await db
      .selectFrom('datasets')
      .selectAll()
      .where('id', '=', datasetId)
      .where('user_id', '=', ctx.user.id)
      .executeTakeFirst();
    if (!dataset) throw errors.notFound('That dataset');
    const mode = input.mode ?? dataset.save_mode;
    const keyPath = mode === 'keep' ? null : dataset.key_path;

    if (mode === 'replace') await db.deleteFrom('dataset_rows').where('dataset_id', '=', datasetId).execute();

    // Repeats inside this one run are skipped too, before they reach the database. The runner may have
    // skipped some already, before collecting them.
    const seen = new Set<string>();
    let skipped = input.skippedBefore ?? 0;
    const rows: { dataset_id: string; run_id: string | null; row_key: string | null; data: string; created_at: number }[] =
      [];
    for (const record of input.records) {
      const key = rowKeyOf(record, keyPath);
      if (key !== null) {
        if (seen.has(key)) {
          skipped++;
          continue;
        }
        seen.add(key);
      }
      rows.push({ dataset_id: datasetId, run_id: input.runId, row_key: key, data: json(record) ?? 'null', created_at: ctx.now });
    }

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const result = await db
        .insertInto('dataset_rows')
        .values(batch)
        .onConflict((oc) => oc.doNothing())
        .executeTakeFirst();
      inserted += Number(result?.numInsertedOrUpdatedRows ?? batch.length);
    }
    skipped += rows.length - inserted;

    const known = parseJson(ColumnsSchema, dataset.columns);
    const columns = columnsOf(input.records.slice(0, 500).map((r) => flattenRecord(r)), known);
    const totals = await recount(datasetId);
    const update = await db
      .updateTable('datasets')
      .set({
        rows: totals.rows,
        bytes: totals.bytes,
        runs: Number(dataset.runs) + 1,
        repeats_skipped: Number(dataset.repeats_skipped) + skipped,
        columns: json(columns) ?? '[]',
        save_mode: mode,
        updated_at: ctx.now,
      })
      .where('id', '=', datasetId)
      .where('user_id', '=', ctx.user.id)
      .executeTakeFirst();
    if (changed(update) !== 1) throw errors.notFound('That dataset');
    return { newRows: inserted, skipped, rows: totals.rows, bytes: totals.bytes };
  });
}
