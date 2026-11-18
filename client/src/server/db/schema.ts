import type { ColumnType, Generated } from 'kysely';

/**
 * The tables, as 0001_init.ts creates them (common.md › Tables).
 *
 * - Times are ms numbers in `*_at` columns.
 * - JSON columns are text: write json(value), read parseJson(schema, text).
 * - Booleans come back as 0 or 1 on SQLite, so they read as `Bool`: pass them through bool().
 */
export type Bool = ColumnType<boolean | number, boolean, boolean>;
/** Text holding JSON. */
export type JsonText = string;
/** An auto id (integer on SQLite, bigserial on Postgres). */
export type AutoId = Generated<number>;

export interface UsersTable {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  email_checked_at: number | null;
  workspace: string;
  timezone: string;
  mcp_handle: string;
  alert_email: string | null;
  alerts_muted: Bool;
  created_at: number;
  updated_at: number;
}

export interface SessionsTable {
  /** SHA-256 of the cookie token. */
  id: string;
  user_id: string;
  expires_at: number;
  last_seen_at: number;
  user_agent: string | null;
  ip: string | null;
  created_at: number;
}

export type EmailTokenPurpose = 'check' | 'reset' | 'email-change';

export interface EmailTokensTable {
  id: string;
  user_id: string;
  purpose: EmailTokenPurpose;
  token_hash: string;
  new_email: string | null;
  expires_at: number;
  used_at: number | null;
  created_at: number;
}

export interface ApiKeysTable {
  id: string;
  user_id: string;
  api_slug: string;
  api_name: string;
  host: string;
  label: string;
  /** Sealed with seal(); never sent to the browser. */
  secret: string;
  last4: string;
  credits_left: number | null;
  credits_checked_at: number | null;
  last_test_at: number | null;
  last_test_ok: Bool | null;
  created_at: number;
  updated_at: number;
}

export type ProjectStatus = 'draft' | 'waiting' | 'setting_up' | 'ready' | 'failed';
export type SetupVia = 'builtin' | 'mcp';

