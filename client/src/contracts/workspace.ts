import { z } from 'zod';
import type { RunError, RunPreview, RunResult, RunStatus, RunTrigger } from './runs';
import { ValuesSchema, type Values } from './spec';

/** The workspace's calls: run, the live preview, presets and the run history (chat B). */

export const RunStartSchema = z.object({
  projectId: z.string().min(1, 'Pick a project.'),
  values: ValuesSchema.default({}),
  presetId: z.string().nullable().optional(),
  /** Save the rows to this dataset when the run finishes. */
  datasetId: z.string().nullable().optional(),
  /** The credits the person agreed to in the "over your limit" dialog. */
  confirmCredits: z.number().int().nonnegative().optional(),
});
export type RunStartInput = z.input<typeof RunStartSchema>;

export const PreviewInputSchema = z.object({
  projectId: z.string().min(1),
  values: ValuesSchema.default({}),
});

export const TestCallInputSchema = z.object({
  projectId: z.string().min(1),
  endpointId: z.string().min(1),
  values: ValuesSchema.default({}),
});

/** The Run module's live line: the match count (free searches only), the take, the cost and what limits it. */
export type RunPreviewDetail = RunPreview & {
  /** "credits", "calls". */
  unit: string;
  /** True when the run spends nothing. */
  free: boolean;
  /** The project's credit limit: a manual run above it asks first. */
  creditLimit: number;
  /** Credits left on the key, when the API reports them. */
  creditsLeft: number | null;
  /** The spec needs a key and none is saved. */
  needsKey: boolean;
  /** Why there's no live count, when there isn't one. */
  note: string | null;
  /** What Run sends, masked, for the Request tab: one entry per step. */
  requests: RequestView[];
};

/** One request as the Request tab shows it: masked, with what it costs. */
export type RequestView = {
  /** "1 · Search, free". */
  step: string;
  endpointId: string;
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body: string | null;
  /** How many times the step runs (the collect step runs once per record). */
  times: number | null;
};

/** A run in a list: no rows, no request log. */
export type RunSummary = {
  id: string;
  projectId: string;
  projectName: string;
  apiName: string;
  monogram: string;
  trigger: RunTrigger;
  status: RunStatus;
  matches: number | null;
  rows: number;
  newRows: number;
  credits: number;
  httpStatus: number | null;
  retries: number;
  error: RunError | null;
  datasetId: string | null;
  datasetName: string | null;
  scheduleId: string | null;
  scheduleName: string | null;
  presetId: string | null;
  startedAt: number;
  finishedAt: number | null;
};

/** One run in full, with the values it ran with. */
export type RunDetail = RunResult & { values: Values; projectName: string; apiName: string };

// ---------- Presets ----------

export type Preset = {
  id: string;
  projectId: string;
  name: string;
  values: Values;
  /** Schedules that run with it ("Used by the Monday pull"). */
  usedBy: string[];
  createdAt: number;
  updatedAt: number;
};

const presetName = z
  .string({ error: 'Name the preset.' })
  .trim()
  .min(1, 'Name the preset.')
  .max(80, 'Keep the name under 80 characters.');

export const PresetCreateSchema = z.object({ projectId: z.string().min(1), name: presetName, values: ValuesSchema });
export const PresetUpdateSchema = z.object({ name: presetName, values: ValuesSchema }).partial();
