# Rules for every chat

Read this file first, then your own chat file. [README.md](README.md) has the goal and the decisions. If this file and your chat file disagree, follow this file and note it under Requests in your Report.

## How to work

- **Skills:** load `saimul:dev-workflow` before you start. For UI, also load `saimul:house-style`, and run `saimul:design-qa` before you call a screen done.
- **Working alone:**
  - Work directly. Don't start agents.
  - If your chat file misses something the work needs, handle it sensibly and note it in your Report.
  - Ask questions only with the AskUserQuestion picker.
- **Files:** don't edit files your chat file doesn't give you, apart from the shared files below. If you need a change in one, add it under Requests in your Report and carry on with a local workaround.
- **Git:**
  - Never commit, push or deploy, and never switch branches. The user commits.
  - No Claude attribution anywhere.
  - Start with `git status`. Changes you didn't make belong to someone else: leave them.
- **Next.js 16** has breaking changes. Read `client/node_modules/next/dist/docs/` before you use an API you're unsure of.
- **Patterns**, taken from the CMS:
  - Zod contracts go in `client/src/contracts/`.
  - Services go in `client/src/server/services/` and take a `Ctx` (the signed-in person).
  - Route handlers go through `client/src/server/http/handle.ts`.
  - Every query goes through Kysely (`client/src/server/db`), never a raw driver call.
  - Tests sit next to the code as `*.test.ts` (Vitest).
- **Copying from the CMS** (`~/Downloads/dl-cms/cms`):
  - Copy the file and its tests.
  - Cut what Dialed doesn't use: sites, organizations, roles, plugins, media and the mock API mode.
  - Rewrite its SQL through Kysely.
  - Name the source on the first line, for example `// Adapted from dl-cms/cms/src/server/auth/sessions.ts`.
- **Dependencies:** chat F installs every planned one (chat-f.md › Dependencies). If you still need another, it must be free, with a licence that allows use (MIT, ISC, BSD, Apache-2.0 or MPL-2.0), and must not overlap what's installed. Install it and list it in your Report.
- **Secrets:** never print, log or return an API key, AI key, password or token. Print env key names only.
- **Screens:**
  - Port each screen from its artboard in `design/canvas/project/` with the same markup, class names, copy and states.
  - The design's dummy data (`docs/design-direction.md` › Dummy data) becomes real data.
  - Use sentence case and tabular numbers, and no em or en dashes in copy.
  - Never use a native select, date picker or time picker.
- **Browser checks:** use BrowserOS neo, page text first, and screenshots only where the look matters. Close your tabs when you're done.

## Ports, databases and builds

| Chat | App port | Build folder | SQLite file | Postgres port |
| --- | --- | --- | --- | --- |
| F | 3300 | `.next-f` | `.data/f.db` | 5530 |
| A | 3310 | `.next-a` | `.data/a.db` | 5531 |
| B | 3320 | `.next-b` | `.data/b.db` | 5532 |
| Review and E2E | 3330 | `.next-r` | `.data/r.db` | 5533 |

- **Dev server:** run it from `client/` as a tracked background task, for example `NEXT_DIST_DIR=.next-a PORT=3310 DATABASE_URL=file:./.data/a.db npm run dev`. Stop it by its task id; never `pkill`.
- **Postgres:** `LOCAL_DB_PORT=5531 LOCAL_DB_DIR=.pglite-a npm run db:pg` starts a throwaway Postgres (PGlite). Then set `DATABASE_URL=postgresql://postgres@127.0.0.1:5531/postgres`.
- **Migrate and seed:** `npm run db:migrate` and `npm run db:seed` work on whichever `DATABASE_URL` is set. The seed refuses anything but a local file or 127.0.0.1.
- **The live database:** never use `LIVE_DATABASE_URL`. Only go-live does.
- **Builds and formatting:**
  - Wave 1 never runs `next build` or `npm run format`. The review chat builds once.
  - Format only your own files, with `npx prettier --write <files>`.

