import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { errors } from '@/contracts/common';
import type { Me } from '@/contracts/auth';
import { db } from '../db';
import { check } from '../http/inputs';
import { validTimeZone } from '../jobs/time';
import { toMe, type Ctx } from './context';

/** The person's own profile. Settings (chat A) edits it; everything else reads it through Ctx. */

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A new MCP handle: 12 characters that are easy to read aloud (no 0, o, 1, l or i). */
export function randomHandle(): string {
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** A handle no one has yet. */
export async function freeHandle(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const handle = randomHandle();
    const taken = await db.selectFrom('users').select('id').where('mcp_handle', '=', handle).executeTakeFirst();
    if (!taken) return handle;
  }
  throw new Error('Could not find a free MCP handle.');
}

export async function get(ctx: Ctx): Promise<Me> {
  const row = await db.selectFrom('users').selectAll().where('id', '=', ctx.user.id).executeTakeFirst();
  if (!row) throw errors.notFound('Your account');
  return toMe(row);
}

/** The person behind an MCP handle (the MCP server's address), or null. */
export async function byHandle(handle: string): Promise<Me | null> {
  const row = await db.selectFrom('users').selectAll().where('mcp_handle', '=', handle).executeTakeFirst();
  return row ? toMe(row) : null;
}

export const ProfileUpdateSchema = z
  .object({
    name: z.string().trim().max(80, 'Keep your name under 80 characters.'),
    workspace: z
      .string()
      .trim()
      .min(1, 'Give the workspace a name.')
      .max(60, 'Keep the workspace name under 60 characters.'),
    timezone: z.string().refine((v) => validTimeZone(v) !== null, 'Pick a time zone from the list.'),
    alertEmail: z.string().trim().toLowerCase().email('That email doesn’t look right.').nullable(),
    alertsMuted: z.boolean(),
  })
  .partial();

/** Updates name, workspace, time zone and alert settings. */
export async function update(ctx: Ctx, input: unknown): Promise<Me> {
  const patch = check(ProfileUpdateSchema, input);
  await db
    .updateTable('users')
    .set({
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.workspace !== undefined && { workspace: patch.workspace }),
      ...(patch.timezone !== undefined && { timezone: patch.timezone }),
      ...(patch.alertEmail !== undefined && { alert_email: patch.alertEmail }),
      ...(patch.alertsMuted !== undefined && { alerts_muted: patch.alertsMuted }),
      updated_at: ctx.now,
    })
    .where('id', '=', ctx.user.id)
    .execute();
  return get(ctx);
}

/** "New address": a fresh MCP handle, so the old address stops working. */
export async function replaceHandle(ctx: Ctx): Promise<Me> {
  await db
    .updateTable('users')
    .set({ mcp_handle: await freeHandle(), updated_at: ctx.now })
    .where('id', '=', ctx.user.id)
    .execute();
  return get(ctx);
}
