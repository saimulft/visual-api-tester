'use client';

import { ArrowRight, Database, Download, Link2Off, Plus, RefreshCw, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api } from '@/components/auth/api';
import { Topbar } from '@/components/shell';
import { CopyField, DataTable, EmptyState, Kbd, Monogram, Segmented, Select, toast } from '@/components/ui';
import { bytesText, clock, count, dateText, shortDay } from '@/components/workspace/format';
import { tableColumns } from '@/components/workspace/results-stage';
import type { Dataset, DatasetRowsPage, DatasetSummary, ExportFormat, SaveModeName } from '@/contracts/datasets';
import type { FlatRow } from '@/contracts/rows';

/** Screen 08 (Data.dc.html and DataPhone.dc.html). */
type Since = 'any' | 'day' | 'week' | 'month';
const DAY = 24 * 60 * 60 * 1000;
const SINCE_MS: Record<Since, number> = { any: Infinity, day: DAY, week: 7 * DAY, month: 31 * DAY };
const CADENCE_WORD = {
  hourly: 'Hourly pull',
  daily: 'Daily pull',
  weekly: 'Weekly pull',
  monthly: 'Monthly pull',
} as const;
const FORMAT_NAME: Record<ExportFormat, string> = { csv: 'CSV', xlsx: 'Excel', json: 'JSON' };

function sourceText(d: DatasetSummary): string {
  return d.source.cadence ? CADENCE_WORD[d.source.cadence] : 'Run by hand';
}
function sourceLed(d: DatasetSummary): string {
  return { on: 'led is-live', paused: 'led is-off', failed: 'led is-err', manual: 'led is-off' }[d.source.state];
}

