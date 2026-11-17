import type { Me } from '@/contracts/auth';
import { errors } from '@/contracts/common';
import { db, now, transaction } from '../db';
import type { Ctx } from './context';
import * as users from './users';

/**
 * The person's MCP connections, from oauth_tokens: whether an AI is connected (screens 02 and 04, the Projects
 * KPI), the connected clients in Settings with Disconnect, and "New address", which gives a new handle and signs
 * out every client at once.
 */
export type McpStatus = { connected: boolean; clientName: string | null; lastUsedAt: number | null };

export type McpClient = {
  clientId: string;
  clientName: string;
  connectedAt: number;
  lastUsedAt: number | null;
};

/** Live grants: not revoked, and the refresh token still good. */
function live(ctx: Ctx) {
  return db
    .selectFrom('oauth_tokens')
    .where('user_id', '=', ctx.user.id)
    .where('revoked_at', 'is', null)
    .where((eb) => eb.or([eb('refresh_expires_at', '>', now()), eb('expires_at', '>', now())]));
}

/** For chat B and screens 02 and 04: is an AI connected over MCP, which one, and when it last called. */
export async function mcpStatus(ctx: Ctx): Promise<McpStatus> {
  const rows = await live(ctx).select(['client_name', 'last_used_at', 'created_at']).execute();
  if (!rows.length) return { connected: false, clientName: null, lastUsedAt: null };
  const newest = rows.sort(
    (a, b) => Number(b.last_used_at ?? b.created_at) - Number(a.last_used_at ?? a.created_at),
  )[0];
  return {
    connected: true,
    clientName: newest.client_name || 'Your AI',
    lastUsedAt: newest.last_used_at === null ? null : Number(newest.last_used_at),
  };
}

/** The connected clients, one per app, most recently used first. */
export async function clients(ctx: Ctx): Promise<McpClient[]> {
  const rows = await live(ctx).select(['client_id', 'client_name', 'created_at', 'last_used_at']).execute();
  const byClient = new Map<string, McpClient>();
  for (const r of rows) {
    const seen = byClient.get(r.client_id);
    const lastUsed = r.last_used_at === null ? null : Number(r.last_used_at);
    if (!seen)
      byClient.set(r.client_id, {
        clientId: r.client_id,
        clientName: r.client_name || 'AI app',
        connectedAt: Number(r.created_at),
        lastUsedAt: lastUsed,
      });
    else {
      seen.connectedAt = Math.min(seen.connectedAt, Number(r.created_at));
      if (lastUsed !== null && (seen.lastUsedAt === null || lastUsed > seen.lastUsedAt)) seen.lastUsedAt = lastUsed;
    }
  }
  return [...byClient.values()].sort((a, b) => (b.lastUsedAt ?? b.connectedAt) - (a.lastUsedAt ?? a.connectedAt));
}

/** Disconnect: signs one app out (every grant it holds for this person). */
export async function disconnect(ctx: Ctx, clientId: string): Promise<void> {
  const result = await db
    .updateTable('oauth_tokens')
    .set({ revoked_at: now() })
    .where('user_id', '=', ctx.user.id)
    .where('client_id', '=', clientId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  if (!Number(result.numUpdatedRows)) throw errors.notFound('That connection');
}

/** New address: a new handle, and every token for the old address stops working. */
export async function newAddress(ctx: Ctx): Promise<Me> {
  return transaction(async () => {
    const me = await users.replaceHandle(ctx);
    await db
      .updateTable('oauth_tokens')
      .set({ revoked_at: now() })
      .where('user_id', '=', ctx.user.id)
      .where('revoked_at', 'is', null)
      .execute();
    return me;
  });
}
