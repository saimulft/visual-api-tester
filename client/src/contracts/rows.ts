/**
 * Records as rows. An API's records are nested JSON; tables, datasets and exports want flat rows with dot
 * columns ("hq.city"). Pure, so the server (datasets, exports) and the browser (the results table) agree.
 */

/** A flat cell: what a CSV or a table cell can hold. */
export type Cell = string | number | boolean | null;
export type FlatRow = Record<string, Cell>;

export const COLUMN_TYPES = ['text', 'number', 'boolean', 'date', 'url', 'json'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
export type Column = { key: string; label: string; type: ColumnType };

/** How deep dot columns go: "a.b.c" at most; deeper objects stay as JSON text in that column. */
export const FLATTEN_DEPTH = 3;
/** The most columns a dataset keeps track of. */
export const MAX_COLUMNS = 200;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function cell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value) && value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)))
    return value.filter((v) => v !== null).join(', ');
  return JSON.stringify(value);
}

/**
 * One record as a flat row. Objects open into dot columns up to FLATTEN_DEPTH; a list of plain values
 * becomes "a, b"; anything deeper stays JSON text. A bare value (an id) becomes { value }.
 */
export function flattenRecord(record: unknown, depth = FLATTEN_DEPTH): FlatRow {
  if (!isPlainObject(record)) return { value: cell(record) };
  const row: FlatRow = {};
  const walk = (node: Record<string, unknown>, prefix: string, level: number) => {
    for (const [key, value] of Object.entries(node)) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (isPlainObject(value) && level < depth && Object.keys(value).length) walk(value, name, level + 1);
      else row[name] = cell(value);
    }
  };
  walk(record, '', 1);
  return row;
}

/** "employees_count" reads "Employees count"; "hq.city" reads "Hq city". */
export function labelOf(key: string): string {
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function typeOf(value: Cell): ColumnType | null {
  if (value === null || value === '') return null;
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (ISO_DATE.test(value)) return 'date';
  if (/^https?:\/\/\S+$/i.test(value)) return 'url';
  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) return 'json';
  return 'text';
}

/** Columns in first-seen order, each typed by the values it holds (mixed values read as text). */
export function columnsOf(rows: FlatRow[], known: Column[] = []): Column[] {
  const types = new Map<string, ColumnType | null>(known.map((c) => [c.key, c.type]));
  const order = known.map((c) => c.key);
  for (const row of rows)
    for (const [key, value] of Object.entries(row)) {
      if (!types.has(key)) {
        if (order.length >= MAX_COLUMNS) continue;
        types.set(key, null);
        order.push(key);
      }
      const seen = typeOf(value);
      const was = types.get(key) ?? null;
      if (seen && was !== seen) types.set(key, was === null ? seen : 'text');
    }
  const labels = new Map(known.map((c) => [c.key, c.label]));
  return order.map((key) => ({ key, label: labels.get(key) ?? labelOf(key), type: types.get(key) ?? 'text' }));
}

/** The first records that fit in maxBytes of JSON. */
export function capRecords<T>(records: T[], maxBytes: number): { kept: T[]; bytes: number } {
  const kept: T[] = [];
  let bytes = 2;
  for (const record of records) {
    const size = JSON.stringify(record ?? null).length + 1;
    if (bytes + size > maxBytes) break;
    kept.push(record);
    bytes += size;
  }
  return { kept, bytes };
}

/** A cell as CSV text: quoted when it holds a comma, a quote or a line break; formulas defused. */
export function csvCell(value: Cell | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // A leading =, +, - or @ would run as a formula in a spreadsheet. Numbers stay as they are.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
