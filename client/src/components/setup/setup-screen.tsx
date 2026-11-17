'use client';

import { AlertCircle, ArrowRight, Check, RotateCcw, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/components/auth/api';
import { Button, ButtonLink, CopyField } from '@/components/ui';
import type { SetupEvent } from '@/contracts/events';
import type { SetupStream, SetupView } from '@/contracts/setup';
import { DetailHead } from '../new-project/detail-head';

/**
 * Screen 05, the AI sets up the API: the stepper with its live log, the build card where controls drop into
 * their channels one by one, the AI's notes, then Ready to dial. Built-in and MCP setups share it. Events come
 * over SSE from /api/setup/[id]/events and resume from the last event id. Under reduced motion the final state
 * shows at once.
 */
const REPLAY_MS = 420;

function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${s % 60} s`;
}

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function SetupScreen({
  initial,
  initialEvents,
  timeZone,
}: {
  initial: SetupView;
  initialEvents: SetupEvent[];
  timeZone: string;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [events, setEvents] = useState(initialEvents);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<'stop' | 'retry' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** During Replay: how many controls are showing (null: all). */
  const [shown, setShown] = useState<number | null>(null);
  const [replayStep, setReplayStep] = useState<number | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const { setup, project } = view;
  const working = setup.status === 'running' || setup.status === 'waiting';

  // The live feed. EventSource reconnects by itself and sends Last-Event-ID, so nothing is missed.
  useEffect(() => {
    if (!working) return;
    const last = initialEvents.at(-1)?.id ?? 0;
    const source = new EventSource(`/api/setup/${setup.id}/events?after=${last}`);
    const onMessage = (message: MessageEvent<string>) => {
      const data = JSON.parse(message.data) as SetupStream;
      if (data.kind === 'view') setView(data.view);
      else setEvents((list) => (list.some((e) => e.id === data.event.id) ? list : [...list, data.event].slice(-400)));
    };
    source.addEventListener('message', onMessage);
    source.addEventListener('view', onMessage as EventListener);
    return () => source.close();
  }, [working, setup.id, initialEvents]);

  // The elapsed time while it works.
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const allControls = view.channels.reduce((n, c) => n + c.controls.length, 0);
  const replay = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (reducedMotion()) return;
    setShown(0);
    setReplayStep(3);
    for (let i = 1; i <= allControls; i++) timers.current.push(setTimeout(() => setShown(i), i * REPLAY_MS));
    const end = allControls * REPLAY_MS;
    timers.current.push(setTimeout(() => setReplayStep(4), end + REPLAY_MS));
    timers.current.push(
      setTimeout(
        () => {
          setReplayStep(null);
          setShown(null);
        },
        end + REPLAY_MS + 1300,
      ),
    );
  };

  const done = setup.status === 'done';
  const ready = done && replayStep === null;
  const step = replayStep ?? (done ? 5 : setup.step);
  const who = setup.via === 'mcp' && setup.status === 'waiting' ? 'Your AI' : setup.who;
  const began = setup.startedAt ?? setup.createdAt;
  const elapsed = duration((setup.finishedAt ?? now) - began);
  const title =
    setup.status === 'waiting'
      ? `Waiting for your AI to set up ${project.apiName || project.name}`
      : setup.status === 'running'
        ? `${who} is setting up ${project.apiName || project.name}`
        : done
          ? `${who} set up ${project.apiName || project.name}`
          : setup.status === 'cancelled'
            ? 'You stopped the setup'
            : `The setup of ${project.apiName || project.name} stopped`;
  const timeText =
    setup.status === 'waiting'
      ? 'waiting'
      : working
        ? `working for ${elapsed}`
        : done
          ? `took ${elapsed}`
          : `stopped after ${elapsed}`;
  const chipWho = setup.via === 'mcp' ? 'Through MCP' : 'Built-in assistant';
  const ledClass = working ? 'led is-ai is-live' : done ? 'led' : 'led is-off';

  const stop = async () => {
    setBusy('stop');
    const res = await api<{ view: SetupView }>(`/api/setup/${setup.id}/cancel`, {});
    setBusy(null);
    if (res.ok) setView(res.data.view);
    else setError(res.error.message);
  };
  const retry = async () => {
    setBusy('retry');
    const res = await api<{ setupId: string }>(`/api/setup/${setup.id}/retry`, {});
    if (!res.ok) {
      setBusy(null);
      return setError(res.error.message);
    }
    router.refresh();
    setTimeout(() => setBusy(null), 1500);
  };

  const logLines = useMemo(() => {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    return events
      .filter((e) => e.kind === 'log' || e.kind === 'test' || e.kind === 'error')
      .slice(-8)
      .map((e) => ({
        id: e.id,
        at: fmt.format(new Date(e.at)),
        text:
          e.kind === 'log'
            ? e.text
            : e.kind === 'test'
              ? e.ok
                ? `Test call passed: ${e.records} records in ${duration(e.ms)}`
                : `Test call failed: ${e.error ?? 'no answer'}`
              : e.message,
      }));
  }, [events, timeZone]);

  const stepClass = (i: number) =>
    step > i
      ? 'stp is-done'
      : step === i && setup.status !== 'failed' && setup.status !== 'cancelled'
        ? 'stp is-now'
        : 'stp';
  const dot = (i: number) => (step > i ? <Check className="i i-sm" aria-hidden="true" /> : i);

  const built = shown ?? allControls;
  const planned = Math.max(view.planned, allControls);
  const pct = planned ? Math.round((Math.min(built, planned) / planned) * 100) : 0;
  const endpointCount = view.endpoints.length;
  const docsTotal = view.docsEndpoints;
  const test = view.test;

  // Controls in build order, so Replay can drop them in one by one.
  const offsets = view.channels.map((_, ci) => view.channels.slice(0, ci).reduce((n, c) => n + c.controls.length, 0));
  const channels = view.channels.map((c, ci) => ({
    ...c,
    items: c.controls.map((k, ki) => ({ ...k, visible: offsets[ci] + ki + 1 <= built })),
  }));

  const workspaceButton = (
    <ButtonLink
      href={`/projects/${project.id}`}
      variant="primary"
      size="lg"
      tile={<ArrowRight className="i" aria-hidden="true" />}
    >
      Open workspace
    </ButtonLink>
  );

  return (
    <>
      <DetailHead
        crumbs={[{ label: 'Projects', href: '/projects' }, { label: project.name }]}
        title={title}
        actions={
          <>
            <span className="chip is-ai">
              <span className={ledClass} />
              {chipWho} · {timeText}
            </span>
            {working && (
              <Button variant="danger" size="sm" onClick={stop} busy={busy === 'stop'}>
                Stop setup
              </Button>
            )}
            {ready && (
              <ButtonLink href={`/projects/${project.id}`} variant="primary" size="sm">
                Open workspace
              </ButtonLink>
            )}
          </>
        }
        phoneMicro={working ? 'Setting up' : done ? 'Set up' : 'Setup stopped'}
        phoneTitle={project.apiName || project.name}
        phoneAction={
          <span className="chip is-ai">
            <span className={ledClass} />
            {setup.via === 'mcp' ? 'MCP' : 'Built-in'}
          </span>
        }
      />
      <div className="page">
        <div className="page-in">
          <div className="setup">
            <section className="steps-card" aria-label="Progress">
              <div className="steps-head">
                <span className="micro grow">What {who === 'Your AI' ? 'your AI' : who} is doing</span>
                {ready && (
                  <Button variant="ghost" size="sm" onClick={replay}>
                    Replay
                  </Button>
                )}
              </div>
              <div className={stepClass(1)}>
                <span className="stp-dot">{dot(1)}</span>
                <div>
                  <p className="stp-title">Read the docs</p>
                  <p className="stp-meta">
                    {setup.pagesRead
                      ? `${setup.pagesRead} page${setup.pagesRead === 1 ? '' : 's'} from ${view.docsHost ?? 'the docs'}`
                      : `The docs at ${view.docsHost ?? 'the docs'}`}
                  </p>
                </div>
              </div>
              <div className={stepClass(2)}>
                <span className="stp-dot">{dot(2)}</span>
                <div>
                  <p className="stp-title">
                    {endpointCount
                      ? docsTotal && docsTotal >= endpointCount
                        ? `Picked ${endpointCount} of ${docsTotal.toLocaleString('en')} endpoints`
                        : `Picked ${endpointCount} endpoint${endpointCount === 1 ? '' : 's'}`
                      : 'Pick what fits'}
                  </p>
                  <p className="stp-meta">
                    {endpointCount
                      ? view.endpoints.map((e) => e.label).join(', ')
                      : 'Only the endpoints that match your brief'}
                  </p>
                </div>
              </div>
              <div className={stepClass(3)}>
                <span className="stp-dot">{dot(3)}</span>
                <div>
                  <p className="stp-title">{step > 3 ? 'Built your controls' : 'Building your controls'}</p>
                  <p className="stp-meta num">
                    {planned
                      ? `${Math.min(built, planned)} of ${planned} controls${view.mainEndpoint ? ` for ${view.mainEndpoint}` : ''}`
                      : 'Sliders, switches and lists, with notes on any limits'}
                  </p>
                  {step >= 3 && (
                    <div className="bar">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              </div>
              <div className={stepClass(4)}>
                <span className="stp-dot">{dot(4)}</span>
                <div>
                  <p className="stp-title">Test call</p>
                  <p className="stp-meta num">
                    {step < 4
                      ? 'One free call with your key'
                      : step === 4 && (!test || replayStep === 4)
                        ? 'Running one free call'
                        : test?.ok
                          ? `Passed · ${test.records.toLocaleString('en')} records · 0 credits`
                          : test
                            ? `Failed: ${test.error ?? 'no answer'}`
                            : 'No free endpoint to test'}
                  </p>
                </div>
              </div>
              {logLines.length > 0 && (
                <div className="log" aria-label="Live log" aria-live="polite">
                  {logLines.map((l) => (
                    <p key={l.id}>
                      <span>{l.at}</span>
                      {l.text}
                    </p>
                  ))}
                </div>
              )}
            </section>

            <section className="build" aria-label="Controls being built">
              <div className="panel-head">
                <h2 className="panel-title">{view.mainEndpoint ?? 'Your controls'}</h2>
                <span className="chip is-soft num">
                  {Math.min(built, planned)} of {planned} controls
                </span>
                <span className="legend" style={{ marginLeft: 'auto' }}>
                  <span>
                    <span className="prov" />
                    Made by AI
                  </span>
                </span>
              </div>

              {setup.status === 'waiting' && (
                <>
                  <div className="wait" role="status">
                    <span className="led is-ai is-live" />
                    Waiting for your AI. Ask it this, and this page follows along:
                  </div>
                  <CopyField value={view.askAi} />
                </>
              )}

              {channels.length > 0 && (
                <div className="bchs">
                  {channels.map((c) => (
                    <div className="bch" key={c.id}>
                      <div className="bch-name">
                        <span className="ch-num" />
                        <strong>{c.title}</strong>
                      </div>
                      <div className="chips">
                        {c.items.map((it) =>
                          it.visible ? (
                            <span className="bitem" key={it.id}>
                              <span className="kind">{it.kindLabel}</span>
                              {it.label}
                            </span>
                          ) : (
                            <span className="bitem is-wait" key={it.id}>
                              {it.label}
                            </span>
                          ),
                        )}
                        {c.waiting.map((label) => (
                          <span className="bitem is-wait" key={`wait-${label}`}>
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {view.notes.length > 0 && (
                <div className="notes">
                  {view.notes.map((n) => (
                    <p className="ai-note" key={n.text}>
                      <Sparkles className="i" aria-hidden="true" />
                      <span>{n.text}</span>
                    </p>
                  ))}
                </div>
              )}

              {(setup.status === 'failed' || setup.status === 'cancelled') && (
                <div className="ok-line is-err" role="alert">
                  <AlertCircle className="i" aria-hidden="true" />
                  <span className="grow">{setup.error ?? 'The setup stopped.'}</span>
                  <Button
                    size="sm"
                    onClick={retry}
                    busy={busy === 'retry'}
                    tile={<RotateCcw className="i" aria-hidden="true" />}
                  >
                    Try again
                  </Button>
                </div>
              )}
              {error && (
                <div className="ok-line is-err" role="alert">
                  <AlertCircle className="i" aria-hidden="true" />
                  {error}
                </div>
              )}

              {ready && (
                <div className="ready on-dark">
                  <div className="grow">
                    <strong>Ready to dial</strong>
                    <p>
                      {allControls} control{allControls === 1 ? '' : 's'} across {endpointCount} endpoint
                      {endpointCount === 1 ? '' : 's'}.
                      {test?.ok
                        ? ` The test call found ${test.records.toLocaleString('en')} records for 0 credits.`
                        : ''}
                    </p>
                  </div>
                  {workspaceButton}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
