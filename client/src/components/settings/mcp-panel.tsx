'use client';

import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/components/auth/api';
import { Button, CopyField, Dialog, toast } from '@/components/ui';
import { CONNECT_STEPS, ConnectSteps, MCP_TOOLS, type ConnectClient } from '../onboarding/connect-steps';
import { ago } from './subnav';

/**
 * MCP server: the person's address with Copy, the connected AIs with when they were last used and Disconnect,
 * How to connect for the others, the seven tools, and New address, which signs every AI out.
 */
export type McpClientView = { clientId: string; clientName: string; connectedAt: number; lastUsedAt: number | null };

const KNOWN: ConnectClient[] = ['claude', 'chatgpt', 'cursor'];
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'AI';

export function McpPanel({
  address: initialAddress,
  initialClients,
}: {
  address: string;
  initialClients: McpClientView[];
}) {
  const [address, setAddress] = useState(initialAddress);
  const [clients, setClients] = useState(initialClients);
  const [how, setHow] = useState<ConnectClient | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const disconnect = async (c: McpClientView) => {
    setBusy(c.clientId);
    const res = await api(`/api/settings/mcp/clients/${encodeURIComponent(c.clientId)}`, undefined, {
      method: 'DELETE',
    });
    setBusy(null);
    if (!res.ok) return toast.error(res.error.message);
    setClients((list) => list.filter((x) => x.clientId !== c.clientId));
    toast.success(`${c.clientName} is disconnected.`);
  };
  const renew = async () => {
    setBusy('renew');
    const res = await api<{ address: string }>('/api/settings/mcp/new-address', {});
    setBusy(null);
    setRenewing(false);
    if (!res.ok) return toast.error(res.error.message);
    setAddress(res.data.address);
    setClients([]);
    toast.success('New address made. Every AI using the old one is signed out.');
  };

  const connectedNames = clients.map((c) => c.clientName.toLowerCase());
  const others = KNOWN.filter((k) => !connectedNames.some((n) => n.includes(CONNECT_STEPS[k].name.toLowerCase())));

  return (
    <section className="panel" aria-labelledby="h-mcp">
      <div className="panel-head">
        <h2 className="panel-title grow" id="h-mcp">
          MCP server
        </h2>
        <span className="chip is-ai">
          <span className={clients.length ? 'led is-ai' : 'led is-off'} />
          {clients.length ? `${clients.length} AI connected` : 'No AI connected'}
        </span>
      </div>
      <p className="hint">Let Claude, ChatGPT or Cursor set up and run your projects. No AI key needed.</p>
      <div className="field">
        <span className="label">Your address</span>
        <CopyField value={address} />
      </div>
      <div className="krows">
        {clients.map((c) => (
          <div className="krow" key={c.clientId}>
            <span className="mtile sm is-ai" aria-hidden="true">
              {initialsOf(c.clientName)}
            </span>
            <div className="grow">
              <div className="krow-title">
                {c.clientName}
                <span className="led is-ai" />
              </div>
              <p className="krow-sub">
                {c.lastUsedAt ? `Last used ${ago(c.lastUsedAt)}` : `Connected ${ago(c.connectedAt)}, not used yet`}
              </p>
            </div>
            <div className="krow-acts">
              <Button
                size="sm"
                variant="ghost"
                className="btn-danger"
                onClick={() => disconnect(c)}
                busy={busy === c.clientId}
              >
                Disconnect
              </Button>
            </div>
          </div>
        ))}
        {others.map((k) => (
          <div className="krow" key={k}>
            <span className="mtile sm" aria-hidden="true">
              {k === 'chatgpt' ? 'CG' : CONNECT_STEPS[k].name[0]}
            </span>
            <div className="grow">
              <div className="krow-title">{CONNECT_STEPS[k].name}</div>
              <p className="krow-sub">Not connected</p>
            </div>
            <div className="krow-acts">
              <Button size="sm" onClick={() => setHow(k)}>
                How to connect
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="field">
        <span className="label">What your AI can do here</span>
        <div className="chips">
          {MCP_TOOLS.map((tool) => (
            <span key={tool} className="chip is-soft mono">
              {tool}
            </span>
          ))}
        </div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Button size="sm" onClick={() => setRenewing(true)}>
          <RefreshCw className="i i-sm" aria-hidden="true" />
          New address
        </Button>
        <span className="hint">Disconnects every AI using the old one.</span>
      </div>

      {how && (
        <Dialog
          open
          onOpenChange={(open) => !open && setHow(null)}
          title={`Connect ${CONNECT_STEPS[how].name}`}
          description="Use your address, then sign in to Dialed when the app asks."
        >
          <div className="field">
            <span className="label">Your address</span>
            <CopyField value={address} />
          </div>
          <ConnectSteps client={how} />
        </Dialog>
      )}
      <Dialog
        open={renewing}
        onOpenChange={setRenewing}
        title="Make a new address?"
        description="Every AI connected to the old address is signed out, and has to connect again with the new one."
        actions={
          <>
            <Button variant="ghost" onClick={() => setRenewing(false)}>
              Keep this address
            </Button>
            <Button variant="danger" onClick={renew} busy={busy === 'renew'}>
              Make a new address
            </Button>
          </>
        }
      />
    </section>
  );
}
