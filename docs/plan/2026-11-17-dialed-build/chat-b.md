# Chat B: Runs, data and schedules

Model and effort: Opus 5.5, Extra high. Start after: chat F. You run side by side with chat A in this folder.

## Scope

This chat builds everything that turns a spec into data:
- building and sending requests;
- the twelve controls;
- the workspace, with its Run module and results stage;
- saved datasets, with exports and the live CSV link;
- schedules with alerts;
- the Projects home.

Screens: 03 Projects, 06 Workspace (`Main.dc.html`), the controls from board 07 inside the workspace, 08 Saved data and 09 Schedules.

## Owned files

- **Server:**
  - `client/src/server/runner/`, `datasets/`, `schedules/`, `places/`
  - `client/src/server/services/runs.ts`, `presets.ts`, `datasets.ts`, `schedules.ts`, `project-stats.ts`
- **Pages:**
  - `client/src/app/(app)/projects/page.tsx` and `client/src/app/(app)/projects/[id]/page.tsx`
  - `client/src/app/(app)/data/`, `client/src/app/(app)/schedules/`
  - `client/src/app/csv/`
- **API routes:** `client/src/app/api/runs/`, `preview/`, `presets/`, `datasets/`, `exports/`, `schedules/`, `places/`.
- **Components:** `client/src/components/controls/`, `workspace/`, `projects/`, `data/`, `schedules/`.
- **Styles:** `client/src/styles/controls.css`, `workspace.css`, `results.css`, `projects.css`, `data.css`, `schedules.css`.
- **Seed:** `client/scripts/seed-data.ts`.
- **Migrations:** `0002_b_<what>.ts`, only if you must change the schema.

## Don't touch

- Chat F's files, apart from the shared files in common.md.
- Chat A's files:
  - `client/src/server/ai/`, `discovery/`, `setup/`, `oauth/`, `mcp/`
  - A's services and API routes
  - `app/(onboarding)/`, `app/(app)/projects/new/`, `app/(app)/projects/[id]/setup/`, `app/(app)/settings/`
  - `app/oauth/`, `app/.well-known/`, `app/mcp/`
  - `components/onboarding/`, `new-project/`, `setup/`, `settings/`
  - A's CSS files
- `design/`.

## Contracts

- **Uses:**
  - everything chat F provides;
  - chat A's `mcpStatus` and `aiSummary`, and the routes `/projects/new` and `/projects/[id]/setup?change=1`;
  - `users.alert_email`, `alerts_muted` and `timezone`, which chat A's Settings writes.
- **Provides:** the runner functions, the services, `ControlView` and `ChannelStrip` (common.md › Services between chats). Land tasks 1 to 3 first, because chat A needs them late in its order.

## Tasks

1. **Request builder** (`client/src/server/runner/request.ts`).
   - **Values into the request:** each value goes into the query, the body (dot keys into JSON), the path or the headers, following each control's `in`, `key` and `format`.
     - Range kinds go to their min and max keys.
     - `mapRadius` goes to lat, lng and radius.
     - Defaults apply, and required fields are checked with plain messages.
   - **`withKey`** adds the key the way the spec's `auth` says, but only when the request's host is the vault key's host (chat F's `secretFor`) and only over https.
   - **Pagination:** page, offset, cursor and link header, up to `maxPages`.
   - **Readers** for `records`, `total` (from the body or a header) and `idPath`, all as dot paths.
   - **A masked copy of each request** for the Request tab and `runs.requests` (`apikey: ••••7Qk`).
   - **Tests** on the three seed specs, every kind and every pagination type.
