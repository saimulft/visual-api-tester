'use client';

import { ArrowLeft, ArrowRight, Check, CheckCircle2, KeyRound, Plug } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ButtonLink, Chip, CopyField, Led } from '@/components/ui';
import type { AiSummary } from '@/contracts/ai';
import { ConnectSteps, WORKS_WITH } from './connect-steps';
import { KeyForm } from './key-form';
import { useMcpStatus, type McpStatusView } from './use-mcp-status';

/**
 * Screen 02, Connect your AI (step 2 of 3): both ways side by side and fully visible. Paste a key for the
 * built-in assistant, or connect your own AI over MCP; the MCP side turns to connected by itself.
 */
export function ConnectAi({ summary, address, mcp }: { summary: AiSummary; address: string; mcp: McpStatusView }) {
  const router = useRouter();
  const status = useMcpStatus(mcp);
  const [keys, setKeys] = useState(summary.keys);
  const [way, setChosen] = useState<'key' | 'mcp'>(mcp.connected && !summary.keys ? 'mcp' : 'key');
  // An AI that connects while the page is open becomes the chosen way, unless a key is already saved.
  const [seen, setSeen] = useState(mcp.connected);
  if (status.connected && !seen) {
    setSeen(true);
    if (!keys) setChosen('mcp');
  }

  return (
    <main className="onb-wrap">
      <div>
        <span className="micro">Step 2 of 3</span>
        <h1 className="onb-title" style={{ marginTop: 10 }}>
          Who should set up your APIs?
        </h1>
        <p className="page-sub" style={{ maxWidth: '64ch' }}>
          Dialed uses your own AI to read API docs and build the controls. Pick one way now; you can add the other later
          in Settings.
        </p>
      </div>

      <div className="ways">
        <section
          className={way === 'key' ? 'way is-selected' : 'way'}
          aria-labelledby="way-key"
          onFocusCapture={() => setChosen('key')}
          onPointerDown={() => setChosen('key')}
        >
          <div className="way-head">
            <span className="mtile is-ai lg">
              <KeyRound className="i i-lg" aria-hidden="true" />
            </span>
            <div className="grow">
              <h2 id="way-key">Paste an AI key</h2>
              <p>The built-in assistant sets things up inside Dialed. Your AI provider bills you directly.</p>
            </div>
            {way === 'key' && (
              <Chip tone="on">
                <Check className="i" aria-hidden="true" />
                Chosen
              </Chip>
            )}
          </div>
          {keys > 0 && (
            <div className="ok-line">
              <CheckCircle2 className="i" aria-hidden="true" />
              {keys === 1
                ? `Your ${summary.modelName ?? 'AI'} key is saved. Add another below if you like.`
                : `${keys} keys saved, tried from the top. Add another below if you like.`}
            </div>
          )}
          <KeyForm
            onSaved={(_key, result) => {
              if (result.ok) setKeys((n) => n + 1);
              router.refresh();
            }}
          />
        </section>

        <section
          className={way === 'mcp' ? 'way is-selected' : 'way'}
          aria-labelledby="way-mcp"
          onFocusCapture={() => setChosen('mcp')}
          onPointerDown={() => setChosen('mcp')}
        >
          <div className="way-head">
            <span className="mtile is-signal lg">
              <Plug className="i i-lg" aria-hidden="true" />
            </span>
            <div className="grow">
              <h2 id="way-mcp">Use your own AI with MCP</h2>
              <p>
                Connect the Claude, ChatGPT or Cursor you already pay for. That AI sets up your APIs. No AI key needed.
              </p>
            </div>
            {way === 'mcp' && (
              <Chip tone="on">
                <Check className="i" aria-hidden="true" />
                Chosen
              </Chip>
            )}
          </div>
          <div className="field">
            <span className="label">Your Dialed MCP address</span>
            <CopyField value={address} />
          </div>
          <ConnectSteps client="claude" />
          <div className="field">
            <span className="label">Works with</span>
            <div className="clients">
              {WORKS_WITH.map((name) => (
                <span key={name} className="chip">
                  {name}
                </span>
              ))}
            </div>
          </div>
          {status.connected ? (
            <div className="ok-line" role="status">
              <Led state="connected" />
              {status.clientName ?? 'Your AI'} is connected. It can set up your projects now.
            </div>
          ) : (
            <div className="wait" role="status">
              <Led state="ai" />
              Waiting for your AI to connect. This page updates by itself.
            </div>
          )}
        </section>
      </div>

      <div className="onb-actions">
        <button className="btn btn-ghost" type="button" onClick={() => router.back()}>
          <ArrowLeft className="i" aria-hidden="true" />
          Back
        </button>
        <ButtonLink
          href="/projects/new?welcome=1"
          variant="primary"
          size="lg"
          tile={<ArrowRight className="i" aria-hidden="true" />}
        >
          Continue to your first project
        </ButtonLink>
      </div>
    </main>
  );
}

/** The onboarding top bar: the logo, the three steps and Skip for now. */
export function OnboardingTop({ step }: { step: 2 | 3 }) {
  const steps = ['Account', 'Connect your AI', 'First project'];
  return (
    <header className="onb-top">
      <Link className="logo" href="/projects" aria-label="Dialed home">
        <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect className="bg" width="32" height="32" rx="9" />
          <circle className="d" cx="16" cy="17.5" r="7" />
          <path className="d" d="M16 17.5l4-4.2" />
          <path className="t" d="M7.6 10.4l-1.3-1.1M16 7V5.2M24.4 10.4l1.3-1.1" />
        </svg>
        <span className="logo-word">dialed</span>
      </Link>
      <nav className="steps-row" aria-label="Setup steps">
        {steps.map((label, i) => {
          const n = i + 1;
          const state = n < step ? 'stepi is-done' : n === step ? 'stepi is-now' : 'stepi';
          return (
            <span key={label} style={{ display: 'contents' }}>
              {i > 0 && <span className="step-sep" />}
              <span className={state} aria-current={n === step ? 'step' : undefined}>
                <span className="n">{n < step ? <Check className="i i-xs" aria-hidden="true" /> : n}</span>
                {label}
              </span>
            </span>
          );
        })}
      </nav>
      <Link className="btn btn-sm btn-ghost" href="/projects">
        Skip for now
      </Link>
    </header>
  );
}