export interface ProjectsTable {
  id: string;
  user_id: string;
  name: string;
  api_name: string;
  api_slug: string;
  monogram: string;
  docs_url: string;
  api_key_id: string | null;
  brief: string;
  setup_via: SetupVia;
  status: ProjectStatus;
  /** ApiSpec JSON, or null before the AI writes one. */
  spec: JsonText | null;
  spec_version: number;
  credit_limit: number;
  last_run_at: number | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface SpecVersionsTable {
  id: string;
  project_id: string;
  version: number;
  spec: JsonText;
  author: 'ai' | 'user';
  note: string | null;
  created_at: number;
}

export interface PresetsTable {
  id: string;
  project_id: string;
  name: string;
  values: JsonText;
  created_at: number;
  updated_at: number;
}

export type SetupStatus = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';

export interface SetupsTable {
  id: string;
  project_id: string;
  via: SetupVia;
  status: SetupStatus;
  ai_key_id: string | null;
  model: string | null;
  brief: string;
  step: number;
  pages_read: number;
  controls_built: number;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
  // Added by 0002_a_setup_draft.
  /** The ApiSpec being built (JSON), which may not pass the contract yet. */
  draft: string | null;
  /** Tool calls the built-in assistant made, for the 80-call limit. */
  tool_calls: Generated<number>;
  /** Endpoints the docs list, from discovery, for "Picked 4 of 31 endpoints". */
  docs_endpoints: number | null;
  /** JSON { [channelId]: string[] }: control labels the AI plans, shown waiting until built. */
  plan: string | null;
}

export type SetupEventKind = 'step' | 'log' | 'endpoint' | 'control' | 'note' | 'test' | 'done' | 'error';

export interface SetupEventsTable {
  id: AutoId;
  setup_id: string;
  at: number;
  kind: SetupEventKind;
  data: JsonText;
  created_at: number;
}

export type AiProvider = 'anthropic' | 'openai' | 'gemini' | 'openrouter';

export interface AiKeysTable {
  id: string;
  user_id: string;
  provider: AiProvider;
  model: string;
  label: string;
  secret: string;
  last4: string;
  position: number;
  last_test_at: number | null;
  last_test_ok: Bool | null;
  last_test_ms: number | null;
  created_at: number;
  updated_at: number;
}

export interface AiUsageTable {
  id: string;
  user_id: string;
  ai_key_id: string | null;
  provider: AiProvider;
  model: string;
  purpose: 'setup' | 'test';
  tokens_in: number;
  tokens_out: number;
  ok: Bool;
  error: string | null;
  at: number;
  created_at: number;
}

export type RunTrigger = 'manual' | 'schedule' | 'mcp' | 'test';
export type RunStatus = 'running' | 'ok' | 'partial' | 'failed' | 'stopped';

export interface RunsTable {
  id: string;
  project_id: string;
  user_id: string;
  trigger: RunTrigger;
  preset_id: string | null;
  schedule_id: string | null;
  values: JsonText;
  status: RunStatus;
  matches: number | null;
  rows: number;
  credits: number;
  http_status: number | null;
  error_code: string | null;
  error_text: string | null;
  retries: number;
  /** RunRequestLog[] JSON, keys masked. */
  requests: JsonText;
  /** A capped sample of rows, JSON. */
  sample: JsonText | null;
  dataset_id: string | null;
  new_rows: number;
  started_at: number;
  finished_at: number | null;
  created_at: number;
}

export type SaveMode = 'append' | 'replace' | 'keep';

export interface DatasetsTable {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  save_mode: SaveMode;
  key_path: string | null;
  key_label: string | null;
  columns: JsonText;
  rows: number;
  bytes: number;
  runs: number;
  repeats_skipped: number;
  csv_token: string | null;
  csv_token_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface DatasetRowsTable {
  id: AutoId;
  dataset_id: string;
  run_id: string | null;
  row_key: string | null;
  data: JsonText;
  created_at: number;
}

export type Cadence = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface SchedulesTable {
  id: string;
  user_id: string;
  project_id: string;
  preset_id: string | null;
  values: JsonText;
  dataset_id: string | null;
  name: string;
  cadence: Cadence;
  /** Weekdays as JSON, 0 (Sunday) to 6. */
  days: JsonText;
  day_of_month: number | null;
  /** "HH:MM" in the schedule's time zone. */
  time: string;
  timezone: string;
  credit_limit: number;
  email_on_fail: Bool;
  email_csv: Bool;
  status: 'on' | 'paused';
  paused_at: number | null;
  next_run_at: number | null;
  locked_until: number | null;
  last_run_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface JobsTable {
  name: string;
  next_run_at: number;
  locked_until: number | null;
  last_run_at: number | null;
  last_status: 'running' | 'ok' | 'failed' | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

/** OAuth clients from dynamic registration (the CMS's mcp_oauth_clients). */
export interface OauthClientsTable {
  client_id: string;
  /** Client metadata JSON from registration. */
  data: JsonText;
  client_name: string;
  created_at: number;
}

/** One-time authorization codes (the CMS's mcp_oauth_codes). */
export interface OauthCodesTable {
  code_hash: string;
  /** client_id, user_id, resource, PKCE challenge and redirect_uri as JSON. */
  data: JsonText;
  expires_at: number;
  created_at: number;
}

/** One row per grant, a "connection" in Settings (the CMS's mcp_tokens). Refresh rotates the hashes. */
export interface OauthTokensTable {
  id: string;
  access_hash: string;
  refresh_hash: string | null;
  client_id: string;
  client_name: string;
  user_id: string;
  /** The person's MCP address. */
  resource: string;
  scope: string;
  created_at: number;
  expires_at: number;
  refresh_expires_at: number | null;
  revoked_at: number | null;
  last_used_at: number | null;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  email_tokens: EmailTokensTable;
  api_keys: ApiKeysTable;
  projects: ProjectsTable;
  spec_versions: SpecVersionsTable;
  presets: PresetsTable;
  setups: SetupsTable;
  setup_events: SetupEventsTable;
  ai_keys: AiKeysTable;
  ai_usage: AiUsageTable;
  runs: RunsTable;
  datasets: DatasetsTable;
  dataset_rows: DatasetRowsTable;
  schedules: SchedulesTable;
  jobs: JobsTable;
  oauth_clients: OauthClientsTable;
  oauth_codes: OauthCodesTable;
  oauth_tokens: OauthTokensTable;
}
