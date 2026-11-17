'use client';

import { Download, FolderPlus, MoreHorizontal, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Me } from '@/contracts/auth';
import { AppShell, PageFrame, Topbar } from '@/components/shell';
import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Chip,
  ChipButton,
  CopyField,
  DataTable,
  DatePicker,
  Dialog,
  EmptyState,
  Field,
  FolderTabs,
  Input,
  Kbd,
  Kpi,
  Led,
  Menu,
  Monogram,
  MultiSelect,
  Panel,
  PasswordInput,
  ProvLegend,
  SearchSelect,
  Segmented,
  Select,
  Skeleton,
  Stepper,
  Switch,
  TabPanel,
  Tag,
  Textarea,
  TimePicker,
  Tooltip,
  toast,
  type DataColumn,
  type DateRange,
} from '@/components/ui';

const DEMO_USER: Me = {
  id: 'demo',
  email: 'nadia@brightfield.com.au',
  name: 'Nadia Rahman',
  initials: 'NR',
  workspace: 'Brightfield',
  timezone: 'Australia/Sydney',
  emailChecked: false,
  mcpHandle: 'demo',
  alertEmail: null,
  alertsMuted: false,
  createdAt: 0,
};

const INDUSTRIES = [
  'Software Development',
  'IT Services and IT Consulting',
  'Computer Hardware and Software',
  'Financial Services',
  'Marketing Services',
  'Retail',
  'Hospitals and Health Care',
  'Higher Education',
].map((v) => ({ value: v, label: v }));