2. **Running** (`client/src/server/runner/`).
   - **`testCall`:** free endpoints only, one page.
   - **`previewRun`:** the live match count (a free search when the run plan has one, otherwise none), the take and the credits.
   - **`runProject`:**
     - Either a single endpoint, or search then collect: the search gives the ids and the match count, then the first `take` are collected, and the cost is take × `perRecord`.
     - A manual run that costs more than the project's `credit_limit` asks first, in a dialog.
     - A scheduled run that would pass its schedule's limit spends nothing. It ends as `stopped`, with what it would have cost, and sends an email.
   - **Retries:** a 429 honours Retry-After, up to 3 times. A 5xx or a timeout gets one retry.
   - **Friendly errors** in `error_text`:
     - a refused key: "Your CoreSignal key was refused. Replace it in Settings."
     - a rate limit: "Rate limited, retried after 4 s"
     - a timeout: "The API took too long."
     - bad input, naming the field.
   - **Caps per person:** 60 outbound calls a minute and 5,000 a day, counted from `runs`.
   - **Credits left:** update `api_keys.credits_left` when the spec's `api.credits` says where the API reports it.
   - **Rows:**
     - flatten records into dot columns, up to depth 3;
     - detect column types;
     - keep a capped sample (256 KB) in `runs.sample`.
   - **Calls** go only through chat F's `guardedFetch`.
   - **Routes:** `/api/runs` and `/api/preview`.
3. **The twelve controls** (`client/src/components/controls/`, from board 07 and `controls.css`).
   - **The kinds:**
     - text, keywords, choice, multi, toggle;
     - range and logRange faders: dual handles over printed tick scales, a log scale for counts, mono readouts, arrow keys and Page Up and Page Down, a halo on hover, and a scale on press;
     - dial;
     - date: one date or a range, through react-day-picker;
     - amount: a stepper with the live cost;
     - places: searches `/api/places` over GeoNames cities and countries (CC BY 4.0, credited);
     - mapRadius: MapLibre with OpenFreeMap tiles in a light Dialed style, a draggable pin and a radius handle, with the OpenStreetMap credit shown.
   - **States:** the four states from board 07, violet for values the AI set and teal for ones the person changed.
   - **Components:** `ControlView` draws any control from the contract, and `ChannelStrip` draws a channel with its CH number. Both take `readOnly`, for chat A's Setup page.
   - **Tests:** value round trips for every kind.
4. **Screen 06 Workspace** (`/projects/[id]`, from `Main.dc.html` and `MainPhone.dc.html`).
   - **The side panel:**
     - endpoints;
     - presets: save, apply, rename and delete, through `/api/presets`;
     - the AI card: who set the project up, from `setups`, and Ask for changes, which opens `/projects/[id]/setup?change=1`.
   - **The channel rack:** every channel and control from the spec. Controls that need a missing key say so and link to Settings.
   - **The dark Run module:**
     - matches, shown with Number Flow and updated live from `previewRun`, debounced 600 ms, for free searches only;
     - the take line, and the cost line (`costShort` on phone);
     - Run, with its running state.
   - **The results stage:**
     - folder tabs: Table (TanStack with virtual rows, rows cascading in after a run), JSON, and Request (masked);
     - the status line;
     - Save to dataset: pick a dataset or make one, and choose the save mode.
   - **Phone:** the Controls and Results switch, with the Run bar pinned.
5. **Screen 03 Projects** (`/projects`, from `Projects.dc.html` and `ProjectsPhone.dc.html`).
   - **The KPI strip:**
     - requests this week, and how many were retried;
     - rows stored across datasets;
     - the next pull and its project;
     - Your AI, from chat A's `mcpStatus` or `aiSummary`.
   - **Filters:** All, On a schedule, Manual, with counts.
   - **Project cards,** each a whole-card link:
     - the monogram and the API line;
     - a mini strip of the current control values;
     - the schedule line with its LED;
     - the row count;
     - a failed state.
   - **The New project card.**
   - **Recent runs,** with friendly errors.
   - **An empty state** for a new account that leads to `/projects/new`.
