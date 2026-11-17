import { z } from 'zod';
import { ValuesSchema, type Values } from './spec';
import type { RunSummary } from './workspace';

/** Schedules (chat B): a project's run, repeated hourly, daily, weekly or monthly, in a time zone. */

export const CADENCES = ['hourly', 'daily', 'weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];

export type Schedule = {
  id: string;
  projectId: string;
  projectName: string;
  apiName: string;
  monogram: string;
  presetId: string | null;
  presetName: string | null;
  values: Values;
  datasetId: string | null;
  datasetName: string | null;
  datasetMode: 'append' | 'replace' | 'keep' | null;
  name: string;
  cadence: Cadence;
  /** Weekdays, 0 (Sunday) to 6. */
  days: number[];
  dayOfMonth: number | null;
  /** "HH:MM" in the schedule's time zone. */
  time: string;
  timezone: string;
  creditLimit: number;
  /** Credits one record costs on this project's run (0 when free), for "600 · 30 records". */
  creditsPerRecord: number;
  creditUnit: string;
  emailOnFail: boolean;
  emailCsv: boolean;
  status: 'on' | 'paused';
  /** The LED: on, paused, or failed when the last run failed. */
  state: 'on' | 'paused' | 'failed';
  pausedAt: number | null;
  nextRunAt: number | null;
  lastRun: RunSummary | null;
  createdAt: number;
  updatedAt: number;
};

const time = z.string({ error: 'Pick a time.' }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Pick a time, like 09:00.');

export const ScheduleUpsertSchema = z
  .object({
    id: z.string().optional(),
    projectId: z.string().min(1, 'Pick a project.'),
    presetId: z.string().nullable().optional(),
    values: ValuesSchema.optional(),
    datasetId: z.string().nullable().optional(),
    name: z.string().trim().max(80, 'Keep the name under 80 characters.').optional(),
    cadence: z.enum(CADENCES, { error: 'Pick how often.' }),
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    dayOfMonth: z
      .number()
      .int()
      .min(1, 'Pick a day from 1 to 28.')
      .max(28, 'Pick a day from 1 to 28.')
      .nullable()
      .optional(),
    time: time.default('09:00'),
    timezone: z.string().min(1).max(64),
    creditLimit: z.number().int().min(0, 'The limit can’t be below 0.').max(10_000_000),
    emailOnFail: z.boolean().default(true),
    emailCsv: z.boolean().default(false),
    status: z.enum(['on', 'paused']).default('on'),
  })
  .superRefine((value, ctx) => {
    if (value.cadence === 'weekly' && !value.days.length)
      ctx.addIssue({ code: 'custom', path: ['days'], message: 'Pick at least one day.' });
    if (value.cadence === 'monthly' && !value.dayOfMonth)
      ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'Pick a day of the month.' });
  });
export type ScheduleUpsertInput = z.input<typeof ScheduleUpsertSchema>;

/** One upcoming run, for "Next three runs". */
export type NextRun = { at: number; label: string; inText: string };
