'use client';

import { useEffect, useState } from 'react';
import { api } from '@/components/auth/api';

export type McpStatusView = { connected: boolean; clientName: string | null; lastUsedAt: number | null };

/**
 * Whether an AI is connected over MCP. Polls /api/mcp-status every 3 s until one connects, so screens 02 and
 * 04 turn to connected by themselves. Stops polling while the tab is hidden.
 */
export function useMcpStatus(initial: McpStatusView, opts: { poll?: boolean } = {}) {
  const [status, setStatus] = useState(initial);
  const poll = (opts.poll ?? true) && !status.connected;
  useEffect(() => {
    if (!poll) return;
    let stopped = false;
    const tick = async () => {
      if (document.hidden) return;
      const result = await api<{ status: McpStatusView }>('/api/mcp-status');
      if (!stopped && result.ok) setStatus(result.data.status);
    };
    const timer = setInterval(tick, 3_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [poll]);
  return status;
}