type Company = { id: string; name: string; domain: string; employees: number; city: string };
const NAMES = [
  'Kestrel Labs',
  'Tidepool Analytics',
  'Ironbark Systems',
  'Saltbush Digital',
  'Wattle Works',
  'Bluegum Data',
  'Coral Point',
  'Redgum Studio',
];
const CITIES = ['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Hobart'];
const ROWS: Company[] = Array.from({ length: 2000 }, (_, i) => {
  const name = `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ''}`;
  return {
    id: String(i),
    name,
    domain: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com.au`,
    employees: 20 + ((i * 37) % 480),
    city: CITIES[i % CITIES.length],
  };
});
const COLUMNS: DataColumn<Company>[] = [
  {
    accessorKey: 'name',
    header: 'Company',
    cell: ({ row }) => (
      <span className="co">
        <span className="co-tile">{row.original.name.slice(0, 2).toUpperCase()}</span>
        <span>
          <span className="co-name">{row.original.name}</span>
          <br />
          <span className="co-dom">{row.original.domain}</span>
        </span>
      </span>
    ),
  },
  { accessorKey: 'city', header: 'City' },
  {
    accessorKey: 'employees',
    header: 'Employees',
    meta: { align: 'right' },
    cell: ({ getValue }) => (getValue() as number).toLocaleString('en-AU'),
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 className="sect-title">{title}</h2>
      {children}
    </section>
  );
}

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
  alignItems: 'start',
} as const;

export function Showcase({ checked }: { checked: boolean }) {
  const [seg, setSeg] = useState<'table' | 'json' | 'request'>('table');
  const [tab, setTab] = useState<'table' | 'json' | 'request'>('table');
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  const [box, setBox] = useState(true);
  const [size, setSize] = useState<string | null>('51-200');
  const [industry, setIndustry] = useState<string | null>(null);
  const [industries, setIndustries] = useState<string[]>(['Software Development', 'IT Services and IT Consulting']);
  const [date, setDate] = useState<string | null>('2023-01-01');
  const [range, setRange] = useState<DateRange>({ min: '2026-11-01', max: '2026-11-17' });
  const [time, setTime] = useState('09:00');
  const [take, setTake] = useState(25);
  const [password, setPassword] = useState('field-notes-2026!');
  const [dialog, setDialog] = useState(false);

  return (
    <AppShell user={{ ...DEMO_USER, emailChecked: checked }}>
      <Topbar
        title="UI kit"
        crumbs="Dev only"
        action={
          <ButtonLink variant="primary" tile={<Plus className="i" aria-hidden="true" />} href="/dev/ui">
            New project
          </ButtonLink>
        }
        phoneAction={
          <ButtonLink variant="primary" size="sm" icon href="/dev/ui" aria-label="New project">
            <Plus className="i" aria-hidden="true" />
          </ButtonLink>
        }
      />
      <PageFrame
        title="Every component and state"
        sub="For chats A and B: each piece with hover, focus, active and disabled. Not shown in production."
      >
        <Section title="Buttons">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button variant="primary" tile={<FolderPlus className="i" aria-hidden="true" />}>
              Primary with tile
            </Button>
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">
              <Trash2 className="i" aria-hidden="true" />
              Danger
            </Button>
            <Button variant="dark">Dark</Button>
            <Button variant="ai">Ask AI</Button>
            <Button icon aria-label="More">
              <MoreHorizontal className="i" aria-hidden="true" />
            </Button>
            <Button size="sm">Small</Button>
            <Button size="lg" variant="primary">
              Large
            </Button>
            <Button variant="primary" busy>
              Busy
            </Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section title="Chips, tags, LEDs, monograms and keys">
          <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
            <Chip>Default</Chip>
            <Chip tone="on">On</Chip>
            <Chip tone="ai">Made by AI</Chip>
            <Chip tone="soft">Soft</Chip>
            <Chip tone="warn">Retried</Chip>
            <Chip tone="err">Failed</Chip>
            <Chip tone="dark">Dark</Chip>
            <ChipButton onClick={() => toast('Chip clicked')}>Button chip</ChipButton>
            <ChipButton className="chip-add">
              <Plus className="i" aria-hidden="true" />
              Add
            </ChipButton>
            <ChipButton disabled>Disabled</ChipButton>
            <Tag tone="get">GET</Tag>
            <Tag tone="post">POST</Tag>
            <Tag tone="free">FREE</Tag>
            <Tag>logRange</Tag>
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 18, marginTop: 14 }}>
            <span className="row">
              <Led state="live" /> Live
            </span>
            <span className="row">
              <Led state="connected" /> Connected
            </span>
            <span className="row">
              <Led state="paused" /> Paused
            </span>
            <span className="row">
              <Led state="failed" /> Failed
            </span>
            <span className="row">
              <Led state="ai" /> AI
            </span>
            <span className="row">
              <Led state="warn" /> Warn
            </span>
            <Monogram text="CS" />
            <Monogram text="HN" tone="signal" />
            <Monogram text="OM" tone="ai" />
            <Monogram text="AU" tone="ink" size="lg" />
            <Monogram text="SW" tone="warm" size="sm" />
            <Kbd>⌘K</Kbd>
            <ProvLegend />
          </div>
        </Section>

        <Section title="Fields">
          <div style={grid}>
            <Field label="Work email" hint="We’ll send a link to check it.">
              {({ id, describedBy }) => <Input id={id} placeholder="you@company.com" aria-describedby={describedBy} />}
            </Field>
            <Field label="With an error" error="That email doesn’t look right.">
              {({ id, describedBy, invalid }) => (
                <Input id={id} defaultValue="nadia@" invalid={invalid} aria-describedby={describedBy} />
              )}
            </Field>
            <Field label="Disabled">{({ id }) => <Input id={id} defaultValue="Can’t change this" disabled />}</Field>
            <Field label="Password">
              {({ id }) => (
                <PasswordInput id={id} meter value={password} onChange={(e) => setPassword(e.target.value)} />
              )}
            </Field>
            <Field label="Instruction" hint="Say what you need in plain words.">
              {({ id }) => (
                <Textarea
                  id={id}
                  defaultValue="Find Australian software companies with 50 to 200 people, and keep their websites."
                />
              )}
            </Field>
          </div>
        </Section>

        <Section title="Choices">
          <div style={grid}>
            <Field label="Select">
              {({ id }) => (
                <Select
                  id={id}
                  value={size}
                  onChange={setSize}
                  options={[
                    { value: '11-50', label: '11-50 employees' },
                    { value: '51-200', label: '51-200 employees' },
                    { value: '201-500', label: '201-500 employees' },
                  ]}
                  foot={
                    <>
                      <span>8 more sizes</span>
                      <span className="mono">size</span>
                    </>
                  }
                />
              )}
            </Field>
            <Field label="SearchSelect">
              {({ id }) => (
                <SearchSelect
                  id={id}
                  value={industry}
                  onChange={setIndustry}
                  options={INDUSTRIES}
                  placeholder="Pick an industry"
                  searchPlaceholder="Search industries"
                />
              )}
            </Field>
            <Field label="MultiSelect">
              {({ id }) => (
                <MultiSelect
                  id={id}
                  label="Industry"
                  value={industries}
                  onChange={setIndustries}
                  options={INDUSTRIES}
                  placeholder="Add an industry"
                  searchPlaceholder="Search industries"
                  foot={(n) => (
                    <>
                      <span>{n} picked</span>
                      <span className="mono">industry</span>
                    </>
                  )}
                />
              )}
            </Field>
            <div className="field">
              <span className="label">Segmented</span>
              <Segmented
                label="View"
                value={seg}
                onChange={setSeg}
                options={[
                  { value: 'table', label: 'Table' },
                  { value: 'json', label: 'JSON' },
                  { value: 'request', label: 'Request' },
                ]}
              />
            </div>
            <div className="field">
              <span className="label">Switch</span>
              <Switch checked={on} onChange={setOn} text={on ? 'Email me when it fails' : 'No email'} />
              <Switch checked={off} onChange={setOff} label="Off" text="Off" />
              <Switch checked disabled onChange={() => {}} text="Disabled" />
            </div>
            <div className="field">
              <span className="label">Checkbox</span>
              <Checkbox checked={box} onChange={setBox}>
                Include the header row
              </Checkbox>
              <Checkbox checked={false} onChange={() => {}} disabled>
                Disabled
              </Checkbox>
            </div>
            <div className="field">
              <span className="label">Stepper</span>
              <Stepper label="Companies to collect" value={take} onChange={setTake} min={1} max={1000} step={5} />
              <p className="hint">{(take * 20).toLocaleString('en-AU')} credits</p>
            </div>
          </div>
        </Section>

        <Section title="Dates and times">
          <div style={grid}>
            <Field label="One date">
              {({ id }) => (
                <DatePicker
                  id={id}
                  value={date}
                  onChange={(v) => setDate(typeof v === 'string' ? v : null)}
                  presets={[
                    { label: 'Today', value: new Date().toISOString().slice(0, 10) },
                    { label: 'Start of year', value: `${new Date().getFullYear()}-01-01` },
                  ]}
                />
              )}
            </Field>
            <Field label="A range">
              {({ id }) => (
                <DatePicker id={id} range value={range} onChange={(v) => setRange((v as DateRange) ?? {})} />
              )}
            </Field>
            <Field label="Time">
              {({ id }) => <TimePicker id={id} value={time} onChange={setTime} end="Sydney" />}
            </Field>
          </div>
        </Section>

        <Section title="Overlays">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Button onClick={() => setDialog(true)}>Open a dialog</Button>
            <Dialog
              open={dialog}
              onOpenChange={setDialog}
              title="Run 25 companies?"
              description="This run spends credits. It stops at your limit of 1,000."
              actions={
                <>
                  <Button variant="ghost" onClick={() => setDialog(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setDialog(false);
                      toast.success('Run started', { description: '25 companies, 500 credits' });
                    }}
                  >
                    <Play className="i" aria-hidden="true" />
                    Run for 500 credits
                  </Button>
                </>
              }
            >
              <p className="muted">Searching is free. Each full record costs 20 credits.</p>
            </Dialog>
            <Menu
              label="More"
              trigger={
                <Button icon aria-label="More">
                  <MoreHorizontal className="i" aria-hidden="true" />
                </Button>
              }
              items={[
                {
                  label: 'Download CSV',
                  icon: <Download className="i i-sm" aria-hidden="true" />,
                  onSelect: () => toast('Downloading'),
                },
                {
                  label: 'Pause schedule',
                  icon: <Pause className="i i-sm" aria-hidden="true" />,
                  onSelect: () => toast('Paused'),
                },
                'separator',
                {
                  label: 'Archive project',
                  icon: <Trash2 className="i i-sm" aria-hidden="true" />,
                  danger: true,
                  onSelect: () => toast.error('Archived'),
                },
              ]}
            />
            <Tooltip content="Searching is free. Each record costs 20 credits.">
              <Button>Hover for a tooltip</Button>
            </Tooltip>
            <Button onClick={() => toast('Saved', { description: 'Preset “AU SaaS 50 to 200” is ready.' })}>
              Show a toast
            </Button>
            <Button
              onClick={() =>
                toast.error('CoreSignal said slow down', { description: 'We waited and retried 3 times.' })
              }
            >
              Error toast
            </Button>
          </div>
        </Section>

        <Section title="Cards, panels, KPIs and copy">
          <div className="kpis">
            <Kpi
              label="Requests this week"
              value="1,912"
              sub={
                <>
                  <Led state="connected" />3 retried after a rate limit
                </>
              }
            />
            <Kpi label="Rows stored" value="6,818" sub="Across 6 datasets" />
            <Kpi
              label="Next pull"
              value="13:00"
              sub={
                <>
                  <Led state="live" />
                  AI launch posts
                </>
              }
            />
            <Kpi
              label="Your AI"
              value="Claude"
              sub={
                <>
                  <Led state="ai" />
                  Connected through MCP
                </>
              }
            />
          </div>
          <div style={{ ...grid, marginTop: 16 }}>
            <Panel title="Panel" actions={<Button size="sm">Action</Button>}>
              <p className="muted">A panel holds one job: a form, a list, a summary.</p>
              <CopyField value="http://localhost:3300/mcp/u/abc123" />
            </Panel>
            <Card style={{ padding: 18 }}>
              <p>A plain card.</p>
            </Card>
            <Panel title="Loading">
              <Skeleton width="60%" height={18} />
              <Skeleton width="90%" />
              <Skeleton width="75%" />
            </Panel>
            <Panel>
              <EmptyState
                icon={<FolderPlus className="i" aria-hidden="true" />}
                title="No projects yet"
                action={<Button variant="primary">New project</Button>}
              >
                Point your AI at an API’s docs and it builds the controls.
              </EmptyState>
            </Panel>
          </div>
        </Section>

        <Section title="Folder tabs and the data table (2,000 rows, virtual)">
          <div className="stage" style={{ minHeight: 0 }}>
            <FolderTabs
              idBase="demo"
              label="Results"
              value={tab}
              onChange={setTab}
              meta="2,000 rows"
              tabs={[
                { value: 'table', label: 'Table', count: '2,000' },
                { value: 'json', label: 'JSON' },
                { value: 'request', label: 'Request' },
              ]}
            />
            <TabPanel idBase="demo" value="table" active={tab === 'table'}>
              <DataTable label="Companies" columns={COLUMNS} rows={ROWS} height={360} cascade getRowId={(r) => r.id} />
            </TabPanel>
            <TabPanel idBase="demo" value="json" active={tab === 'json'}>
              <pre className="code">{JSON.stringify(ROWS.slice(0, 3), null, 2)}</pre>
            </TabPanel>
            <TabPanel idBase="demo" value="request" active={tab === 'request'}>
              <div className="req">
                <div className="req-line">
                  <span className="method">POST</span>
                  <code>https://api.coresignal.com/cdapi/v2/company_multi_source/search/es_dsl</code>
                </div>
              </div>
            </TabPanel>
          </div>
          <div style={{ marginTop: 16 }}>
            <DataTable
              label="Empty"
              columns={COLUMNS}
              rows={[]}
              height={140}
              empty="No rows yet. Run the project to fill this table."
            />
          </div>
        </Section>
      </PageFrame>
    </AppShell>
  );
}
