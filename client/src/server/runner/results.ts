import type { RecordRow } from '@/contracts/runs';

/**
 * A run's full records, kept in memory for a while after it finishes, so "Save to dataset" right after a
 * run saves every row (runs.sample holds only the first 256 KB). After a restart, or once a run drops out,
 * saving uses the sample, which holds every row for most manual runs.
 */
type Entry = { userId: string; rows: RecordRow[]; at: number };

const KEEP_MS = 6 * 60 * 60 * 1000;
const MAX_RUNS = 30;
const MAX_ROWS = 200_000;

const globals = globalThis as unknown as { __dialedRunRecords?: Map<string, Entry> };
const store = (globals.__dialedRunRecords ??= new Map<string, Entry>());

function prune() {
  const cutoff = Date.now() - KEEP_MS;
  for (const [id, entry] of store) if (entry.at < cutoff) store.delete(id);
  let rows = [...store.values()].reduce((sum, e) => sum + e.rows.length, 0);
  for (const [id, entry] of store) {
    if (store.size <= MAX_RUNS && rows <= MAX_ROWS) break;
    store.delete(id);
    rows -= entry.rows.length;
  }
}

export function rememberRecords(userId: string, runId: string, rows: RecordRow[]) {
  store.delete(runId);
  store.set(runId, { userId, rows, at: Date.now() });
  prune();
}

/** The run's full records, when they're still in memory and the run is the person's. */
export function recallRecords(userId: string, runId: string): RecordRow[] | null {
  const entry = store.get(runId);
  if (!entry || entry.userId !== userId || entry.at < Date.now() - KEEP_MS) return null;
  return entry.rows;
}