## Two build chats, one folder

Chats A and B work in `client/` at the same time.

- **The other chat's work:**
  - Its files may be half-done. Ignore lint, type and test errors in files it owns, and never fix them.
  - If you need a piece of its work that isn't there yet, do your other tasks first and check back. Both chat files put those tasks late.
- **Shared files** both chats add to:
  - `client/src/server/services/index.ts`
  - `client/src/contracts/index.ts`
  - `client/src/server/jobs/registry.ts`
  - `client/src/server/db/migrations/index.ts`
  - `client/.env.example`
  - the root `README.md`
  - `client/package.json`, changed only through `npm install`

  Edit them only with the Edit tool, and re-read each one right before you edit it. Add your lines next to similar ones, and never reorder, reformat or rewrite them.
- **Screen CSS:** chat F ports every section of the canvas CSS into its own file and imports them all, so no chat edits `globals.css`. Each chat owns its screens' CSS files (named in its chat file).
- **Schema:** chat F's migration holds every planned table.
  - If you must change the schema, add your own migration named `0002_a_<what>.ts` or `0002_b_<what>.ts`.
  - Never edit `0001_init.ts`.
- **Tests:** while you work, run only your own tests (`npx vitest run <your files>`). At the end, run them once with `TEST_DB=postgres` as well.

## Database (binding)

- **What `client/src/server/db/index.ts` exports:**
  - `db` (a `Kysely<Database>`) and `dialect` (`"sqlite"` or `"postgres"`)
  - `newId()`, `now()`, `json()`, `parseJson(schema, text)`, `bool()` and `transaction()`

  `schema.ts` holds the `Database` interface.
- **Which database runs:**
  - `DATABASE_URL` unset or starting `file:` gives SQLite (default `./.data/dialed.db`) through better-sqlite3, with WAL, `busy_timeout = 5000` and foreign keys on.
  - A `postgres://` or `postgresql://` URL gives Postgres through a `pg` Pool (`DATABASE_POOL_MAX`, default 10), with int8 read as a number.
- **Portable columns only:**
  - ids are text made in the app (`newId()`);
  - times are `bigint` milliseconds, named `*_at`;
  - booleans are `boolean` columns read through `bool()`, since SQLite returns 0 or 1;
  - JSON is text in both databases, written with `json()` and read with `parseJson()`;
  - no arrays, enums, `ILIKE`, `FOR UPDATE`, `now()` in SQL, or database-generated ids, apart from the two auto ids below;
  - text values are checked in code, and emails are stored lowercase;
  - case-insensitive search is `lower(col) like lower(?)`.
- **Claims** (jobs and schedules): one `update ... set locked_until = ? where id = ? and (locked_until is null or locked_until < ?)`, then check that exactly one row changed. It works on both databases, and nothing runs twice.
- **Migrations:**
  - TypeScript files in `client/src/server/db/migrations/`, written with Kysely's schema builder.
  - Raw SQL only inside an `if (dialect === ...)` branch.
  - They run on app start and with `npm run db:migrate`.
- **Tests:** `client/src/server/db/testing.ts` gives each test file a fresh, migrated database.
  - SQLite in a temp file by default.
  - Postgres when `TEST_DB=postgres`: PGlite over a socket, connected through `pg`, so the tests use the production driver.
  - `npm test` runs SQLite, and `npm run test:pg` runs Postgres.

## Tables (binding)

Chat F's `0001_init.ts` creates all of them. Every table has `created_at`, and the ones that change have `updated_at`. Every read and write is scoped to the signed-in person through `user_id`, or through the project for project-owned rows.

