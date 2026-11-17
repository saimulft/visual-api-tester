'use client';

import { Braces, ChevronDown, ChevronLeft, ChevronRight, Copy, Database, Download, Table2, Terminal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '@/components/auth/api';
import {
  Button,
  DataTable,
  Dialog,
  Field,
  FolderTabs,
  Input,
  Menu,
  Segmented,
  Select,
  TabPanel,
  toast,
  type DataColumn,
} from '@/components/ui';
import type { DatasetSummary, SaveModeName, SaveResult } from '@/contracts/datasets';
import { columnsOf, flattenRecord, type Column, type FlatRow } from '@/contracts/rows';
import type { RequestView, RunDetail, RunPreviewDetail } from '@/contracts/workspace';
import type { ApiSpec, Values } from '@/contracts/spec';
import { allControls } from '@/contracts/spec';
import { clock, count, dayText, secondsText, statusText } from './format';

type Tab = 'table' | 'json' | 'request';

const NAME_KEYS = ['name', 'company_name', 'title', 'display_name', 'full_name', 'label'];
const DOMAIN_KEYS = ['website_domain', 'domain', 'website', 'url', 'link'];

function initials(text: string): string {
  const words = text.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase();
}

/** Table columns from the rows: a name column drawn as the canvas's .co cell when there is one, then the rest. */
export function tableColumns(columns: Column[]): DataColumn<FlatRow>[] {
  const nameKey = columns.find((c) => NAME_KEYS.includes(c.key.split('.').pop() ?? ''))?.key;
  const domainKey = nameKey ? columns.find((c) => DOMAIN_KEYS.includes(c.key.split('.').pop() ?? ''))?.key : undefined;
  const out: DataColumn<FlatRow>[] = [];
  if (nameKey)
    out.push({
      id: nameKey,
      header: columns.find((c) => c.key === nameKey)?.label ?? 'Name',
      accessorFn: (row: FlatRow) => row[nameKey],
      cell: (info) => {
        const row = info.row.original;
        const name = String(row[nameKey] ?? '');
        const domain = domainKey ? String(row[domainKey] ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : '';
        return (
          <div className="co">
            <span className="co-tile">{initials(name) || '?'}</span>
            <div>
              <div className="co-name trunc">{name}</div>
              {domain && <div className="co-dom">{domain}</div>}
            </div>
          </div>
        );
      },
    });
  for (const column of columns.slice(0, 40)) {
    if (column.key === nameKey || column.key === domainKey) continue;
    out.push({
      id: column.key,
      header: column.label,
      accessorFn: (row: FlatRow) => row[column.key],
      meta: column.type === 'number' ? { align: 'right' } : undefined,
      cell: (info) => {
        const value = info.getValue() as FlatRow[string];
        if (value === null || value === undefined) return <span className="muted">-</span>;
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        const text = String(value);
        return <span className="trunc" title={text.length > 40 ? text : undefined}>{text.length > 80 ? `${text.slice(0, 80)}…` : text}</span>;
      },
    });
  }
  return out;
}

function curlOf(view: RequestView): string {
  const parts = [`curl -X ${view.method} '${view.url.replace(/'/g, "'\\''")}'`];
  for (const [name, value] of Object.entries(view.headers)) parts.push(`-H '${name}: ${value}'`);
  if (view.body) parts.push(`-H 'content-type: application/json'`, `--data '${view.body.replace(/'/g, "'\\''")}'`);
  return parts.join(' \\\n  ');
}

export function ResultsStage({
  projectId,
  projectName,
  spec,
  run,
  preview,
  running,
  values,
  tab,
  onTab,
  cascade,
  datasets,
  timezone,
  onSaved,
}: {
  projectId: string;
  projectName: string;
  spec: ApiSpec;
  run: RunDetail | null;
  preview: RunPreviewDetail | null;
  running: boolean;
  values: Values;
  tab: Tab;
  onTab: (tab: Tab) => void;
  cascade: number;
  datasets: DatasetSummary[];
  timezone: string;
  sampleCount: number;
  onSaved: () => void;
}) {
  const rows = useMemo(() => (run?.sample ?? []).map((r) => flattenRecord(r)), [run]);
  const columns = useMemo(() => tableColumns(columnsOf(rows.slice(0, 200))), [rows]);
  const [saving, setSaving] = useState(false);
  const idBase = 'results';
  const total = run?.rows ?? 0;
  const views = preview?.requests ?? [];
  const takeControl = allControls(spec).find((c) => c.id === spec.run.takeControlId);
  const take = preview?.take ?? (takeControl && typeof values[takeControl.id] === 'number' ? (values[takeControl.id] as number) : 0);

  const scrollTable = (pages: number) => {
    const box = document.getElementById(`${idBase}-panel-table`)?.querySelector('.tbl-wrap');
    if (box) box.scrollBy({ top: pages * box.clientHeight * 0.9, behavior: 'smooth' });
  };

  const statusLed = !run
    ? 'led is-off'
    : run.status === 'ok'
      ? run.error
        ? 'led is-warn'
        : 'led'
      : run.status === 'failed'
        ? 'led is-err'
        : 'led is-warn';
  const ms = run && run.finishedAt ? run.finishedAt - run.startedAt : 0;
  const unit = preview?.unit ?? 'credits';

  return (
    <section className="ws-results" aria-label="Results">
      <div className="res-head">
        <h2>Last run</h2>
        <button className="btn btn-sm" type="button" onClick={() => setSaving(true)} disabled={!run || total === 0}>
          <Database className="i i-sm" aria-hidden="true" />
          Save to dataset
        </button>
        <Menu
          label="Download"
          trigger={
            <button className="btn btn-sm" type="button" aria-haspopup="menu" disabled={!run || total === 0}>
              <Download className="i i-sm" aria-hidden="true" />
              Download
              <ChevronDown className="i i-sm" aria-hidden="true" />
            </button>
          }
          items={(['csv', 'xlsx', 'json'] as const).map((format) => ({
            label: format === 'csv' ? 'CSV' : format === 'xlsx' ? 'Excel' : 'JSON',
            onSelect: () => {
              if (run) window.location.href = `/api/runs/${run.runId}/export?format=${format}`;
            },
          }))}
        />
        <div className="status" aria-live="polite">
          <span className={statusLed} />
          {run ? (
            <>
              <strong>{run.status === 'running' ? 'Running' : statusText(run.httpStatus)}</strong>
              <span>
                {ms ? `${secondsText(ms)} · ` : ''}
                {dayText(run.startedAt, timezone)} at {clock(run.startedAt, timezone)}
                {run.credits ? ` · ${count(run.credits)} ${unit} used` : ''}
                {run.error ? ` · ${run.error.text}` : ''}
              </span>
            </>
          ) : (
            <span>No runs yet. Set the controls and press Run.</span>
          )}
        </div>
      </div>

      <div className="stage">
        <FolderTabs
          idBase={idBase}
          label="Result views"
          value={tab}
          onChange={onTab}
          meta={run?.matches != null ? `of ${count(run.matches)} matches` : undefined}
          tabs={[
            { value: 'table', label: 'Table', count: count(total), icon: <Table2 className="i i-sm" aria-hidden="true" /> },
            { value: 'json', label: 'JSON', icon: <Braces className="i i-sm" aria-hidden="true" /> },
            { value: 'request', label: 'Request', icon: <Terminal className="i i-sm" aria-hidden="true" /> },
          ]}
        />

        <TabPanel idBase={idBase} value="table" active={tab === 'table'}>
          <DataTable
            key={cascade}
            label={`Rows from the last run of ${projectName}`}
            columns={columns}
            rows={rows}
            height="100%"
            cascade={cascade > 0}
            empty={run ? (run.error?.text ?? 'This run brought back no rows.') : 'Rows show here after a run.'}
          />
          {running && <Loading spec={spec} take={take} />}
        </TabPanel>

        <TabPanel idBase={idBase} value="json" active={tab === 'json'}>
          <pre className="code">{run ? JSON.stringify(run.sample.slice(0, 50), null, 2) : '[]'}</pre>
          {running && <Loading spec={spec} take={take} />}
        </TabPanel>

        <TabPanel idBase={idBase} value="request" active={tab === 'request'}>
          <div className="req">
            {views.length === 0 && <p className="hint">The request shows here once the controls are read.</p>}
            {views.map((view) => {
              const keyHeader = Object.entries(view.headers).find(([, v]) => v.includes('••••'));
              const otherHeaders = Object.entries(view.headers).filter(([k]) => k !== keyHeader?.[0]);
              return (
                <div key={view.endpointId} style={{ display: 'contents' }}>
                  <p className="micro">{view.step}</p>
                  <div className="req-line">
                    <span className={view.method === 'GET' ? 'method get' : 'method'}>{view.method}</span>
                    <code>{view.url.replace(/^https?:\/\//, '')}</code>
                    {view.times !== null && <span className="chip is-soft">× {count(view.times)}</span>}
                  </div>
                  {keyHeader && (
                    <div className="req-line">
                      <span className="method get">KEY</span>
                      <code>
                        {keyHeader[0]}: {keyHeader[1]}
                      </code>
                    </div>
                  )}
                  {otherHeaders.map(([name, value]) => (
                    <div className="req-line" key={name}>
                      <span className="method get">HEAD</span>
                      <code>
                        {name}: {value}
                      </code>
                    </div>
                  ))}
                  {view.body && <pre className="code">{view.body}</pre>}
                </div>
              );
            })}
            {views.length > 0 && (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(views.map(curlOf).join('\n\n'));
                      toast.success('Copied as cURL', { description: 'Put your own key where the dots are.' });
                    } catch {
                      toast.error('Couldn’t copy. Select the text instead.');
                    }
                  }}
                >
                  <Copy className="i i-sm" aria-hidden="true" />
                  Copy as cURL
                </button>
                <span className="hint">Dialed sends these for you. Copy them to run the same thing anywhere.</span>
              </div>
            )}
          </div>
        </TabPanel>

        <div className="stage-foot">
          <span className="hint">
            {run
              ? rows.length < total
                ? `First ${count(rows.length)} of ${count(total)} rows · all of them go to a dataset or a download`
                : `${count(total)} ${total === 1 ? 'row' : 'rows'} · kept with this run`
              : 'No rows yet'}
          </span>
          <div className="pager">
            <button className="btn btn-sm btn-icon btn-ghost" type="button" aria-label="Previous page" onClick={() => scrollTable(-1)}>
              <ChevronLeft className="i" aria-hidden="true" />
            </button>
            <button className="btn btn-sm btn-icon btn-ghost" type="button" aria-label="Next page" onClick={() => scrollTable(1)}>
              <ChevronRight className="i" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {run && (
        <SaveDialog
          open={saving}
          onOpenChange={setSaving}
          projectId={projectId}
          projectName={projectName}
          runId={run.runId}
          rows={total}
          datasets={datasets}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}

function Loading({ spec, take }: { spec: ApiSpec; take: number }) {
  return (
    <div className="loading">
      <span className="spin dark" aria-hidden="true" />
      <span>
        {spec.run.mode === 'searchThenCollect' ? `Searching, then collecting ${count(take)} records` : 'Running the request'}
      </span>
    </div>
  );
}

const MODES: { value: SaveModeName; label: string }[] = [
  { value: 'append', label: 'Add new rows' },
  { value: 'replace', label: 'Replace all' },
  { value: 'keep', label: 'Keep each run' },
];

/** Save to dataset: pick a dataset or make one, and how the rows go in. */
function SaveDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  runId,
  rows,
  datasets,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  runId: string;
  rows: number;
  datasets: DatasetSummary[];
  onSaved: () => void;
}) {
  const NEW = '__new__';
  const [target, setTarget] = useState<string>(datasets[0]?.id ?? NEW);
  const [name, setName] = useState(projectName);
  const current = datasets.find((d) => d.id === target);
  const [mode, setMode] = useState<SaveModeName>(current?.saveMode ?? 'append');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      let saved: SaveResult | null = null;
      if (target === NEW) {
        const res = await api<{ dataset: DatasetSummary }>('/api/datasets', { projectId, name, saveMode: mode });
        if (!res.ok) return toast.error(res.error.message);
        const into = await api<{ saved: SaveResult }>(`/api/datasets/${res.data.dataset.id}/save`, { runId, mode });
        if (!into.ok) return toast.error(into.error.message);
        saved = into.data.saved;
      } else {
        const res = await api<{ saved: SaveResult }>(`/api/datasets/${target}/save`, { runId, mode });
        if (!res.ok) return toast.error(res.error.message);
        saved = res.data.saved;
      }
      toast.success(
        `${count(saved.newRows)} new ${saved.newRows === 1 ? 'row' : 'rows'} saved`,
        {
          description: [
            saved.skipped ? `${count(saved.skipped)} repeats skipped.` : '',
            saved.fromSample ? 'Only the rows still kept with this run were saved. Run again to save them all.' : '',
          ]
            .filter(Boolean)
            .join(' ') || `${count(saved.rows)} rows in the dataset now.`,
        },
      );
      onOpenChange(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Save to dataset"
      description={`${count(rows)} ${rows === 1 ? 'row' : 'rows'} from this run.`}
      actions={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()} disabled={target === NEW && !name.trim()}>
            Save rows
          </Button>
        </>
      }
    >
      <div className="field">
        <span className="label">Dataset</span>
        <Select
          label="Dataset"
          value={target}
          onChange={(v) => {
            setTarget(v);
            const picked = datasets.find((d) => d.id === v);
            if (picked) setMode(picked.saveMode);
          }}
          options={[
            ...datasets.map((d) => ({ value: d.id, label: d.name, end: `${count(d.rows)} rows` })),
            { value: NEW, label: 'A new dataset' },
          ]}
        />
      </div>
      {target === NEW && (
        <Field label="Name">{({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      )}
      <div className="field">
        <span className="label">When a run finishes</span>
        <Segmented block label="When a run finishes" options={MODES} value={mode} onChange={setMode} />
        <p className="hint">
          {mode === 'append'
            ? current?.keyLabel
              ? `Skips rows already saved, matched on ${current.keyLabel}.`
              : 'Adds every row, skipping any already saved when the records have an id.'
            : mode === 'replace'
              ? 'The dataset becomes just this run’s rows.'
              : 'Keeps this run’s rows next to every earlier run’s.'}
        </p>
      </div>
    </Dialog>
  );
}
