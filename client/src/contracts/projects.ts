import { z } from 'zod';
import type { ApiSpec } from './spec';

/** Projects: one API, its key, the AI's spec and how it's run. */

export const PROJECT_STATUSES = ['draft', 'waiting', 'setting_up', 'ready', 'failed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const SETUP_VIA = ['builtin', 'mcp'] as const;
export type SetupVia = (typeof SETUP_VIA)[number];

export type Project = {
  id: string;
  name: string;
  apiName: string;
  apiSlug: string;
  monogram: string;
  docsUrl: string;
  apiKeyId: string | null;
  brief: string;
  setupVia: SetupVia;
  status: ProjectStatus;
  spec: ApiSpec | null;
  specVersion: number;
  creditLimit: number;
  lastRunAt: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/** A project in a list: everything but the spec, plus how many controls it has. */
export type ProjectSummary = Omit<Project, 'spec'> & { channels: number; controls: number };

const name = z.string().trim().min(1, 'Give the project a name.').max(80, 'Keep the name under 80 characters.');
const monogram = z
  .string()
  .trim()
  .max(3, 'A monogram is up to 3 letters.')
  .transform((v) => v.toUpperCase());
const docsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || (/^https?:\/\//.test(v) && URL.canParse(v)), 'Enter the full docs address, starting https://.');

export const ProjectCreateSchema = z.object({
  name,
  apiName: z.string().trim().max(80).default(''),
  apiSlug: z
    .string()
    .trim()
    .max(48)
    .regex(/^[a-z0-9-]*$/, 'The API slug uses lowercase letters, digits and "-".')
    .default(''),
  monogram: monogram.optional(),
  docsUrl: docsUrl.default(''),
  apiKeyId: z.string().nullable().optional(),
  brief: z.string().trim().max(4000, 'Keep the instruction under 4,000 characters.').default(''),
  setupVia: z.enum(SETUP_VIA).default('builtin'),
  creditLimit: z.number().int().min(0).max(10_000_000).default(1000),
});
export type ProjectCreateInput = z.input<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = z
  .object({
    name,
    apiName: z.string().trim().max(80),
    apiSlug: z.string().trim().max(48).regex(/^[a-z0-9-]*$/),
    monogram,
    docsUrl,
    apiKeyId: z.string().nullable(),
    brief: z.string().trim().max(4000),
    setupVia: z.enum(SETUP_VIA),
    status: z.enum(PROJECT_STATUSES),
    creditLimit: z.number().int().min(0).max(10_000_000),
  })
  .partial();
export type ProjectUpdateInput = z.input<typeof ProjectUpdateSchema>;

/** "Store weather" becomes "SW"; one word gives its first two letters. */
export function monogramOf(text: string): string {
  const words = text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'AP';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
