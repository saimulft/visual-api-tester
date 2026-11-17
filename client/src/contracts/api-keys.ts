import { z } from 'zod';

/** Saved API keys. The secret goes in once and never comes back out: the browser sees the last four only. */
export type ApiKey = {
  id: string;
  apiSlug: string;
  apiName: string;
  /** The one host this key may be sent to, like "api.coresignal.com". */
  host: string;
  label: string;
  last4: string;
  /** "••••1234" */
  masked: string;
  creditsLeft: number | null;
  creditsCheckedAt: number | null;
  lastTestAt: number | null;
  lastTestOk: boolean | null;
  createdAt: number;
  updatedAt: number;
};

/** "https://api.coresignal.com/cdapi/v2" or "api.coresignal.com" becomes "api.coresignal.com". */
export function hostOf(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.host || null;
  } catch {
    return null;
  }
}

const secret = z
  .string({ error: 'Paste the key.' })
  .trim()
  .min(8, 'That key looks too short. Paste the whole key.')
  .max(4000, 'That key is too long.');

export const ApiKeyCreateSchema = z.object({
  apiSlug: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9-]+$/, 'The API slug uses lowercase letters, digits and "-".'),
  apiName: z.string().trim().min(1, 'Name the API.').max(80),
  host: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const host = hostOf(v);
      if (!host) ctx.addIssue({ code: 'custom', message: 'Give the API’s address, like api.example.com.' });
      return host ?? '';
    }),
  label: z.string().trim().max(60).default(''),
  secret,
});
export type ApiKeyCreateInput = z.input<typeof ApiKeyCreateSchema>;

export const ApiKeyReplaceSchema = z.object({ secret, label: z.string().trim().max(60).optional() });
