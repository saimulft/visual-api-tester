import { z } from 'zod';

/** Accounts: sign up, log in, the email check, resets and the signed-in person. */

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

export const EmailSchema = z
  .string({ error: 'Enter your email.' })
  .trim()
  .min(1, 'Enter your email.')
  .max(254, 'That email is too long.')
  .email('That email doesn’t look right.')
  .transform((v) => v.toLowerCase());

export const PasswordSchema = z
  .string({ error: 'Enter a password.' })
  .min(PASSWORD_MIN, `Use ${PASSWORD_MIN} or more characters.`)
  .max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`);

export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string; hint: string };

/**
 * The strength line under the password field: four bars and a word. Under 12 characters it's never more
 * than one bar. Longer passwords and more kinds of characters (lower, upper, digits, symbols) score higher.
 */
export function passwordStrength(password: string): Strength {
  const hint = `Use ${PASSWORD_MIN} or more characters.`;
  if (!password) return { score: 0, label: '', hint };
  if (password.length < PASSWORD_MIN) return { score: 1, label: 'Too short', hint };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const repeats = /(.)\1{3,}/.test(password) || new Set(password).size < 6;
  let score = 2 + (kinds >= 3 ? 1 : 0) + (password.length >= 16 && kinds >= 2 ? 1 : 0);
  if (repeats) score = 2;
  const label = score >= 4 ? 'Very strong' : score === 3 ? 'Strong' : 'Fair';
  return { score: Math.min(4, score) as Strength['score'], label, hint };
}

export const SignUpSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  /** The browser's IANA time zone. */
  timezone: z.string().max(80).optional(),
});
export type SignUpInput = z.input<typeof SignUpSchema>;

export const LogInSchema = z.object({
  email: EmailSchema,
  password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.').max(PASSWORD_MAX),
});
export type LogInInput = z.input<typeof LogInSchema>;

export const EmailOnlySchema = z.object({ email: EmailSchema });

export const TokenSchema = z.object({ token: z.string().min(10, 'That link isn’t complete.').max(200) });

export const ResetSchema = z.object({
  token: z.string().min(10, 'That link isn’t complete.').max(200),
  password: PasswordSchema,
});

export const ChangePasswordSchema = z.object({
  current: z.string().min(1, 'Enter your current password.').max(PASSWORD_MAX),
  password: PasswordSchema,
});

export const ChangeEmailSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, 'Enter your password to change your email.').max(PASSWORD_MAX),
});

export const DeleteAccountSchema = z.object({
  password: z.string().min(1, 'Enter your password to delete your account.').max(PASSWORD_MAX),
});

/** The signed-in person, as the browser sees them. */
export type Me = {
  id: string;
  email: string;
  name: string;
  initials: string;
  workspace: string;
  timezone: string;
  emailChecked: boolean;
  mcpHandle: string;
  alertEmail: string | null;
  alertsMuted: boolean;
  createdAt: number;
};

/** "Nadia Rahman" becomes "NR"; with no name, the email's first letters. */
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

const PUBLIC_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'gmx.com',
  'fastmail.com',
  'hey.com',
]);
const SECOND_LEVEL = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'ac', 'id']);

/**
 * The workspace name from an email's domain: `brightfield.com.au` becomes "Brightfield". Public mail
 * domains (gmail.com and the like) give "My workspace".
 */
export function workspaceFromEmail(email: string): string {
  const domain = email.split('@')[1]?.toLowerCase().trim() ?? '';
  if (!domain || PUBLIC_MAIL.has(domain)) return 'My workspace';
  const parts = domain.split('.').filter(Boolean);
  while (parts.length > 2 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]))
    parts.splice(parts.length - 2, 2);
  if (parts.length > 1) parts.pop();
  const label = parts[parts.length - 1] ?? '';
  if (!label) return 'My workspace';
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
