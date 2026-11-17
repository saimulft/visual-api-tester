import { z } from 'zod';

/** What one run did, as the workspace, the history and MCP show it (chat B's runner returns it). */

export const RUN_STATUSES = ['running', 'ok', 'partial', 'failed', 'stopped'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_TRIGGERS = ['manual', 'schedule', 'mcp', 'test'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/** One HTTP call a run or test made. The URL and headers have every key masked ("••••1234"). */
export const RunRequestLogSchema = z.object({
  endpointId: z.string(),
  method: z.enum(['GET', 'POST']),
  url: z.string(),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().nullable().default(null),
  status: z.number().int().nullable(),
  ms: z.number().nonnegative(),
  bytes: z.number().int().nonnegative(),
  records: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative().default(0),
  error: z.string().nullable().default(null),
  at: z.number(),
});
export type RunRequestLog = z.infer<typeof RunRequestLogSchema>;

/** One record as a flat-ish JSON object. */
export type RecordRow = Record<string, unknown>;

/** A friendly error: a stable code and a sentence for people ("CoreSignal said slow down, so we retried"). */
export type RunError = { code: string; text: string };

export type RunResult = {
  runId: string;
  projectId: string;
  status: RunStatus;
  trigger: RunTrigger;
  /** The API's own match count, when it reports one. */
  matches: number | null;
  rows: number;
  newRows: number;
  credits: number;
  httpStatus: number | null;
  retries: number;
  datasetId: string | null;
  error: RunError | null;
  requests: RunRequestLog[];
  /** The first rows, capped, for the results stage. */
  sample: RecordRow[];
  startedAt: number;
  finishedAt: number | null;
};

/** A test call on a free endpoint (the AI's check, and "Test" on the setup page). */
export type TestResult = {
  ok: boolean;
  endpointId: string;
  status: number | null;
  ms: number;
  records: number;
  total: number | null;
  /** Field paths seen in the records, for picking columns and ids. */
  fields: string[];
  sample: RecordRow[];
  request: RunRequestLog;
  error: RunError | null;
};

/** What a run would cost before it spends anything (the Run module's live line). */
export type RunPreview = { matches: number | null; take: number; credits: number };

/** How many sample rows a run keeps. */
export const SAMPLE_ROWS = 50;