| Table | Columns that matter | Writes | Reads |
| --- | --- | --- | --- |
| `users` | id, email (unique), name, password_hash, email_checked_at, workspace, timezone, mcp_handle (unique), alert_email, alerts_muted | F, A (Settings) | all |
| `sessions` | id (token hash), user_id, expires_at, last_seen_at, user_agent, ip | F | F |
| `email_tokens` | id, user_id, purpose (`check`, `reset`, `email-change`), token_hash, new_email, expires_at, used_at | F | F |
| `api_keys` | id, user_id, api_slug, api_name, host, label, secret (sealed), last4, credits_left, credits_checked_at, last_test_at, last_test_ok | F service, A screens, B runs | A, B |
| `projects` | id, user_id, name, api_name, api_slug, monogram, docs_url, api_key_id, brief, setup_via (`builtin`, `mcp`), status (`draft`, `waiting`, `setting_up`, `ready`, `failed`), spec (JSON), spec_version, credit_limit (default 1000), last_run_at, archived_at | F service, A (spec and status), B (last_run_at) | all |
| `spec_versions` | id, project_id, version, spec, author (`ai`, `user`), note | A, B | A |
| `presets` | id, project_id, name, values (JSON) | B | A (MCP), B |
| `setups` | id, project_id, via, status (`waiting`, `running`, `done`, `failed`, `cancelled`), ai_key_id, model, brief, step (1 to 4), pages_read, controls_built, error, started_at, finished_at | A | A, B |
| `setup_events` | id (auto), setup_id, at, kind (`step`, `log`, `endpoint`, `control`, `note`, `test`, `done`, `error`), data (JSON) | A | A |
| `ai_keys` | id, user_id, provider (`anthropic`, `openai`, `gemini`, `openrouter`), model, label, secret (sealed), last4, position, last_test_at, last_test_ok, last_test_ms | A | A |
| `ai_usage` | id, user_id, ai_key_id, provider, model, purpose (`setup`, `test`), tokens_in, tokens_out, ok, error, at | A | A |
| `runs` | id, project_id, user_id, trigger (`manual`, `schedule`, `mcp`, `test`), preset_id, schedule_id, values (JSON), status (`running`, `ok`, `partial`, `failed`, `stopped`), matches, rows, credits, http_status, error_code, error_text, retries, requests (JSON, keys masked), sample (JSON, capped), dataset_id, new_rows, started_at, finished_at | B | A (MCP, Usage), B |
| `datasets` | id, user_id, project_id, name, save_mode (`append`, `replace`, `keep`), key_path, key_label, columns (JSON), rows, bytes, runs, repeats_skipped, csv_token, csv_token_at | B | A (MCP), B |
| `dataset_rows` | id (auto), dataset_id, run_id, row_key, data (JSON); unique (dataset_id, row_key) where row_key is set | B | B |
| `schedules` | id, user_id, project_id, preset_id, values (JSON), dataset_id, name, cadence (`hourly`, `daily`, `weekly`, `monthly`), days (JSON), day_of_month, time, timezone, credit_limit, email_on_fail, email_csv, status (`on`, `paused`), paused_at, next_run_at, locked_until, last_run_id | B | A (MCP), B |
| `jobs` | name, next_run_at, locked_until, last_run_at, last_error | F | F |
| `oauth_clients`, `oauth_codes`, `oauth_tokens` | the columns of the CMS's `mcp_oauth_clients`, `mcp_oauth_codes` and `mcp_tokens`, with `resource` set to the person's MCP address, plus `client_name` and `last_used_at` for Settings | A | A, B (Your AI) |

## The spec (binding)

`client/src/contracts/spec.ts` (chat F) holds the Zod schemas and types. Chat A's AI writes specs, and chat B builds requests and draws controls from them. Chat F's three seed specs are the worked examples.