6. **Saved data** (`client/src/server/datasets/` and `/data`, from `Data.dc.html` and `DataPhone.dc.html`).
   - **Save modes:**
     - add new rows, skipping repeats on `key_path` and counting them;
     - replace all;
     - keep each run.

     Rows, bytes and runs are counted on `datasets`.
   - **The screen:**
     - the datasets table: search, the All projects and Any time filters, and the columns Rows, Updated, Comes from, Size and Download;
     - the preview, newest rows first;
     - the detail panel: rows, runs saved, repeats skipped, new rows per run as bars, When a run finishes, the "Skips companies already saved, matched on company id" line from `key_label`, and Open project.
   - **Exports:** CSV, Excel (ExcelJS) and JSON, streamed in pages so a big dataset never loads at once (`/api/exports`).
   - **The live CSV link:**
     - `/csv/[token]`, with a 32-byte random token;
     - plain `text/csv` that Google Sheets' IMPORTDATA reads;
     - rate-limited;
     - New link and Turn off.
7. **Schedules** (`client/src/server/schedules/` and `/schedules`, from `Schedules.dc.html` and `SchedulesPhone.dc.html`).
   - **The service:**
     - hourly, daily, weekly (on chosen days) or monthly (on a day of the month), at a time in a time zone;
     - the next three runs, from croner, right across DST changes;
     - the credit limit per run, also shown as records;
     - "Email me if a run fails" and "Email me a CSV after each run";
     - on and paused.
   - **The job `schedules-due`,** registered with chat F's scheduler:
     - claims due rows (common.md › Database › Claims);
     - runs `runProject` with the trigger `schedule`;
     - saves the rows to the dataset and sets the next run;
     - emails through chat F's mailer to `alert_email`, unless muted: failures, stopped runs and the CSV.
   - **The screen:**
     - the list, with LEDs (on, paused, failed) and the next and last lines;
     - the editor, with When and Each run exactly as drawn;
     - Run now, Save changes, and pause and resume;
     - Recent runs.

     Add `/api/schedules`.
8. **Seed data** (`client/scripts/seed-data.ts`, run after chat F's seed): presets, runs, datasets with rows, and schedules for `nadia@dialed.test`, matching the numbers on the canvas (6 datasets and 6,818 rows; AU software with 234 rows over 8 runs and 96 repeats skipped). That way every screen has real-looking data locally.
9. **README:** fill in the "Runs, data and schedules" section of the root README (a shared file).
10. **Test once** (below), then write your Report.

## Done when

- On both SQLite and Postgres:
  - the seed projects run and show rows in all three tabs;
  - they save to datasets in each save mode;
  - they export in all three formats and serve a live CSV link;
  - a due schedule runs once (not twice) and sends the emails it's set to.
- A key is never sent to another host, and nothing spends credits past a limit.
- Screens 03, 06, 08 and 09 and the twelve controls match their artboards at 390 and 1440 and pass design-qa.
- Your tests pass on both databases.

## Module test steps

1. **Start up.** Dev server on 3320 with `.data/b.db`. Migrate, run chat F's seed, then your seed data.
2. **Workspace,** on Hacker News and Open-Meteo:
   - change every control, and watch the request change in the Request tab;
   - Run, then check Table, JSON and Request;
   - save to a dataset in each mode, run again, and check the repeats.
3. **CoreSignal:** only if `E2E_CORESIGNAL_KEY` is set, and free searches only (the live match count). No collect without the user's OK in the picker.
4. **Exports:**
   - CSV, checked as text;
   - Excel, read back with ExcelJS;
   - JSON, which parses;
   - curl the live CSV link, turn it off, and get a 404.
5. **Schedules:**
   - Set a schedule's `next_run_at` in the past, wait for the tick, and check there's exactly one run.
   - A run over its limit stops and writes a mail to `.dev-mail/`.
   - A bad key fails and writes a mail.
6. **Security:**
   - A spec whose host differs from the key's host sends no key.
   - A private address is refused.
   - Another account's ids give a 404.
7. **Design QA:** `saimul:design-qa` on 03, 06, 08, 09 and the controls at 390 and 1440, against the artboards.
8. **Tests:** `npx vitest run` on your files, then again with `TEST_DB=postgres`.

## Report

- Done:
- Files:
- Tests:
- Open issues:
- Requests:
