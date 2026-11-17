import { z } from 'zod';
import type { SetupEvent } from './events';
import type { ProjectStatus, SetupVia } from './projects';
import {
  AuthSchema,
  ChannelSchema,
  ControlSchema,
  EndpointSchema,
  NoteSchema,
  RunPlanSchema,
  type ControlKind,
} from './spec';

/**
 * The AI setup: the spec operations both the built-in assistant and MCP use, what starting a setup takes, and
 * what the Setup screen shows.
 */

export const SETUP_STATUSES = ['waiting', 'running', 'done', 'failed', 'cancelled'] as const;
export type SetupStatus = (typeof SETUP_STATUSES)[number];

/** Board 07's name for each kind, shown on the build card ("Search and pick"). */
export const KIND_LABELS: Record<ControlKind, string> = {
  text: 'Text field',
  keywords: 'Keywords',
  choice: 'Dropdown',
  multi: 'Search and pick',
  toggle: 'Switch',
  range: 'Range fader',
  logRange: 'Log fader',
  dial: 'Dial',
  date: 'Date picker',
  amount: 'Amount with cost',
  places: 'Place list',
  mapRadius: 'Map and radius',
};

// ---------- Spec operations ----------

const id = z.string().min(1).max(48);

/** set_api: the API's name, base URL, docs and auth. */
export const SetApiInput = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(48),
  baseUrl: z.string().min(1).max(300),
  docsUrl: z.string().min(1).max(500),
  auth: AuthSchema,
  credits: z
    .object({
      from: z.enum(['header', 'endpoint']),
      name: z.string().min(1).max(120),
      endpointId: z.string().optional(),
      path: z.string().optional(),
    })
    .optional(),
});

const ChannelOnlySchema = ChannelSchema.omit({ controls: true });

export const SpecOpSchema = z.discriminatedUnion(
  'op',
  [
    z.object({ op: z.literal('set_api'), api: SetApiInput }),
    z.object({ op: z.literal('add_endpoint'), endpoint: EndpointSchema }),
    z.object({ op: z.literal('update_endpoint'), id, changes: EndpointSchema.omit({ id: true }).partial() }),
    z.object({
      op: z.literal('add_channel'),
      channel: ChannelOnlySchema,
      /** The control labels planned for it, shown waiting until they're built. */
      planned: z.array(z.string().min(1).max(60)).max(12).optional(),
    }),
    z.object({ op: z.literal('add_control'), channelId: id, control: ControlSchema }),
    z.object({ op: z.literal('update_control'), id, changes: ControlSchema.omit({ id: true }).partial() }),
    z.object({ op: z.literal('remove_control'), id }),
    z.object({ op: z.literal('add_note'), note: NoteSchema }),
    z.object({ op: z.literal('set_run'), run: RunPlanSchema }),
    z.object({ op: z.literal('finish'), summary: z.string().max(400).optional() }),
  ],
  {
    error:
      'op must be one of: set_api, add_endpoint, update_endpoint, add_channel, add_control, update_control, remove_control, add_note, set_run, finish.',
  },
);
export type SpecOp = z.infer<typeof SpecOpSchema>;
export type SpecOpName = SpecOp['op'];

/** What an operation answers: what it did, and what the spec still needs before it passes. */
export type SpecOpResult = {
  ok: boolean;
  op: SpecOpName;
  message: string;
  /** The contract's problems still open (the spec isn't complete yet). */
  todo: { path: string; message: string }[];
  /** True when the whole spec now passes the contract. */
  valid: boolean;
};

// ---------- Starting a setup (New project) ----------

export const SetupStartSchema = z.object({
  name: z.string().trim().min(1, 'Give the project a name.').max(80),
  apiName: z.string().trim().min(1).max(80),
  apiSlug: z
    .string()
    .trim()
    .max(48)
    .regex(/^[a-z0-9-]*$/),
  monogram: z.string().trim().max(3).optional(),
  docsUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https?:\/\//.test(v) && URL.canParse(v), 'Enter the full docs address, starting https://.'),
  docsEndpoints: z.number().int().min(0).max(100_000).nullable().optional(),
  brief: z.string().trim().min(10, 'Tell the AI what you want, in a sentence or two.').max(4000),
  via: z.enum(['builtin', 'mcp']),
  /** A key to save to the vault for this API's host, or one already saved. */
  apiKey: z
    .object({
      host: z.string().trim().min(1).max(200),
      secret: z.string().trim().min(4).max(4000),
      label: z.string().max(60).optional(),
    })
    .optional(),
  apiKeyId: z.string().optional(),
});
export type SetupStartInput = z.input<typeof SetupStartSchema>;

export const SetupChangeSchema = z.object({
  brief: z.string().trim().min(5, 'Say what to change.').max(4000),
  via: z.enum(['builtin', 'mcp']).optional(),
});

// ---------- The Setup screen ----------

export type SetupBuildChannel = {
  id: string;
  title: string;
  controls: { id: string; label: string; kind: ControlKind; kindLabel: string }[];
  /** Planned labels not built yet. */
  waiting: string[];
};

/** Everything the Setup screen draws; sent again over SSE whenever it changes. */
export type SetupView = {
  setup: {
    id: string;
    projectId: string;
    via: SetupVia;
    status: SetupStatus;
    /** Who's doing it: "Claude", "Claude Desktop", "GPT". */
    who: string;
    model: string | null;
    brief: string;
    step: number;
    pagesRead: number;
    controlsBuilt: number;
    toolCalls: number;
    error: string | null;
    startedAt: number | null;
    finishedAt: number | null;
    createdAt: number;
    /** A change to a set-up project (?change=1). */
    change: boolean;
  };
  project: { id: string; name: string; apiName: string; monogram: string; docsUrl: string; status: ProjectStatus };
  docsHost: string | null;
  docsEndpoints: number | null;
  /** The endpoints picked so far. */
  endpoints: { id: string; label: string; method: string; path: string; free: boolean }[];
  /** The endpoint the build card is about (the run's, else the first). */
  mainEndpoint: string | null;
  channels: SetupBuildChannel[];
  planned: number;
  notes: { kind: 'limit' | 'cost' | 'tip'; text: string }[];
  test: { ok: boolean; records: number; ms: number; error: string | null; endpointId: string } | null;
  /** For MCP setups: what to ask the AI. */
  askAi: string;
  lastEventId: number;
};

export type SetupStream = { kind: 'view'; view: SetupView } | { kind: 'event'; event: SetupEvent };
