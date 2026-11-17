'use client';

import { FolderPlus, MoreHorizontal, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/components/auth/api';
import { PageFrame, Topbar } from '@/components/shell';
import { EmptyState, Menu, Monogram, Segmented, toast } from '@/components/ui';
import { clock, count, whenText } from '@/components/workspace/format';
import { cardTiming } from '@/components/workspace/timing-text';
import type { ProjectStats } from '@/server/services/project-stats';
import type { RunSummary } from '@/contracts/workspace';
import type { CardStrip } from './cards';

/** Screen 03 (Projects.dc.html and ProjectsPhone.dc.html). */
export type ProjectCard = {
  id: string;
  name: string;
  monogram: string;
  keyed: boolean;
  apiLine: string;
  ready: boolean;
  status: string;
  strip: CardStrip;
  chips: string[];
  rows: number;
  schedule: ProjectStats['perProject'][string]['schedule'];
  lastStatus: string | null;
};

type Filter = 'all' | 'scheduled' | 'manual';

/** A run in words, the way Recent runs reads: "25 new rows saved · 500 credits", or the friendly error. */
export function runNote(run: RunSummary): string {
  if (run.status === 'running') return 'Running now';
  if (run.status === 'failed' || run.status === 'stopped') return run.error?.text ?? 'The run failed.';
  const parts: string[] = [];
  if (run.error?.code === 'rate_limited') parts.push(`${run.error.text}, then worked`);
  else if (run.error) parts.push(run.error.text);
  parts.push(run.datasetId ? `${count(run.newRows)} new ${run.newRows === 1 ? 'row' : 'rows'} saved` : `${count(run.rows)} ${run.rows === 1 ? 'row' : 'rows'}`);
  if (run.credits) parts.push(`${count(run.credits)} credits`);
  if (run.trigger === 'manual') parts.push('run by hand');
  return parts.join(' · ');
}

export function runLed(run: { status: string; error: { code: string } | null }): string {
  if (run.status === 'failed') return 'led is-err';
  if (run.status === 'stopped' || run.status === 'partial' || run.error) return 'led is-warn';
  if (run.status === 'running') return 'led is-live';
  return 'led';
}

export function ProjectsHome({
  cards,
  stats,
  recent,
  ai,
  timezone,
}: {
  cards: ProjectCard[];
  stats: ProjectStats;
  recent: RunSummary[];
  ai: { mcp: string | null; model: string | null; provider: string | null };
  timezone: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const scheduled = cards.filter((c) => c.schedule?.status === 'on');
  const shown = filter === 'all' ? cards : filter === 'scheduled' ? scheduled : cards.filter((c) => c.schedule?.status !== 'on');

  const archive = async (card: ProjectCard) => {
    const res = await api(`/api/projects/${card.id}`, undefined, { method: 'DELETE' });
    if (!res.ok) return toast.error(res.error.message);
    toast.success(`Archived “${card.name}”`, { description: 'Its saved data stays in Saved data.' });
    router.refresh();
  };

  const newButton = (
    <Link className="btn btn-primary has-tile" href="/projects/new">
      <span className="tile">
        <Plus className="i" aria-hidden="true" />
      </span>
      New project
    </Link>
  );

  if (!cards.length)
    return (
      <>
        <Topbar
          title="Projects"
          action={newButton}
          phoneAction={
            <Link className="btn btn-sm btn-icon btn-primary" href="/projects/new" aria-label="New project">
              <Plus className="i" aria-hidden="true" />
            </Link>
          }
        />
        <PageFrame>
          <EmptyState
            icon={<FolderPlus className="i" aria-hidden="true" />}
            title="Set up your first API"
            action={
              <Link className="btn btn-primary has-tile" href="/projects/new">
                <span className="tile">
                  <Plus className="i" aria-hidden="true" />
                </span>
                New project
              </Link>
            }
          >
            Paste an API key and tell the AI what data you want. It reads the docs and builds the controls.
          </EmptyState>
        </PageFrame>
      </>
    );

  return (
    <>
      <Topbar
        title="Projects"
        action={newButton}
        phoneAction={
          <Link className="btn btn-sm btn-icon btn-primary" href="/projects/new" aria-label="New project">
            <Plus className="i" aria-hidden="true" />
          </Link>
        }
      />
      <PageFrame>
        <div className="kpis">
          <div className="kpi">
            <span className="micro">Requests this week</span>
            <span className="kpi-val num">{count(stats.requestsThisWeek)}</span>
            <span className="kpi-sub">
              <span className={stats.retriedThisWeek ? 'led is-warn' : 'led'} />
              {stats.retriedThisWeek
                ? `${count(stats.retriedThisWeek)} retried after a rate limit`
                : 'None needed a retry'}
            </span>
          </div>
          <div className="kpi">
            <span className="micro">Rows stored</span>
            <span className="kpi-val num">{count(stats.rowsStored)}</span>
            <span className="kpi-sub">
              Across {count(stats.datasets)} {stats.datasets === 1 ? 'dataset' : 'datasets'}
            </span>
          </div>
          <div className="kpi">
            <span className="micro">Next pull</span>
            <span className="kpi-val num">
              {stats.nextPull
                ? stats.nextPull.at - Date.now() < 20 * 60 * 60 * 1000
                  ? clock(stats.nextPull.at, timezone)
                  : whenText(stats.nextPull.at, timezone).replace(/ \d\d:\d\d$/, '')
                : 'None'}
            </span>
            <span className="kpi-sub">
              <span className={stats.nextPull ? 'led is-live' : 'led is-off'} />
              {stats.nextPull ? stats.nextPull.projectName : 'No schedules on'}
            </span>
          </div>
          <div className="kpi">
            <span className="micro">Your AI</span>
            <span className="kpi-val">{ai.mcp ?? ai.model ?? 'Not set'}</span>
            <span className="kpi-sub">
              <span className={ai.mcp || ai.model ? 'led is-ai' : 'led is-off'} />
              {ai.mcp ? (
                'Connected through MCP'
              ) : ai.model ? (
                'With your own key'
              ) : (
                <Link href="/welcome/ai">Connect your AI</Link>
              )}
            </span>
          </div>
        </div>

        <div className="page-head" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 18 }}>Your projects</h2>
          <Segmented
            label="Filter projects"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All ${cards.length}` },
              { value: 'scheduled', label: `On a schedule ${scheduled.length}` },
              { value: 'manual', label: `Manual ${cards.length - scheduled.length}` },
            ]}
          />
        </div>

        <div className="pgrid">
          {shown.map((card) => {
            const failed = card.status === 'failed' || card.lastStatus === 'failed';
            const href = card.ready ? `/projects/${card.id}` : `/projects/${card.id}/setup`;
            const led = failed ? 'led is-err' : card.schedule?.status === 'on' ? 'led is-live' : 'led is-off';
            const foot = failed
              ? card.ready
                ? 'Last run failed'
                : 'Setup failed'
              : !card.ready
                ? 'Not set up yet'
                : card.schedule?.status === 'on'
                  ? cardTiming(card.schedule)
                  : card.schedule
                    ? 'Schedule paused'
                    : 'Run by hand';
            return (
              <article key={card.id} className="pcard">
                <div className="pcard-head">
                  <Monogram text={card.monogram} tone={card.keyed ? 'signal' : 'default'} />
                  <div className="grow">
                    <Link className="pcard-name" href={href}>
                      {card.name}
                    </Link>
                    <p className="pcard-api">{card.apiLine}</p>
                  </div>
                  <Menu
                    label={`More actions for ${card.name}`}
                    trigger={
                      <button className="btn btn-sm btn-icon btn-ghost pcard-more" type="button" aria-label={`More actions for ${card.name}`}>
                        <MoreHorizontal className="i" aria-hidden="true" />
                      </button>
                    }
                    items={[
                      { label: 'Open', onSelect: () => router.push(href) },
                      { label: 'Ask the AI for changes', onSelect: () => router.push(`/projects/${card.id}/setup?change=1`) },
                      { label: 'Schedule it', onSelect: () => router.push(`/schedules?project=${card.id}`) },
                      'separator',
                      { label: 'Archive', danger: true, onSelect: () => void archive(card) },
                    ]}
                  />
                </div>
                {card.strip && (
                  <div className="pcard-desk">
                    <div className="pcard-desk-row">
                      <span>{card.strip.label}</span>
                      <span className="readout">{card.strip.readout}</span>
                    </div>
                    <div className="track is-static" aria-hidden="true">
                      <div className="zone">
                        <div className="fill" style={{ left: `${card.strip.fill.left}%`, width: `${card.strip.fill.width}%` }} />
                      </div>
                      {card.strip.knobs.map((k, i) => (
                        <span key={i} className="knob" style={{ left: `calc(11px + (100% - 22px) * ${(k / 100).toFixed(4)})` }} />
                      ))}
                    </div>
                    {card.chips.length > 0 && (
                      <div className="chips">
                        {card.chips.map((chip) => (
                          <span key={chip} className="chip">
                            {chip}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="pcard-foot">
                  <span className="row" style={{ gap: 8 }}>
                    <span className={led} />
                    {foot}
                  </span>
                  <span>
                    <strong className="num">{count(card.rows)}</strong> rows
                  </span>
                </div>
              </article>
            );
          })}
          {filter !== 'scheduled' && (
            <Link className="pcard is-new" href="/projects/new">
              <span className="mtile is-ink lg">
                <Plus className="i" aria-hidden="true" />
              </span>
              <span style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 17, letterSpacing: '-.015em' }}>
                New project
              </span>
              <span className="hint" style={{ maxWidth: '28ch' }}>
                Paste an API key and tell the AI what data you want.
              </span>
            </Link>
          )}
        </div>

        <h2 className="sect-title">Recent runs</h2>
        <div className="runs">
          {recent.length === 0 && (
            <div className="run-row">
              <span className="note">No runs yet. Open a project and press Run.</span>
            </div>
          )}
          {recent.map((run) => (
            <Link key={run.id} className="run-row" href={`/projects/${run.projectId}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className="what">
                <span className={runLed(run)} />
                <span>{run.projectName}</span>
              </span>
              <span className="note proj">{run.apiName}</span>
              <span className="note">{runNote(run)}</span>
              <span className="when">{whenText(run.startedAt, timezone)}</span>
            </Link>
          ))}
        </div>
      </PageFrame>
    </>
  );
}