```ts
type ApiSpec = {
  version: 1;
  api: {
    name: string; slug: string; baseUrl: string; docsUrl: string; auth: Auth;
    credits?: { from: "header" | "endpoint"; name: string; endpointId?: string; path?: string }; // credits left, when the API reports them
  };
  endpoints: Endpoint[];   // 1 to 20
  channels: Channel[];     // 1 to 8, in order; "CH 01" comes from the order
  notes: Note[];           // what the API can't do, what costs credits, tips
  run: RunPlan;            // what the Run button does
};
type Auth =
  | { type: "none" }
  | { type: "header"; name: string; prefix?: string }    // CoreSignal: { type: "header", name: "apikey" }
  | { type: "query"; name: string }
  | { type: "bearer" }
  | { type: "basic" };
type Endpoint = {
  id: string; label: string; description: string;
  method: "GET" | "POST"; path: string;                  // "{name}" marks a path parameter
  body?: "json" | "form";
  fixed?: { query?: Record<string, unknown>; body?: Record<string, unknown>; headers?: Record<string, string> };
  records: string;                                       // dot path to the records: "$", "$.hits"
  total?: { from: "body" | "header"; path: string };     // the match count
  idPath?: string;                                       // a record's id, used to skip repeats
  pagination?: {
    type: "none" | "page" | "offset" | "cursor" | "link";
    param?: string; sizeParam?: string; size?: number; cursorPath?: string; maxPages: number;
  };
  cost: { perCall: number; perRecord: number; unit: string };  // 0 and 0 when free
  free: boolean;                                         // safe for test calls and live counts
};
type Channel = { id: string; title: string; hint?: string; controls: Control[] };
type Control = {
  id: string; label: string; help?: string;
  param: string;                                         // the raw parameter name, shown under the label
  endpointId: string; in: "query" | "body" | "path" | "header";
  key: string | { min: string; max: string } | { lat: string; lng: string; radius: string };
  kind: ControlKind;
  options?: { value: string; label: string }[];          // choice and multi
  min?: number; max?: number; step?: number; unit?: string;
  range?: boolean;                                       // date: one date or a range
  format?: "comma" | "array" | "iso-date" | "unix" | "year";
  default?: Value; required?: boolean;
  by: "ai" | "user";
};
type ControlKind =
  | "text" | "keywords" | "choice" | "multi" | "toggle" | "range"
  | "logRange" | "dial" | "date" | "amount" | "places" | "mapRadius";
type Note = { kind: "limit" | "cost" | "tip"; text: string };
type RunPlan =
  | { mode: "single"; endpointId: string; takeControlId?: string }
  | { mode: "searchThenCollect"; searchId: string; collectId: string; idParam: string; takeControlId: string };
type Value =
  | string | number | boolean | string[] | null
  | { min?: number | string; max?: number | string }
  | { lat: number; lng: number; radius: number };
type Values = Record<string, Value>;                     // by control id
```

**What the schema enforces:**
- ids are short slugs, unique within the spec;
- `baseUrl` starts with `https://`;
- every `endpointId`, `takeControlId` and run step points at something that exists;
- a `free` endpoint costs 0;
- there are at most 40 controls.

The error messages are plain, because an AI reads them and fixes the spec.

### Control kinds (board 07, `Controls.dc.html`)

| Kind | Use it for | Looks like |
| --- | --- | --- |
| `text` | One free value: a name, a domain | Text field |
| `keywords` | Several words or phrases | Chip input |
| `choice` | 2 to 8 options | Segmented pills, all visible |
| `multi` | A long list: industries, countries | Searchable multi-select |
| `toggle` | Yes or no | Switch |
| `range` | A min and max on a linear scale: founding year | Dual fader on a tick scale |
| `logRange` | Counts across orders of magnitude: employees, revenue | Dual fader on a log tick scale |
| `dial` | One number: days ahead, page size | Dial with a readout |
| `date` | A date or a date range | Date picker, never native |
| `amount` | How many records to take when each costs credits | Stepper with the live cost |
| `places` | Place names the API accepts: cities, countries | Searchable place list |
| `mapRadius` | A point and radius the API accepts | Map with a pin and a radius |

