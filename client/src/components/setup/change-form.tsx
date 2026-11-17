'use client';

import { AlertCircle, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/components/auth/api';
import { Button, Textarea } from '@/components/ui';
import { DetailHead } from '../new-project/detail-head';

/**
 * Asking the AI for changes (?change=1 from the workspace), or setting up a project that has no setup yet: the
 * brief and who does it, in the New project form's parts. The new setup starts from the current spec, so the
 * person's values keep working.
 */
export function ChangeForm({
  projectId,
  projectName,
  hasSpec,
  canBuiltin,
  modelName,
  mcpClient,
  defaultVia,
}: {
  projectId: string;
  projectName: string;
  hasSpec: boolean;
  canBuiltin: boolean;
  modelName: string | null;
  mcpClient: string | null;
  defaultVia: 'builtin' | 'mcp';
}) {
  const router = useRouter();
  const [brief, setBrief] = useState('');
  const [via, setVia] = useState<'builtin' | 'mcp'>(canBuiltin ? defaultVia : 'mcp');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await api<{ setupId: string }>(`/api/setup/project/${projectId}`, { brief, via });
    if (!res.ok) {
      setBusy(false);
      return setError(res.error.message);
    }
    router.replace(`/projects/${projectId}/setup`);
    router.refresh();
  };

  return (
    <>
      <DetailHead
        crumbs={[{ label: 'Projects', href: '/projects' }, { label: projectName }]}
        title={hasSpec ? 'Ask the AI for changes' : 'Set up this project'}
        actions={
          <Link className="btn btn-sm btn-ghost" href={hasSpec ? `/projects/${projectId}` : '/projects'}>
            Cancel
          </Link>
        }
        back={hasSpec ? `/projects/${projectId}` : '/projects'}
      />
      <div className="page">
        <div className="page-in">
          <div className="np">
            <form
              className="np-form"
              aria-label="Ask for changes"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="q">
                <label className="q-label" htmlFor="ch-brief">
                  {hasSpec ? 'What should change?' : 'Tell the AI what you want'}
                </label>
                <Textarea
                  id="ch-brief"
                  value={brief}
                  placeholder={
                    hasSpec
                      ? 'Add a filter for funding stage, and drop the date filter.'
                      : 'Say what you want to see, which places, sizes or dates matter, and how often you need it.'
                  }
                  onChange={(e) => setBrief(e.target.value)}
                />
                {hasSpec && (
                  <p className="hint">Your controls and values stay as they are unless you ask to change them.</p>
                )}
              </div>
              <div className="q">
                <span className="q-label">Who does it?</span>
                <div className="choices">
                  <button className="choice" type="button" aria-pressed={via === 'mcp'} onClick={() => setVia('mcp')}>
                    <span className="radio" />
                    <span>
                      <strong>{mcpClient ? `${mcpClient}, through MCP` : 'Your own AI, through MCP'}</strong>
                      <span className="hint">
                        {mcpClient
                          ? `${mcpClient} is connected. You’ll watch it work here.`
                          : 'The setup waits until you ask your AI to start.'}
                      </span>
                    </span>
                  </button>
                  <button
                    className="choice"
                    type="button"
                    aria-pressed={via === 'builtin'}
                    onClick={() => setVia('builtin')}
                  >
                    <span className="radio" />
                    <span>
                      <strong>Built-in assistant</strong>
                      <span className="hint">
                        {canBuiltin ? `Uses ${modelName}.` : 'Add an AI key in Settings to use it.'}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
              {error && (
                <div className="ok-line is-err" role="alert">
                  <AlertCircle className="i" aria-hidden="true" />
                  {error}
                </div>
              )}
              <div className="np-actions">
                <span className="hint">Nothing is spent: the AI tests free calls only.</span>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  busy={busy}
                  disabled={busy || brief.trim().length < 5}
                  tile={<Sparkles className="i" aria-hidden="true" />}
                >
                  {hasSpec ? 'Ask for changes' : 'Set up project'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
