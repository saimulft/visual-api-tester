import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { AiKeysPanel } from '@/components/settings/ai-keys-panel';
import { ApiKeysPanel } from '@/components/settings/api-keys-panel';
import { McpPanel } from '@/components/settings/mcp-panel';
import { baseUrlFrom, resourceUrl } from '@/server/oauth';
import { aiKeys, mcp, settings } from '@/server/services';
import { pageCtx } from '@/server/services/page-context';

export const metadata: Metadata = { title: 'AI and keys' };

/** Settings › AI and keys (the drawn tab): the built-in assistant's keys, the API key vault and the MCP server. */
export default async function AiSettingsPage() {
  const ctx = await pageCtx('/settings/ai');
  const [keys, vault, clients] = await Promise.all([aiKeys.list(ctx), settings.apiKeyRows(ctx), mcp.clients(ctx)]);
  const address = resourceUrl(baseUrlFrom(await headers()), ctx.user.mcpHandle);
  return (
    <div className="set-cols">
      <div className="set-col">
        <AiKeysPanel initial={keys} />
        <ApiKeysPanel initial={vault.keys} keyless={vault.keyless} />
      </div>
      <div className="set-col">
        <McpPanel address={address} initialClients={clients} />
      </div>
    </div>
  );
}