export function SavedData({
  datasets,
  projects,
  initial,
  timezone,
}: {
  datasets: DatasetSummary[];
  projects: { id: string; name: string }[];
  initial: { dataset: Dataset; rows: DatasetRowsPage } | null;
  timezone: string;
}) {
  const [q, setQ] = useState('');
  const [projectId, setProjectId] = useState('all');
  const [since, setSince] = useState<Since>('any');
  // When the time filter was picked: rows updated within its window of that moment show.
  const [sinceFrom, setSinceFrom] = useState(0);
  const [selected, setSelected] = useState(initial);
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [cols, setCols] = useState<string[] | null>(null);
  const [allCols, setAllCols] = useState(false);
  const [list, setList] = useState(datasets);

  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    return list.filter(
      (d) =>
        (projectId === 'all' || d.projectId === projectId) &&
        (since === 'any' || sinceFrom - d.updatedAt <= SINCE_MS[since]) &&
        (!text || d.name.toLowerCase().includes(text) || d.projectName.toLowerCase().includes(text)),
    );
  }, [list, q, projectId, since, sinceFrom]);
  const totalRows = shown.reduce((sum, d) => sum + d.rows, 0);

  const select = async (id: string) => {
    if (selected?.dataset.id === id) return;
    const [d, r] = await Promise.all([
      api<{ dataset: Dataset }>(`/api/datasets/${id}`),
      api<{ page: DatasetRowsPage }>(`/api/datasets/${id}/rows?pageSize=50`),
    ]);
    if (!d.ok || !r.ok) return toast.error(d.ok ? (r.ok ? '' : r.error.message) : d.error.message);
    setSelected({ dataset: d.data.dataset, rows: r.data.page });
    setCols(null);
    setAllCols(false);
    window.history.replaceState(null, '', `/data?id=${id}`);
  };

  const update = (dataset: Dataset) => {
    setSelected((s) => (s ? { ...s, dataset } : s));
    setList((l) => l.map((d) => (d.id === dataset.id ? { ...d, ...dataset } : d)));
  };

  const setMode = async (mode: SaveModeName) => {
    if (!selected) return;
    const res = await api<{ dataset: Dataset }>(
      `/api/datasets/${selected.dataset.id}`,
      { saveMode: mode },
      { method: 'PATCH' },
    );
    if (!res.ok) return toast.error(res.error.message);
    update(res.data.dataset);
  };

  const link = async (on: boolean) => {
    if (!selected) return;
    const res = await api<{ dataset: Dataset }>(`/api/datasets/${selected.dataset.id}/csv-link`, undefined, {
      method: on ? 'POST' : 'DELETE',
    });
    if (!res.ok) return toast.error(res.error.message);
    update(res.data.dataset);
    toast.success(on ? 'New live link made' : 'Live link turned off', {
      description: on ? 'Any old link stops working.' : 'Spreadsheets using it stop updating.',
    });
  };

  const search = (
    <label className="search">
      <Search className="i i-sm" aria-hidden="true" />
      <span className="sr">Search saved data</span>
      <input type="search" placeholder="Search datasets and rows" value={q} onChange={(e) => setQ(e.target.value)} />
      <Kbd>⌘K</Kbd>
    </label>
  );

  if (!datasets.length)
    return (
      <>
        <Topbar title="Saved data" search={false} />
        <div className="page">
          <div className="page-in">
            <EmptyState
              icon={<Database className="i" aria-hidden="true" />}
              title="Nothing saved yet"
              action={
                <Link className="btn btn-primary has-tile" href="/projects">
                  <span className="tile">
                    <ArrowRight className="i" aria-hidden="true" />
                  </span>
                  Open a project
                </Link>
              }
            >
              Run a project, then press Save to dataset. Its rows land here, ready to download or link to a spreadsheet.
            </EmptyState>
          </div>
        </div>
      </>
    );

  const d = selected?.dataset ?? null;
  const columns = d?.columns ?? [];
  const picked = cols ?? columns.slice(0, 5).map((c) => c.key);
  const previewColumns = selected
    ? [
        ...tableColumns(selected.rows.columns.slice(0, 5)),
        {
          id: '_at',
          header: 'Added',
          accessorFn: (row: FlatRow & { _at: number }) => row._at,
          cell: (info: { getValue: () => unknown }) => (
            <span className="mono" style={{ fontSize: 12.5 }}>
              {dateText(Number(info.getValue()), timezone)}
            </span>
          ),
        },
      ]
    : [];
  const exportHref = d
    ? `/api/exports?datasetId=${d.id}&format=${format}${cols ? `&columns=${encodeURIComponent(picked.join(','))}` : ''}`
    : '#';
  const maxBar = Math.max(1, ...(d?.perRun.map((r) => r.newRows) ?? [1]));

  return (
    <>
      <Topbar title="Saved data" search={false} action={search} />
      <div className="page">
        <div className="page-in">
          <p className="page-sub" style={{ margin: '0 0 18px' }}>
            Every run you keep lands here. Download it, or give a spreadsheet a live link.
          </p>
          <div className="data">
            <div className="data-main">
              <section className="data-list" aria-label="Datasets">
                <div className="data-filters">
                  <Select
                    label="Project"
                    value={projectId}
                    onChange={setProjectId}
                    options={[
                      { value: 'all', label: 'All projects' },
                      ...projects.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />
                  <Select
                    label="Updated"
                    value={since}
                    onChange={(v) => {
                      setSince(v);
                      setSinceFrom(Date.now());
                    }}
                    options={[
                      { value: 'any', label: 'Any time' },
                      { value: 'day', label: 'Last day' },
                      { value: 'week', label: 'Last 7 days' },
                      { value: 'month', label: 'Last 31 days' },
                    ]}
                  />
                  <span className="grow" />
                  <span className="hint num">
                    {count(shown.length)} {shown.length === 1 ? 'dataset' : 'datasets'} · {count(totalRows)} rows
                  </span>
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th scope="col">Dataset</th>
                        <th scope="col" className="r">
                          Rows
                        </th>
                        <th scope="col">Updated</th>
                        <th scope="col">Comes from</th>
                        <th scope="col" className="r">
                          Size
                        </th>
                        <th scope="col">
                          <span className="sr">Download</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.length === 0 && (
                        <tr>
                          <td colSpan={6} className="tbl-empty">
                            No datasets match.
                          </td>
                        </tr>
                      )}
                      {shown.map((row) => (
                        <tr
                          key={row.id}
                          className={row.id === d?.id ? 'is-sel is-click' : 'is-click'}
                          onClick={() => void select(row.id)}
                          aria-selected={row.id === d?.id}
                        >
                          <td>
                            <div className="co">
                              <span className="co-tile" style={row.id === d?.id ? { background: '#fff' } : undefined}>
                                {row.monogram}
                              </span>
                              <div>
                                <button
                                  className="co-name"
                                  type="button"
                                  style={{ textAlign: 'left' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void select(row.id);
                                  }}
                                >
                                  {row.name}
                                </button>
                                <div className="hint">{row.projectName}</div>
                              </div>
                            </div>
                          </td>
                          <td className="r">{count(row.rows)}</td>
                          <td className="mono" style={{ fontSize: 12.5 }}>
                            {shortDay(row.updatedAt, timezone)}
                          </td>
                          <td>
                            <span className="chip">
                              <span className={sourceLed(row)} />
                              {sourceText(row)}
                            </span>
                          </td>
                          <td className="r">{bytesText(row.bytes)}</td>
                          <td>
                            <a
                              className="btn btn-sm btn-icon btn-ghost"
                              href={`/api/exports?datasetId=${row.id}&format=csv`}
                              aria-label={`Download ${row.name}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Download className="i i-sm" aria-hidden="true" />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {selected && d && (
                <section className="data-list" aria-label={`Preview of ${d.name}`}>
                  <div className="data-filters">
                    <span className="micro grow">Preview · newest rows first</span>
                    <Link className="btn btn-sm btn-ghost" href={`/projects/${d.projectId}`}>
                      Open project
                      <ArrowRight className="i i-sm" aria-hidden="true" />
                    </Link>
                  </div>
                  <DataTable
                    label={`Newest rows of ${d.name}`}
                    columns={previewColumns as never}
                    rows={selected.rows.rows}
                    height={Math.min(420, 46 + Math.max(1, selected.rows.rows.length) * 45)}
                    empty="No rows yet."
                  />
                </section>
              )}
            </div>

            {d && (
              <aside className="data-side" aria-label="Selected dataset">
                <section className="panel">
                  <div className="panel-head">
                    <Monogram text={d.monogram} tone="signal" size="sm" />
                    <div className="grow">
                      <h2 className="panel-title">{d.name}</h2>
                      <p className="hint">
                        {d.source.cadence
                          ? `${sourceText(d)} from ${d.projectName}`
                          : `Run by hand in ${d.projectName}`}
                      </p>
                    </div>
                  </div>
                  <div className="stats">
                    <div className="stat">
                      <strong>{count(d.rows)}</strong>
                      <span>rows</span>
                    </div>
                    <div className="stat">
                      <strong>{count(d.runs)}</strong>
                      <span>runs saved</span>
                    </div>
                    <div className="stat">
                      <strong>{count(d.repeatsSkipped)}</strong>
                      <span>repeats skipped</span>
                    </div>
                  </div>
                  {d.perRun.length > 0 && (
                    <div className="field" style={{ gap: 8 }}>
                      <span className="micro">New rows per run</span>
                      <div
                        className="bars"
                        aria-label={`New rows per run: ${d.perRun.map((r) => r.newRows).join(', ')}`}
                      >
                        {d.perRun.map((r, i) => (
                          <span
                            key={r.runId ?? i}
                            className={i === d.perRun.length - 1 ? 'is-now' : undefined}
                            style={{ height: `${Math.max(4, Math.round((r.newRows / maxBar) * 100))}%` }}
                            title={`${count(r.newRows)} new on ${dateText(r.at, timezone)}`}
                          />
                        ))}
                      </div>
                      <div className="bars-x">
                        {d.perRun.map((r, i) => {
                          // Runs on one day read by the clock; otherwise by the date, the month only when it changes.
                          const oneDay =
                            dateText(d.perRun[0].at, timezone) === dateText(d.perRun[d.perRun.length - 1].at, timezone);
                          const label = oneDay ? clock(r.at, timezone) : dateText(r.at, timezone);
                          const prev = i > 0 ? dateText(d.perRun[i - 1].at, timezone) : '';
                          const sameMonth = !oneDay && prev && prev.split(' ')[1] === label.split(' ')[1];
                          return <span key={r.runId ?? i}>{sameMonth ? label.split(' ')[0] : label}</span>;
                        })}
                      </div>
                    </div>
                  )}
                  <div className="field" style={{ gap: 8 }}>
                    <span className="label">When a run finishes</span>
                    <Segmented
                      block
                      label="When a run finishes"
                      value={d.saveMode}
                      onChange={(mode) => void setMode(mode)}
                      options={[
                        { value: 'append', label: 'Add new rows' },
                        { value: 'replace', label: 'Replace all' },
                        { value: 'keep', label: 'Keep each run' },
                      ]}
                    />
                    <p className="hint">
                      {d.saveMode === 'append'
                        ? d.keyLabel
                          ? `Skips ${d.noun} already saved, matched on ${d.keyLabel}, so repeats cost no credits.`
                          : 'Adds every row: these records have no id to match repeats on.'
                        : d.saveMode === 'replace'
                          ? 'Each run replaces every row with what it brought back.'
                          : 'Keeps every run’s rows, side by side.'}
                    </p>
                  </div>
                </section>

                <section className="panel">
                  <div className="panel-head">
                    <h2 className="panel-title">Take the data</h2>
                  </div>
                  <Segmented
                    block
                    label="File type"
                    value={format}
                    onChange={setFormat}
                    options={(['csv', 'xlsx', 'json'] as const).map((f) => ({ value: f, label: FORMAT_NAME[f] }))}
                  />
                  {columns.length > 0 && (
                    <div className="export-cols" role="group" aria-label="Columns to download">
                      {(allCols ? columns : columns.slice(0, 6)).map((c) => {
                        const on = picked.includes(c.key);
                        return (
                          <button
                            key={c.key}
                            type="button"
                            className={on ? 'chip is-on' : 'chip'}
                            aria-pressed={on}
                            onClick={() =>
                              setCols(
                                on
                                  ? picked.filter((k) => k !== c.key)
                                  : columns.map((x) => x.key).filter((k) => k === c.key || picked.includes(k)),
                              )
                            }
                          >
                            {c.label}
                          </button>
                        );
                      })}
                      {!allCols && columns.length > 6 && (
                        <button className="chip chip-add" type="button" onClick={() => setAllCols(true)}>
                          <Plus className="i" aria-hidden="true" />
                          {columns.length - 6} more
                        </button>
                      )}
                    </div>
                  )}
                  <a
                    className="btn btn-primary has-tile"
                    href={exportHref}
                    aria-disabled={picked.length === 0 || undefined}
                  >
                    <span className="tile">
                      <Download className="i" aria-hidden="true" />
                    </span>
                    Download {count(d.rows)} rows as {FORMAT_NAME[format]}
                  </a>
                  <div className="field" style={{ gap: 8 }}>
                    <span className="label">Live link for spreadsheets</span>
                    {d.csvUrl ? (
                      <>
                        <CopyField value={d.csvUrl} />
                        <p className="hint">
                          In Google Sheets, type =IMPORTDATA and paste the link. It always serves the newest rows.
                        </p>
                        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <button className="btn btn-sm" type="button" onClick={() => void link(true)}>
                            <RefreshCw className="i i-sm" aria-hidden="true" />
                            New link
                          </button>
                          <button className="btn btn-sm btn-ghost" type="button" onClick={() => void link(false)}>
                            <Link2Off className="i i-sm" aria-hidden="true" />
                            Turn off
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="hint">
                          A private link that serves this dataset as CSV, for =IMPORTDATA in Google Sheets.
                        </p>
                        <button
                          className="btn btn-sm"
                          type="button"
                          onClick={() => void link(true)}
                          style={{ alignSelf: 'flex-start' }}
                        >
                          Make a live link
                        </button>
                      </>
                    )}
                  </div>
                </section>
              </aside>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
