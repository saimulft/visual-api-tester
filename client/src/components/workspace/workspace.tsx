'use client';

import {
  ArrowLeft,
  Bookmark,
  CalendarClock,
  ChevronRight,
  FileText,
  Search,
  SendHorizontal,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/components/auth/api';
import { ChannelStrip } from '@/components/controls';
import { Button, Dialog, Field, Input, Monogram, ProvLegend, Segmented, toast } from '@/components/ui';
import type { DatasetSummary } from '@/contracts/datasets';
import type { Project } from '@/contracts/projects';
import type { Schedule } from '@/contracts/schedules';
import { allControls, type ApiSpec, type Value, type Values } from '@/contracts/spec';
import { defaultValues } from '@/contracts/values';
import type { Preset, RunDetail, RunPreviewDetail } from '@/contracts/workspace';
import type { SetupSummary } from '@/server/services/project-stats';
import { describeTimingShort } from './timing-text';
import { PresetList } from './presets';
import { ResultsStage } from './results-stage';
import { RunModule } from './run-module';

/**
 * Screen 06, the workspace (Main.dc.html and MainPhone.dc.html): the side panel (endpoints, presets, the AI
 * card), the channel rack with the dark Run module, and the results stage. The live match count follows
 * the controls, 600 ms after the last change. On a phone, Controls and Results switch, with Run pinned.
 */
export type WorkspaceKey = {
  id: string;
  last4: string;
  masked: string;
  ok: boolean | null;
  creditsLeft: number | null;
};

export function Workspace({
  project,
  presets,
  lastRun,
  schedule,
  datasets,
  apiKey,
  setup,
  timezone,
}: {
  project: Project & { spec: ApiSpec };
  presets: Preset[];
  lastRun: RunDetail | null;
  schedule: Schedule | null;
  datasets: DatasetSummary[];
  apiKey: WorkspaceKey | null;
  setup: SetupSummary | null;
  timezone: string;
}) {
  const spec = project.spec;
  const router = useRouter();
  const controls = useMemo(() => allControls(spec), [spec]);
  const known = useMemo(() => new Set(controls.map((c) => c.id)), [controls]);
  const [values, setValues] = useState<Values>(() => {
    const start = defaultValues(spec);
    for (const [id, value] of Object.entries(lastRun?.values ?? {})) if (known.has(id)) start[id] = value;
    return start;
  });
  const [presetList, setPresetList] = useState(presets);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<RunPreviewDetail | null>(null);
  const [run, setRun] = useState<RunDetail | null>(lastRun);
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mobile, setMobile] = useState<'controls' | 'results'>('controls');
  const [tab, setTab] = useState<'table' | 'json' | 'request'>('table');
  const [cascade, setCascade] = useState(0);
  const [confirm, setConfirm] = useState<{ credits: number; message: string } | null>(null);
  const [savePreset, setSavePreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [ask, setAsk] = useState('');
  const firstEndpoint = spec.run.mode === 'searchThenCollect' ? spec.run.searchId : spec.run.endpointId;
  const [endpointId, setEndpointId] = useState(firstEndpoint);
  const endpoint = spec.endpoints.find((e) => e.id === endpointId) ?? spec.endpoints[0];
  const runningRef = useRef(false);

  // The live line: matches, take and cost, 600 ms after the last change.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      const res = await api<{ preview: RunPreviewDetail }>('/api/preview', { projectId: project.id, values });
      if (live && res.ok) setPreview(res.data.preview);
    }, 600);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [values, project.id]);

  const change = (controlId: string, value: Value) => {
    setValues((v) => ({ ...v, [controlId]: value }));
    setPresetId(null);
    setErrors((e) => {
      if (!(controlId in e)) return e;
      const next = { ...e };
      delete next[controlId];
      return next;
    });
  };

  const start = useCallback(
    async (confirmCredits?: number) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      setErrors({});
      setConfirm(null);
      try {
        const res = await api<{ run: RunDetail }>('/api/runs', {
          projectId: project.id,
          values,
          presetId,
          confirmCredits,
        });
        if (!res.ok) {
          if (res.error.code === 'confirm_credits') {
            const credits = Number(res.error.problems?.find((p) => p.path === 'credits')?.message ?? 0);
            setConfirm({ credits, message: res.error.message });
            return;
          }
          if (res.error.problems?.length)
            setErrors(Object.fromEntries(res.error.problems.map((p) => [p.path, p.message])));
          toast.error(res.error.message);
          return;
        }
        let detail = res.data.run;
        while (detail.status === 'running') {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const next = await api<{ run: RunDetail }>(`/api/runs/${detail.runId}`);
          if (next.ok) detail = next.data.run;
        }
        setRun(detail);
        setTab('table');
        setMobile('results');
        setCascade((n) => n + 1);
        if (detail.status === 'failed') toast.error(detail.error?.text ?? 'The run failed.');
        else if (detail.status === 'stopped' || detail.status === 'partial')
          toast(detail.error?.text ?? 'The run stopped early.');
        router.refresh();
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [project.id, values, presetId, router],
  );

  // ⌘Enter (Ctrl+Enter) runs, from anywhere on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  const createPreset = async () => {
    const res = await api<{ preset: Preset }>('/api/presets', { projectId: project.id, name: presetName, values });
    if (!res.ok) return toast.error(res.error.message);
    setPresetList((list) => [res.data.preset, ...list]);
    setPresetId(res.data.preset.id);
    setSavePreset(false);
    setPresetName('');
    toast.success(`Saved “${res.data.preset.name}”`);
  };

  const askAi = () => {
    const text = ask.trim();
    router.push(`/projects/${project.id}/setup?change=1${text ? `&ask=${encodeURIComponent(text)}` : ''}`);
  };

  const pickEndpoint = (id: string) => {
    setEndpointId(id);
    const channel = spec.channels.findIndex((c) => c.controls.some((k) => k.endpointId === id));
    if (channel >= 0)
      document
        .getElementById(`ch-${spec.channels[channel].id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const needsKey = spec.api.auth.type !== 'none' && !apiKey;
  const context = { spec, creditsLeft: preview?.creditsLeft ?? apiKey?.creditsLeft ?? null, needsKey };
  const sampleCount = run?.sample.length ?? 0;
  const keyline =
    spec.api.auth.type === 'none'
      ? 'No key needed'
      : !apiKey
        ? 'Needs a key'
        : apiKey.ok === false
          ? `Key ${apiKey.last4} was refused`
          : apiKey.ok
            ? `Key ${apiKey.last4} works`
            : `Key ${apiKey.last4} saved`;
  const keyLed =
    spec.api.auth.type === 'none' || apiKey?.ok ? 'led' : !apiKey || apiKey.ok === false ? 'led is-err' : 'led is-warn';

  return (
    <>
      <header className="topbar">
        <div className="topbar-title">
          <nav className="crumbs" aria-label="Breadcrumb">
            <Link href="/projects">Projects</Link>
            <ChevronRight className="i" aria-hidden="true" />
            <span>{project.apiName || spec.api.name}</span>
          </nav>
          <h1>{project.name}</h1>
        </div>
        {schedule && (
          <span className="chip is-soft">
            <span
              className={
                schedule.state === 'on' ? 'led is-live' : schedule.state === 'failed' ? 'led is-err' : 'led is-off'
              }
            />
            {schedule.status === 'paused' ? 'Pulls paused' : `Pulls ${describeTimingShort(schedule)}`}
          </span>
        )}
        <Link
          className="btn btn-sm"
          href={schedule ? `/schedules?id=${schedule.id}` : `/schedules?project=${project.id}`}
        >
          <CalendarClock className="i i-sm" aria-hidden="true" />
          Schedule
        </Link>
        <button className="btn btn-sm" type="button" onClick={() => setSavePreset(true)}>
          <Bookmark className="i i-sm" aria-hidden="true" />
          Save preset
        </button>
        <Link className="btn btn-sm btn-ai" href={`/projects/${project.id}/setup?change=1`}>
          <Sparkles className="i i-sm" aria-hidden="true" />
          Ask AI
        </Link>
      </header>

      <header className="mhead">
        <Link className="btn btn-sm btn-icon btn-ghost" href="/projects" aria-label="Back to projects">
          <ArrowLeft className="i" aria-hidden="true" />
        </Link>
        <div className="grow">
          <div className="micro">{project.apiName || spec.api.name}</div>
          <div className="mhead-title">{project.name}</div>
        </div>
        <Link
          className="btn btn-sm btn-icon btn-ai"
          href={`/projects/${project.id}/setup?change=1`}
          aria-label="Ask AI"
        >
          <Sparkles className="i" aria-hidden="true" />
        </Link>
      </header>

      <div className="ws-switch">
        <Segmented
          block
          label="Show"
          value={mobile}
          onChange={setMobile}
          options={[
            { value: 'controls', label: 'Controls' },
            {
              value: 'results',
              label: (
                <>
                  Results <span className="ftab-count">{run?.rows ?? 0}</span>
                </>
              ),
            },
          ]}
        />
      </div>

      <div className={`ws ${mobile === 'results' ? 'show-results' : 'show-controls'}`}>
        <aside className="ws-side" aria-label="Project">
          <div className="proj-id">
            <Monogram text={project.monogram} tone="signal" />
            <div className="grow">
              <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3 }}>{project.apiName || spec.api.name}</div>
              <div className="keyline">
                <span className={keyLed} />
                {spec.endpoints.length} {spec.endpoints.length === 1 ? 'endpoint' : 'endpoints'} · {keyline}
              </div>
            </div>
          </div>

          <div className="side-eps">
            <p className="micro side-label">What do you want to do?</p>
            <div className="ep-list">
              {spec.endpoints.map((e) => (
                <a
                  key={e.id}
                  className="ep"
                  href={`#ep-${e.id}`}
                  aria-current={e.id === endpoint.id ? 'true' : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    pickEndpoint(e.id);
                  }}
                >
                  <span className="ep-ico">
                    {e.method === 'POST' || e.free ? (
                      <Search className="i i-sm" aria-hidden="true" />
                    ) : (
                      <FileText className="i i-sm" aria-hidden="true" />
                    )}
                  </span>
                  <span className="ep-text">
                    <span className="ep-name">{e.label}</span>
                    <span className="ep-meta">
                      {e.free
                        ? 'Free'
                        : e.cost.perRecord
                          ? `${e.cost.perRecord.toLocaleString('en-US')} ${e.cost.unit} each`
                          : `${e.cost.perCall.toLocaleString('en-US')} ${e.cost.unit} a call`}
                    </span>
                    <span className="ep-path">
                      {e.method} {e.path}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          </div>

          <PresetList
            presets={presetList}
            values={values}
            activeId={presetId}
            onApply={(preset) => {
              const next = defaultValues(spec);
              for (const [id, value] of Object.entries(preset.values)) if (known.has(id)) next[id] = value;
              setValues(next);
              setPresetId(preset.id);
              setErrors({});
            }}
            onChange={setPresetList}
            currentValues={values}
          />

          <div className="ai-card">
            <div className="row" style={{ gap: 8, fontWeight: 600 }}>
              <Sparkles className="i i-sm" aria-hidden="true" />
              {setup
                ? `Set up by ${setup.who} ${setup.via === 'mcp' ? 'through MCP' : 'with your key'}`
                : 'Set up from a ready-made spec'}
            </div>
            <p>
              {setup
                ? `Read ${setup.pagesRead} doc ${setup.pagesRead === 1 ? 'page' : 'pages'} and built ${setup.controlsBuilt || controls.length} controls${setup.at ? ` on ${new Date(setup.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}, with ${spec.notes.length} notes on what this API can’t do.`
                : `${controls.length} controls in ${spec.channels.length} channels, with ${spec.notes.length} notes on what this API can’t do.`}
            </p>
            <Link href={`/projects/${project.id}/setup`}>See what it did</Link>
            <Link href={`/projects/${project.id}/setup?change=1`}>Ask for changes</Link>
          </div>
        </aside>

        <section className="ws-rack" aria-label="Controls">
          <div className="rack-head">
            <div className="rack-title">
              <h2>{endpoint.label}</h2>
              <span className="chip is-soft">
                {controls.length} {controls.length === 1 ? 'control' : 'controls'}
              </span>
              <ProvLegend />
            </div>
            <label className="ask">
              <Sparkles className="i" aria-hidden="true" />
              <span className="sr">Ask the AI to change these controls</span>
              <input
                type="text"
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    askAi();
                  }
                }}
                placeholder="Tell the AI what to change, like ‘only SaaS companies’"
              />
              <button className="btn btn-sm btn-icon btn-ai" type="button" aria-label="Send to the AI" onClick={askAi}>
                <SendHorizontal className="i i-sm" aria-hidden="true" />
              </button>
            </label>
          </div>

          <div className="rack-scroll">
            {spec.channels.map((channel, i) => (
              <div key={channel.id} id={`ch-${channel.id}`} style={{ scrollMarginTop: 8 }}>
                <ChannelStrip
                  channel={channel}
                  index={i}
                  values={values}
                  onChange={change}
                  errors={errors}
                  context={i === 0 ? context : { ...context, needsKey: false }}
                />
              </div>
            ))}
          </div>

          <RunModule spec={spec} values={values} preview={preview} running={running} onRun={() => void start()} />
        </section>

        <ResultsStage
          projectId={project.id}
          projectName={project.name}
          spec={spec}
          run={run}
          preview={preview}
          running={running}
          values={values}
          tab={tab}
          onTab={setTab}
          cascade={cascade}
          datasets={datasets}
          timezone={timezone}
          sampleCount={sampleCount}
          onSaved={() => router.refresh()}
        />
      </div>

      <Dialog
        open={Boolean(confirm)}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="This run spends more than your limit"
        description={confirm?.message}
        size="sm"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Not now
            </Button>
            <Button variant="primary" onClick={() => confirm && void start(confirm.credits)}>
              Run for {confirm?.credits.toLocaleString('en-US')} {preview?.unit ?? 'credits'}
            </Button>
          </>
        }
      />

      <Dialog
        open={savePreset}
        onOpenChange={setSavePreset}
        title="Save these controls as a preset"
        description="Apply it later in one click, or run it on a schedule."
        size="sm"
        actions={
          <>
            <Button variant="ghost" onClick={() => setSavePreset(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void createPreset()} disabled={!presetName.trim()}>
              Save preset
            </Button>
          </>
        }
      >
        <Field label="Name">
          {({ id }) => (
            <Input
              id={id}
              value={presetName}
              autoFocus
              placeholder="Like Series A, 50 to 200 staff"
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && presetName.trim()) void createPreset();
              }}
            />
          )}
        </Field>
      </Dialog>
    </>
  );
}
