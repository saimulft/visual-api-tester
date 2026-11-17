import { PassThrough, Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { ExportFormat } from '@/contracts/datasets';
import { columnsOf, csvCell, flattenRecord, type Column } from '@/contracts/rows';
import { db, parseJson } from '../db';

/**
 * Exports, streamed a page at a time so a big dataset never sits in memory: CSV (also the live link),
 * Excel through ExcelJS's streaming writer, and JSON (the records as they came, or the picked columns).
 */
const PAGE = 1000;
const ColumnsSchema = z.array(z.object({ key: z.string(), label: z.string(), type: z.string() })).catch([]);

export type ExportSource = { id: string; name: string; columns: string };

/** The dataset's rows, oldest first, one page at a time. */
async function* pages(datasetId: string): AsyncGenerator<unknown[]> {
  let after = 0;
  for (;;) {
    const rows = await db
      .selectFrom('dataset_rows')
      .select(['id', 'data'])
      .where('dataset_id', '=', datasetId)
      .where('id', '>', after)
      .orderBy('id')
      .limit(PAGE)
      .execute();
    if (!rows.length) return;
    after = Number(rows[rows.length - 1].id);
    yield rows.map((r) => JSON.parse(r.data) as unknown);
    if (rows.length < PAGE) return;
  }
}

/** The columns to export: the picked keys in the dataset's order, or all of them. */
export function pickColumns(source: ExportSource, keys?: string[] | null): Column[] {
  const all = parseJson(ColumnsSchema, source.columns) as Column[];
  if (!keys?.length) return all;
  const wanted = new Set(keys);
  const picked = all.filter((c) => wanted.has(c.key));
  return picked.length ? picked : all;
}

/** A file name from the dataset's name: "au-software-50-to-200-staff.csv". */
export function fileName(name: string, format: ExportFormat): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'dataset';
  return `${slug}.${format}`;
}

export function csvStream(source: ExportSource, columns: Column[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = pages(source.id);
  let headerSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(encoder.encode(`${columns.map((c) => csvCell(c.label)).join(',')}\r\n`));
        return;
      }
      const next = await iterator.next();
      if (next.done) return controller.close();
      const lines = next.value.map((record) => {
        const flat = flattenRecord(record);
        return columns.map((c) => csvCell(flat[c.key])).join(',');
      });
      controller.enqueue(encoder.encode(`${lines.join('\r\n')}\r\n`));
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

export function jsonStream(source: ExportSource, columns: Column[] | null): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = pages(source.id);
  let first = true;
  let opened = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!opened) {
        opened = true;
        controller.enqueue(encoder.encode('['));
        return;
      }
      const next = await iterator.next();
      if (next.done) {
        controller.enqueue(encoder.encode(first ? ']' : '\n]\n'));
        return controller.close();
      }
      const items = next.value.map((record) => {
        if (!columns) return JSON.stringify(record);
        const flat = flattenRecord(record);
        return JSON.stringify(Object.fromEntries(columns.map((c) => [c.key, flat[c.key] ?? null])));
      });
      controller.enqueue(encoder.encode(`${first ? '\n' : ',\n'}${items.join(',\n')}`));
      first = false;
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

export function xlsxStream(source: ExportSource, columns: Column[]): ReadableStream<Uint8Array> {
  const out = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  const sheet = workbook.addWorksheet(source.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ') || 'Data');
  sheet.columns = columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: Math.min(40, Math.max(10, c.label.length + 2)),
  }));
  sheet.getRow(1).font = { bold: true };
  (async () => {
    try {
      for await (const page of pages(source.id))
        for (const record of page) {
          const flat = flattenRecord(record);
          sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, flat[c.key] ?? null]))).commit();
        }
      sheet.commit();
      await workbook.commit();
    } catch (error) {
      out.destroy(error as Error);
    }
  })();
  return Readable.toWeb(out) as ReadableStream<Uint8Array>;
}

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** A download response for a dataset in one format. */
export function exportResponse(
  source: ExportSource,
  format: ExportFormat,
  keys: string[] | null,
  opts: { attachment?: boolean } = { attachment: true },
): Response {
  const columns = pickColumns(source, keys);
  const body =
    format === 'csv'
      ? csvStream(source, columns)
      : format === 'json'
        ? jsonStream(source, keys?.length ? columns : null)
        : xlsxStream(source, columns);
  const headers: Record<string, string> = {
    'content-type': CONTENT_TYPES[format],
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (opts.attachment !== false)
    headers['content-disposition'] = `attachment; filename="${fileName(source.name, format)}"`;
  return new Response(body, { headers });
}

/** A run's own rows as a file (the workspace's Download): every row while the run is in memory, else its sample. */
export async function recordsResponse(name: string, records: unknown[], format: ExportFormat): Promise<Response> {
  const flat = records.map((r) => flattenRecord(r));
  const columns = columnsOf(flat.slice(0, 500));
  let body: BodyInit;
  if (format === 'json') body = JSON.stringify(records, null, 2);
  else if (format === 'csv')
    body = [
      columns.map((c) => csvCell(c.label)).join(','),
      ...flat.map((row) => columns.map((c) => csvCell(row[c.key])).join(',')),
    ].join('\r\n');
  else {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ') || 'Run');
    sheet.columns = columns.map((c) => ({
      header: c.label,
      key: c.key,
      width: Math.min(40, Math.max(10, c.label.length + 2)),
    }));
    sheet.getRow(1).font = { bold: true };
    for (const row of flat) sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, row[c.key] ?? null])));
    body = new Uint8Array(await workbook.xlsx.writeBuffer());
  }
  return new Response(body, {
    headers: {
      'content-type': CONTENT_TYPES[format],
      'content-disposition': `attachment; filename="${fileName(name, format)}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
