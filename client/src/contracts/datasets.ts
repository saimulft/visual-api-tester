import { z } from 'zod';
import type { Column, FlatRow } from './rows';

/** Saved data (chat B): datasets of rows kept from runs, their exports and the live CSV link. */

export const SAVE_MODES = ['append', 'replace', 'keep'] as const;
export type SaveModeName = (typeof SAVE_MODES)[number];

/** How a dataset is fed: a schedule's cadence, or by hand. */
export type DatasetSource = {
  scheduleId: string | null;
  scheduleName: string | null;
  cadence: 'hourly' | 'daily' | 'weekly' | 'monthly' | null;
  /** The schedule's LED: on, paused, or failed when its last run failed. */
  state: 'on' | 'paused' | 'failed' | 'manual';
};

export type DatasetSummary = {
  id: string;
  projectId: string;
  projectName: string;
  apiName: string;
  monogram: string;
  name: string;
  saveMode: SaveModeName;
  keyPath: string | null;
  keyLabel: string | null;
  columns: Column[];
  rows: number;
  bytes: number;
  runs: number;
  repeatsSkipped: number;
  /** True when the live CSV link is on. */
  csvOn: boolean;
  source: DatasetSource;
  createdAt: number;
  updatedAt: number;
};

export type Dataset = DatasetSummary & {
  /** The live link's address, when it's on. */
  csvUrl: string | null;
  /** New rows per saved run, oldest first (the bars). */
  perRun: { runId: string | null; at: number; newRows: number }[];
  /** "companies", from the run's take control, for "Skips companies already saved". */
  noun: string;
};

export type DatasetRowsPage = {
  columns: Column[];
  rows: (FlatRow & { _at: number; _run: string | null })[];
  total: number;
  page: number;
  pageSize: number;
};

const name = z
  .string({ error: 'Name the dataset.' })
  .trim()
  .min(1, 'Name the dataset.')
  .max(80, 'Keep the name under 80 characters.');
const keyPath = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .transform((v) => (v ? v : null));

export const DatasetCreateSchema = z.object({
  projectId: z.string().min(1, 'Pick a project.'),
  name,
  saveMode: z.enum(SAVE_MODES).default('append'),
  keyPath: keyPath.optional(),
  keyLabel: z.string().trim().max(80).nullable().optional(),
  /** Save this run's rows straight away. */
  runId: z.string().nullable().optional(),
});

export const DatasetUpdateSchema = z
  .object({ name, saveMode: z.enum(SAVE_MODES), keyPath, keyLabel: z.string().trim().max(80).nullable() })
  .partial();

export const SaveRunSchema = z.object({
  runId: z.string().min(1),
  mode: z.enum(SAVE_MODES).optional(),
});

export const EXPORT_FORMATS = ['csv', 'xlsx', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The result of saving a run into a dataset. */
export type SaveResult = { newRows: number; skipped: number; rows: number; fromSample: boolean };
