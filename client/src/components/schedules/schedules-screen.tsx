'use client';

import { CalendarClock, Play, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/components/auth/api';
import { Fader } from '@/components/controls/fader';
import { Topbar } from '@/components/shell';
import {
  Button,
  EmptyState,
  Monogram,
  SearchSelect,
  Segmented,
  Select,
  Switch,
  TimePicker,
  toast,
} from '@/components/ui';
import { clock, count, dateText, shortDay, whenText } from '@/components/workspace/format';
import { runLed } from '@/components/projects/projects-home';
import { describeTiming, ordinal } from '@/components/workspace/timing-text';
import type { Cadence, NextRun, Schedule } from '@/contracts/schedules';
import type { Preset, RunDetail, RunSummary } from '@/contracts/workspace';

/** Screen 09 (Schedules.dc.html and SchedulesPhone.dc.html). */
type ProjectOption = { id: string; name: string; monogram: string; perRecord: number; unit: string; keyed: boolean };
type DatasetOption = { id: string; projectId: string; name: string; saveMode: 'append' | 'replace' | 'keep' };

type Draft = {
  id?: string;
  projectId: string;
  presetId: string | null;
  datasetId: string | null;
  name: string;
  cadence: Cadence;
  days: number[];
  dayOfMonth: number;
  time: string;
  timezone: string;
  creditLimit: number;
  emailOnFail: boolean;
  emailCsv: boolean;
  status: 'on' | 'paused';
};

const NEW_DATASET = '__new__';
const NO_DATASET = '__none__';
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MODE_WORD = { append: 'add new', replace: 'replace all', keep: 'keep each run' } as const;

function draftOf(s: Schedule): Draft {
  return {
    id: s.id,
    projectId: s.projectId,
    presetId: s.presetId,
    datasetId: s.datasetId,
    name: s.name,
    cadence: s.cadence,
    days: s.days,
    dayOfMonth: s.dayOfMonth ?? 1,
    time: s.time,
    timezone: s.timezone,
    creditLimit: s.creditLimit,
    emailOnFail: s.emailOnFail,
    emailCsv: s.emailCsv,
    status: s.status,
  };
}

function zoneLabel(zone: string): string {
  try {
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')
      ?.value.replace('GMT', 'UTC');
    return `${(zone.split('/').pop() ?? zone).replace(/_/g, ' ')}, ${offset === 'UTC' ? 'UTC+0' : offset}`;
  } catch {
    return zone;
  }
}

function lastLine(s: Schedule): { text: string; err: boolean } {
  const run = s.lastRun;
  if (!run) return { text: 'Not run yet', err: false };
  if (run.status === 'failed')
    return { text: run.error?.code === 'timeout' ? 'Last run timed out' : 'Last run failed', err: true };
  if (run.status === 'stopped') return { text: 'Last run stopped at the limit', err: true };
  const parts = [run.datasetId ? `${count(run.newRows)} new` : `${count(run.rows)} rows`];
  if (run.retries) parts.push(`${run.retries} ${run.retries === 1 ? 'retry' : 'retries'}`);
  return { text: `Last: ${parts.join(', ')}`, err: false };
}

export function SchedulesScreen({
  schedules,
  projects,
  datasets,
  initialId,
  newFor,
  initialHistory,
  timezone,
}: {
  schedules: Schedule[];
  projects: ProjectOption[];
  datasets: DatasetOption[];
  initialId: string | null;
  newFor: string | null;
  initialHistory: RunSummary[];
  timezone: string;
}) {
  const router = useRouter();
  const [list, setList] = useState(schedules);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const blank = (projectId: string): Draft => ({
    projectId,
    presetId: null,
    datasetId: NEW_DATASET,
    name: '',
    cadence: 'weekly',
    days: [1],
    dayOfMonth: 1,
    time: '09:00',
    timezone,
    creditLimit: 500,
    emailOnFail: true,
    emailCsv: false,
    status: 'on',
  });
  const [draft, setDraft] = useState<Draft | null>(() => {
    const s = schedules.find((x) => x.id === initialId);
    if (s) return draftOf(s);
    if (newFor && projects.some((p) => p.id === newFor)) return blank(newFor);
    return null;
  });
  const [history, setHistory] = useState(initialHistory);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [next, setNext] = useState<NextRun[]>([]);
  const [busy, setBusy] = useState<'save' | 'run' | null>(null);

  const current = list.find((s) => s.id === selectedId) ?? null;
  const project = projects.find((p) => p.id === draft?.projectId) ?? null;
  const on = list.filter((s) => s.status === 'on');
  const soonest = on
    .map((s) => s.nextRunAt)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b)[0];

  // The project's presets, for "Runs the preset".
  useEffect(() => {
    if (!draft?.projectId) return;
    let live = true;
    void api<{ presets: Preset[] }>(`/api/presets?projectId=${draft.projectId}`).then((res) => {
      if (live && res.ok) setPresets(res.data.presets);
    });
    return () => {
      live = false;
    };
  }, [draft?.projectId]);

  // The next three runs, live as the timing changes.
  useEffect(() => {
    if (!draft) return;
    let live = true;
    const timer = setTimeout(async () => {
      const res = await api<{ next: NextRun[] }>('/api/schedules/next', {
        cadence: draft.cadence,
        days: draft.days,
        dayOfMonth: draft.cadence === 'monthly' ? draft.dayOfMonth : null,
        time: draft.time,
        timezone: draft.timezone,
      });
      if (live && res.ok) setNext(res.data.next);
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft?.cadence, draft?.days, draft?.dayOfMonth, draft?.time, draft?.timezone]); // eslint-disable-line react-hooks/exhaustive-deps

  const zones = useMemo(() => {
    let all: string[] = [];
    try {
      all = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
    } catch {
      all = [timezone];
    }
    if (!all.includes(timezone)) all.unshift(timezone);
    return all.map((z) => ({ value: z, label: zoneLabel(z) }));
  }, [timezone]);

  const choose = async (s: Schedule) => {
    setSelectedId(s.id);
    setDraft(draftOf(s));
    window.history.replaceState(null, '', `/schedules?id=${s.id}`);
    const res = await api<{ runs: RunSummary[] }>(`/api/runs?scheduleId=${s.id}&limit=5`);
    setHistory(res.ok ? res.data.runs : []);
  };

  const startNew = () => {
    const first = projects[0];
    if (!first) return toast('Set a project up first, then schedule it.');
    setSelectedId(null);
    setDraft(blank(first.id));
    setHistory([]);
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = async (): Promise<Schedule | null> => {
    if (!draft) return null;
    setBusy('save');
    try {
      let datasetId = draft.datasetId === NEW_DATASET || draft.datasetId === NO_DATASET ? null : draft.datasetId;
      if (draft.datasetId === NEW_DATASET) {
        const made = await api<{ dataset: { id: string } }>('/api/datasets', {
          projectId: draft.projectId,
          name: draft.name || `${project?.name ?? 'Schedule'} pulls`,
        });
        if (!made.ok) {
          toast.error(made.error.message);
          return null;
        }
        datasetId = made.data.dataset.id;
      }
      const res = await api<{ schedule: Schedule }>('/api/schedules', {
        ...draft,
        datasetId,
        dayOfMonth: draft.cadence === 'monthly' ? draft.dayOfMonth : null,
        name: draft.name || undefined,
      });
      if (!res.ok) {
        toast.error(res.error.message);
        return null;
      }
      const saved = res.data.schedule;
      setList((l) =>
        l.some((s) => s.id === saved.id) ? l.map((s) => (s.id === saved.id ? saved : s)) : [...l, saved],
      );
      setSelectedId(saved.id);
      setDraft(draftOf(saved));
      window.history.replaceState(null, '', `/schedules?id=${saved.id}`);
      toast.success(draft.id ? 'Changes saved' : 'Schedule made', {
        description: saved.nextRunAt
          ? `Next run ${whenText(saved.nextRunAt, saved.timezone).toLowerCase()}.`
          : 'It’s paused.',
      });
      router.refresh();
      return saved;
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (status: 'on' | 'paused') => {
    if (!draft) return;
    if (!current) return set('status', status);
    const res = await api<{ schedule: Schedule }>(`/api/schedules/${current.id}`, { status }, { method: 'PATCH' });
    if (!res.ok) return toast.error(res.error.message);
    setList((l) => l.map((s) => (s.id === current.id ? res.data.schedule : s)));
    setDraft((d) => (d ? { ...d, status } : d));
    toast.success(status === 'on' ? 'Schedule on' : 'Schedule paused');
  };

  const runNow = async () => {
    const target = current ?? (await save());
    if (!target) return;
    setBusy('run');
    try {
      const res = await api<{ run: RunDetail; schedule: Schedule }>(`/api/schedules/${target.id}/run`, {});
      if (!res.ok) return toast.error(res.error.message);
      setList((l) => l.map((s) => (s.id === target.id ? res.data.schedule : s)));
      const listed = await api<{ runs: RunSummary[] }>(`/api/runs?scheduleId=${target.id}&limit=5`);
      if (listed.ok) setHistory(listed.data.runs);
      const run = res.data.run;
      if (run.status === 'ok')
        toast.success(`${count(run.rows)} rows came back`, {
          description: run.datasetId ? `${count(run.newRows)} new rows saved.` : undefined,
        });
      else toast.error(run.error?.text ?? 'The run didn’t finish.');
    } finally {
      setBusy(null);
    }
  };

  const projectDatasets = datasets.filter((d) => d.projectId === draft?.projectId);
  const preset = presets.find((p) => p.id === draft?.presetId);
  const perRecord = project?.perRecord ?? 0;
  const limitMax = Math.max(2000, Math.ceil(((draft?.creditLimit ?? 0) * 1.5) / 1000) * 1000);

  return (
    <>
      <Topbar
        title="Schedules"
        search={false}
        crumbs={
          <>
            <span className={on.length ? 'led is-live' : 'led is-off'} />
            {on.length
              ? `${on.length} ${on.length === 1 ? 'pull is' : 'pulls are'} on${soonest ? ` · next at ${clock(soonest, timezone)}` : ''}`
              : 'No pulls are on'}
          </>
        }
        action={
          <button className="btn btn-primary has-tile" type="button" onClick={startNew}>
            <span className="tile">
              <Plus className="i" aria-hidden="true" />
            </span>
            New schedule
          </button>
        }
        phoneAction={
          <button
            className="btn btn-sm btn-icon btn-primary"
            type="button"
            aria-label="New schedule"
            onClick={startNew}
          >
            <Plus className="i" aria-hidden="true" />
          </button>
        }
      />
      <div className="page">
        <div className="page-in">
          {!list.length && !draft ? (
            <EmptyState
              icon={<CalendarClock className="i" aria-hidden="true" />}
              title="No schedules yet"
              action={
                projects.length ? (
                  <Button variant="primary" tile={<Plus className="i" aria-hidden="true" />} onClick={startNew}>
                    New schedule
                  </Button>
                ) : (
                  <Link className="btn btn-primary" href="/projects/new">
                    Set up a project
                  </Link>
                )
              }
            >
              Pull an API hourly, daily, weekly or monthly, keep the rows and get an email if a run fails.
            </EmptyState>
          ) : (
            <div className="sch">
              <section className="sch-list" aria-label="Your schedules">
                {list.map((s) => {
                  const last = lastLine(s);
                  return (
                    <article key={s.id} className={s.id === selectedId ? 'scard is-sel' : 'scard'}>
                      <div className="scard-top">
                        <span
                          className={
                            s.state === 'failed' ? 'led is-err' : s.state === 'paused' ? 'led is-off' : 'led is-live'
                          }
                        />
                        <a
                          className="scard-name"
                          href={`/schedules?id=${s.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            void choose(s);
                          }}
                        >
                          {s.name}
                        </a>
                        {s.status === 'paused' && (
                          <span className="chip is-soft" style={{ marginLeft: 'auto', height: 24, fontSize: 12 }}>
                            Paused
                          </span>
                        )}
                      </div>
                      <p className="hint">{describeTiming(s, timezone)}</p>
                      <div className="scard-meta">
                        {s.status === 'paused' ? (
                          <span>
                            Paused by you{s.pausedAt ? ' on ' : ''}
                            {s.pausedAt && <strong>{dateText(s.pausedAt, timezone)}</strong>}
                          </span>
                        ) : (
                          <span>
                            Next{' '}
                            <strong>
                              {s.nextRunAt ? shortDay(s.nextRunAt, s.timezone).replace(/^Today /, '') : 'not set'}
                            </strong>
                          </span>
                        )}
                        <span style={last.err ? { color: 'var(--err)' } : undefined}>{last.text}</span>
                      </div>
                    </article>
                  );
                })}
              </section>

              {draft && (
                <section className="sch-edit grid2" aria-label={current ? 'Edit schedule' : 'New schedule'}>
                  <div className="sch-head">
                    <Monogram text={project?.monogram ?? '?'} tone="signal" size="sm" />
                    <div className="grow">
                      <h2>{current?.name ?? 'New schedule'}</h2>
                      <p className="hint">
                        {preset
                          ? `Runs the preset “${preset.name}”`
                          : `Runs ${project?.name ?? 'the project'} with its current controls`}
                      </p>
                    </div>
                    <Switch
                      checked={draft.status === 'on'}
                      onChange={(v) => void toggle(v ? 'on' : 'paused')}
                      label="Schedule on"
                      text={draft.status === 'on' ? 'On' : 'Paused'}
                    />
                    <button className="btn btn-sm" type="button" onClick={() => void runNow()} disabled={busy !== null}>
                      {busy === 'run' ? (
                        <span className="spin dark" aria-hidden="true" />
                      ) : (
                        <Play className="i i-sm" aria-hidden="true" />
                      )}
                      Run now
                    </button>
                    <Button variant="primary" size="sm" busy={busy === 'save'} onClick={() => void save()}>
                      {current ? 'Save changes' : 'Make schedule'}
                    </Button>
                  </div>

                  <div className="panel">
                    <div className="panel-head">
                      <span className="micro">When</span>
                    </div>
                    {!current && (
                      <div className="field">
                        <span className="label">Project</span>
                        <Select
                          label="Project"
                          value={draft.projectId}
                          onChange={(v) =>
                            setDraft((d) => (d ? { ...d, projectId: v, presetId: null, datasetId: NEW_DATASET } : d))
                          }
                          options={projects.map((p) => ({ value: p.id, label: p.name }))}
                        />
                      </div>
                    )}
                    <div className="field">
                      <span className="label">How often</span>
                      <Segmented
                        block
                        label="How often"
                        value={draft.cadence}
                        onChange={(v) => set('cadence', v)}
                        options={[
                          { value: 'hourly', label: 'Hourly' },
                          { value: 'daily', label: 'Daily' },
                          { value: 'weekly', label: 'Weekly' },
                          { value: 'monthly', label: 'Monthly' },
                        ]}
                      />
                    </div>
                    {draft.cadence === 'weekly' && (
                      <div className="field">
                        <span className="label">On these days</span>
                        <div className="days" role="group" aria-label="Days of the week">
                          {DAY_NAMES.map((name, i) => {
                            const day = (i + 1) % 7;
                            const pressed = draft.days.includes(day);
                            return (
                              <button
                                key={name}
                                type="button"
                                aria-pressed={pressed}
                                aria-label={name}
                                onClick={() =>
                                  set('days', pressed ? draft.days.filter((d) => d !== day) : [...draft.days, day])
                                }
                              >
                                {DAY_LETTERS[i]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {draft.cadence === 'monthly' && (
                      <div className="field">
                        <span className="label">On day</span>
                        <Select
                          label="Day of the month"
                          value={String(draft.dayOfMonth)}
                          onChange={(v) => set('dayOfMonth', Number(v))}
                          options={Array.from({ length: 28 }, (_, i) => ({
                            value: String(i + 1),
                            label: `The ${ordinal(i + 1)}`,
                          }))}
                        />
                      </div>
                    )}
                    <div className="form-grid">
                      <div className="field">
                        <span className="label">{draft.cadence === 'hourly' ? 'Past the hour' : 'At'}</span>
                        <TimePicker
                          label="Time"
                          value={draft.time}
                          stepMinutes={draft.cadence === 'hourly' ? 15 : 30}
                          onChange={(v) => set('time', v)}
                        />
                      </div>
                      <div className="field">
                        <span className="label">Time zone</span>
                        <SearchSelect
                          label="Time zone"
                          value={draft.timezone}
                          onChange={(v) => set('timezone', v)}
                          options={zones}
                          searchPlaceholder="Search cities"
                        />
                      </div>
                    </div>
                    <div className="field" style={{ gap: 4 }}>
                      <span className="label">Next three runs</span>
                      <ul className="nexts">
                        {next.map((n, i) => (
                          <li key={n.at}>
                            <span className={i === 0 && draft.status === 'on' ? 'led is-live' : 'led is-off'} />
                            {n.label}
                            <span className="num">{n.inText}</span>
                          </li>
                        ))}
                        {next.length === 0 && <li className="hint">Pick the days to see the next runs.</li>}
                      </ul>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-head">
                      <span className="micro">Each run</span>
                    </div>
                    <div className="field">
                      <span className="label">Runs with</span>
                      <Select
                        label="Runs with"
                        value={draft.presetId ?? '__current__'}
                        onChange={(v) => set('presetId', v === '__current__' ? null : v)}
                        options={[
                          {
                            value: '__current__',
                            label: current ? 'The values it was saved with' : 'The project’s last values',
                          },
                          ...presets.map((p) => ({ value: p.id, label: `Preset: ${p.name}` })),
                        ]}
                      />
                    </div>
                    <div className="field">
                      <span className="label">Save rows to</span>
                      <Select
                        label="Save rows to"
                        value={draft.datasetId ?? NO_DATASET}
                        onChange={(v) => set('datasetId', v)}
                        options={[
                          ...projectDatasets.map((d) => ({
                            value: d.id,
                            label: `${d.name} · ${MODE_WORD[d.saveMode]}`,
                          })),
                          { value: NEW_DATASET, label: 'A new dataset · add new' },
                          { value: NO_DATASET, label: 'Don’t save the rows' },
                        ]}
                      />
                    </div>
                    <Fader
                      scale={{ min: 0, max: limitMax, step: perRecord > 0 ? perRecord : 10, log: false }}
                      label="Credit limit per run"
                      value={Math.min(draft.creditLimit, limitMax)}
                      onChange={(v) => set('creditLimit', v)}
                      ticks={[
                        { at: 0, label: '0' },
                        { at: 50, label: count(limitMax / 2) },
                        { at: 100, label: count(limitMax) },
                      ]}
                      top={
                        <>
                          <span className="label">Credit limit per run</span>
                          <output className="readout">
                            {count(draft.creditLimit)}
                            {perRecord > 0 && (
                              <>
                                {' · '}
                                <span className="soft">{count(Math.floor(draft.creditLimit / perRecord))} records</span>
                              </>
                            )}
                          </output>
                        </>
                      }
                    />
                    <p className="hint" style={{ marginTop: -8 }}>
                      {perRecord > 0
                        ? 'If a run would pass this, Dialed stops it and emails you.'
                        : 'This project’s runs are free, so the limit never stops them.'}
                    </p>
                    <Switch
                      checked={draft.emailOnFail}
                      onChange={(v) => set('emailOnFail', v)}
                      label="Email me if a run fails"
                      text="Email me if a run fails"
                    />
                    <Switch
                      checked={draft.emailCsv}
                      onChange={(v) => set('emailCsv', v)}
                      label="Email me a CSV after each run"
                      text="Email me a CSV after each run"
                    />
                    <div className="field" style={{ gap: 4 }}>
                      <span className="label">Recent runs</span>
                      <ul className="hist">
                        {history.length === 0 && <li className="hint">No runs yet.</li>}
                        {history.map((run) => (
                          <li key={run.id}>
                            <span className={runLed(run)} />
                            <span>{whenText(run.startedAt, current?.timezone ?? timezone)}</span>
                            <span className="what">
                              {run.status === 'failed' || run.status === 'stopped'
                                ? (run.error?.text ?? 'Failed')
                                : [
                                    run.datasetId ? `${count(run.newRows)} new` : `${count(run.rows)} rows`,
                                    run.credits ? `${count(run.credits)} credits` : null,
                                    run.retries
                                      ? `${run.retries} ${run.retries === 1 ? 'retry' : 'retries'}${run.error?.code === 'rate_limited' ? ' after 429' : ''}`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </span>
                            <span className="mono">
                              {run.httpStatus ? `${run.httpStatus} ${run.httpStatus === 200 ? 'OK' : ''}`.trim() : '-'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