Violet marks what the AI made or set (`by: "ai"`, and defaults the person hasn't touched), and teal marks what the person changed. The board's four state cards (set by AI, changed by you, needs a key, invalid) apply to every kind.

## Services between chats (binding)

**Chat F provides, in wave 0:**
- `requireUser(request)` returns `Ctx = { user, now }`, and `requireCheckedEmail(ctx)` stops anyone whose email isn't checked.
- `seal(text)` and `unseal(sealed)`: AES-256-GCM keyed from `APP_SECRET`, taken from the CMS's `auth/tokens.ts`.
- `apiKeys`: `create`, `list` (masked), `get`, `replace`, `remove`, `markTested` and `secretFor(ctx, keyId, host)`, which throws unless `host` is the key's own host.
- `guardedFetch(url, init, { timeoutMs, maxBytes, maxRedirects })`: the outbound guard, checking every redirect again.
- `mail.send({ to, subject, text, html })`.
- `registerJob(def, run)` and the one-minute tick, started from `client/src/instrumentation.ts`.
- `projects`: `create`, `get`, `list`, `update` and `archive`, plus the `/api/projects` routes.
- The contracts: `spec.ts`, `values.ts` (`defaultValues(spec)`, `isChanged`), `runs.ts` (`RunResult`, `TestResult`, `RunRequestLog`) and `events.ts` (`SetupEvent`).

**Chat B provides; chat A uses them late in its order:**
- In `client/src/server/runner/`:
  - `buildRequest(spec, endpointId, values, page?)`
  - `testCall(ctx, projectId, endpointId, values)` returns a `TestResult` (free endpoints only)
  - `previewRun(ctx, projectId, values)` returns `{ matches, take, credits }`
  - `runProject(ctx, projectId, { values, presetId?, trigger, datasetId?, confirmCredits? })` returns a `RunResult`
- Services: `runs.get`, `runs.list`, `presets.list`, `datasets.list`, `datasets.rows`, `schedules.upsert`, `schedules.list` and `schedules.nextRuns`.
- `ControlView` and `ChannelStrip` from `client/src/components/controls/`, with a `readOnly` prop for the Setup page.

**Chat A provides; chat B uses them:**
- The pages `/projects/new` and `/projects/[id]/setup`. Adding `?change=1` asks the AI for changes.
- `mcpStatus(ctx)` returns `{ connected, clientName, lastUsedAt }`, and `aiSummary(ctx)` returns the first key's provider and model, for the Projects KPI "Your AI".

If a function you need from the other chat isn't there yet, build against its signature with a small local stub that says it's waiting, and remove the stub once the real one lands.

## Routes (binding)

| Route | Screen | Chat |
| --- | --- | --- |
| `/sign-up`, `/log-in`, `/check-email`, `/reset-password`, `/privacy`, `/terms` | 01 Sign up and the other account pages | F |
| `/welcome/ai` | 02 Connect your AI (step 2 of 3) | A |
| `/projects` | 03 Projects | B |
| `/projects/new` | 04 New project (also step 3 of 3) | A |
| `/projects/[id]/setup` | 05 AI sets up the API | A |
| `/projects/[id]` | 06 Workspace | B |
| `/data` | 08 Saved data | B |
| `/schedules` | 09 Schedules | B |
| `/settings/account`, `/settings/ai`, `/settings/alerts`, `/settings/usage` | 10 Settings | A |
| `/oauth/*`, `/.well-known/*`, `/mcp/u/[handle]` | OAuth and the MCP server | A |
| `/csv/[token]` | The live CSV link | B |
| `/api/auth`, `/api/projects`, `/api/health` | | F |
| `/api/ai`, `/api/api-keys`, `/api/discovery`, `/api/setup`, `/api/settings`, `/api/mcp-status` | | A |
| `/api/runs`, `/api/preview`, `/api/presets`, `/api/datasets`, `/api/exports`, `/api/schedules`, `/api/places` | | B |

`/` sends signed-in people to `/projects` and everyone else to `/log-in`.
