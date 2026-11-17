# Chat F: Foundation

Model and effort: Opus 5.5, High. Start after: nothing (wave 0). You're alone in the folder: chats A and B start when you finish.

## Scope

This chat sets up the app and everything both wave 1 chats build on:
- the scaffold and tooling;
- the database layer for SQLite and Postgres, with every table;
- the contracts;
- the copied CMS core: auth, HTTP helpers, the outbound guard, secrets, mail and jobs;
- the design system ported from the canvas;
- the app shell;
- the account screens (01);
- the seed with three worked specs;
- the Dockerfile and the README.

## Owned files

- **Repo root:** `README.md`, `LICENSE`, `.ls-lint.yml`, `.editorconfig`, `.gitignore`, and removing the root `.env`.
- **`client/` config:** `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `.prettierrc`, `.gitignore`, `.env`, `.env.example`, `vitest.config.mts`, `Dockerfile`, `docker-compose.yml`, `public/`.
- **Scripts:** `client/scripts/db-migrate.ts`, `db-pg.mjs`, `db-seed.ts`.
- **App start:** `client/src/instrumentation.ts`.
- **Contracts:** `client/src/contracts/`.
- **Server:**
  - `client/src/server/db/`, `http/`, `net/`, `auth/`, `mail/`, `jobs/`, `seed/`
  - `client/src/server/secrets.ts`
  - `client/src/server/services/context.ts`, `auth.ts`, `users.ts`, `api-keys.ts`, `projects.ts`, `index.ts`
- **Styles:** `client/src/styles/`, all of it. The screen files pass to chats A and B when you finish.
- **Components:** `client/src/components/ui/`, `shell/`, `auth/`.
- **App:** in `client/src/app/`: `layout.tsx`, `globals.css`, `page.tsx`, `(auth)/`, `(app)/layout.tsx`, `privacy/`, `terms/`, `dev/ui/`, `api/auth/`, `api/projects/`, `api/health/`.

## Don't touch

- `design/`: the approved canvas, read only.
- `docs/`, apart from your Report below.

## Contracts

- **Uses:** nothing.
- **Provides:** everything in common.md under Database, Tables, The spec, Services between chats (chat F's part) and Routes (chat F's part).

## Dependencies

Install all of these in task 1, so the wave 1 chats never touch the lockfile at the same time. Check each licence as you install, and list them under Credits in the README.

- **Runtime:**
  - next, react and react-dom, from the scaffolder
  - kysely, better-sqlite3, pg
  - zod, undici, nodemailer
  - radix-ui, cmdk, react-day-picker, date-fns, sonner, lucide-react
  - @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities
  - @tanstack/react-table, @tanstack/react-virtual, @number-flow/react
  - maplibre-gl, exceljs, croner
  - @modelcontextprotocol/sdk, @apidevtools/swagger-parser
  - @mozilla/readability, linkedom, turndown
- **Dev:**
  - The scaffolder's TypeScript, ESLint, eslint-config-next and Tailwind v4 packages
  - @types/better-sqlite3, @types/pg, @types/nodemailer, @types/turndown
  - vitest, tsx
  - prettier, prettier-plugin-tailwindcss
  - @ls-lint/ls-lint
  - @electric-sql/pglite, @electric-sql/pglite-socket
- **Expected licences:**
  - MIT for nearly all of them
  - ISC for lucide-react and linkedom
  - BSD-3-Clause for maplibre-gl
  - Apache-2.0 for @mozilla/readability and PGlite

  If one turns out different and doesn't allow this use, pick another that does and note it in your Report.

## Tasks

1. **Scaffold and tooling.**
   - Scaffold from the repo root with `npx create-next-app@latest client` (TypeScript, ESLint, Tailwind, App Router, `src/` and the `@/*` alias). Then read the parts of `client/node_modules/next/dist/docs/` you configure.
   - `next.config.ts`:
     - `distDir: process.env.NEXT_DIST_DIR || ".next"`
     - `output: "standalone"`
     - better-sqlite3 kept out of the bundle, if Next doesn't already do that
   - Strict TypeScript.
   - Config from `saimul:new-project` `templates/`:
     - `prettierrc.json` becomes `client/.prettierrc`.
     - `ls-lint.yml` becomes the root `.ls-lint.yml`. Allow Next's `[id]`, `(group)` and `.well-known` folder names, and ignore `design/`, whose artboards are PascalCase.
     - `editorconfig` becomes the root `.editorconfig`.
   - Scripts:
     - `dev`, `build`, `start` (migrate, then serve)
     - `lint` (with `lint:names`), `typecheck`
     - `format`, `format:check`
     - `test` (`vitest run`), `test:pg` (`TEST_DB=postgres vitest run`)
     - `db:migrate`, `db:pg`, `db:seed`
   - `client/.gitignore`: remove the `.env*` lines the scaffolder adds, and ignore `.data/`, `.pglite*/`, `.next-*/` and `.dev-mail/`.
   - Env:
     - Move the root `.env` value into `client/.env` as `LIVE_DATABASE_URL`, then delete the root `.env`. Never print the value.
     - Add the dev values: `APP_URL=http://localhost:3300`, a generated `APP_SECRET` (32 random bytes), a generated `SEED_PASSWORD` and `SIGNUPS=open`. Leave `DATABASE_URL` unset, so SQLite is the default.
     - Write `client/.env.example` with every key and a comment, and no secret values: DATABASE_URL, DATABASE_POOL_MAX, APP_URL, APP_SECRET, SIGNUPS, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, TRUSTED_PROXY_HOPS, NEXT_PUBLIC_REPO_URL, SEED_PASSWORD, LIVE_DATABASE_URL, E2E_AI_PROVIDER, E2E_AI_MODEL, E2E_AI_KEY, E2E_CORESIGNAL_KEY.
   - Install every dependency above. Every script passes on the fresh scaffold.
2. **Database layer** (common.md › Database):
   - `db/index.ts` picks SQLite or Postgres from `DATABASE_URL` and exports the helpers.
   - `db/schema.ts` holds the `Database` interface.
   - `db/migrate.ts` runs the Kysely migrator over the static list in `migrations/index.ts`.
   - `scripts/db-migrate.ts`.
   - `scripts/db-pg.mjs`, adapted from the CMS `scripts/db-local.mjs`: a PGlite socket server on `LOCAL_DB_PORT` with data in `LOCAL_DB_DIR`.
   - `db/testing.ts` gives each test file a fresh database of either kind.
   - Tests: the helpers, and a claim that two racers can't both win, on both databases.
3. **Migration `0001_init.ts`:** every table and column in common.md › Tables.
   - Indexes:
     - unique email and mcp_handle
     - sessions by user
     - projects by user
     - runs by project and start, and by user and start
     - datasets by user
     - dataset rows by dataset and run, plus the partial unique key
     - schedules by status and next run
     - setup events by setup and id
     - AI keys by user and position
     - API keys by user
     - the OAuth indexes from the CMS
   - Auto ids: `integer` on SQLite and `bigserial` on Postgres, through one helper.
   - For the OAuth tables, port the CMS `mcp_oauth_*` and `mcp_tokens` definitions from `db/migrations/0001_init.sql`. Chat A adjusts them with its own migration if it needs to.
4. **Contracts** (`client/src/contracts/`):
   - `common.ts`: `ApiError` and friends, from the CMS `src/contracts/common.ts`.
   - `spec.ts`, exactly as common.md › The spec, with its rules and plain messages.
   - `values.ts`: the Value for each kind, `defaultValues` and `isChanged`.
   - `runs.ts`, `events.ts` and `index.ts`.
   - Tests: the three seed specs pass, and broken ones fail with messages an AI can act on.
5. **CMS core.** Copy and adapt; every test passes on both databases.
   - `server/http/`, from the CMS `src/server/http/`: handle, errors, inputs, rate-limit and cookies. Drop frame-page.
   - `server/net/public-address.ts`, plus `guarded-fetch.ts`:
     - the undici Agent with the check at DNS time;
     - http and https only;
     - a 20 s timeout and 10 MB cap by default;
     - at most 3 redirects, each checked again.
   - `server/secrets.ts`: the AES-256-GCM part of the CMS `auth/tokens.ts`, keyed from `APP_SECRET`.
   - `server/mail/`, from the CMS `auth/mail.ts`: one SMTP sender from the env. Without SMTP, each mail goes to the console and to a file in `client/.dev-mail/`, with its links as plain text.
   - `server/jobs/`, from the CMS `jobs/`: registry, tick and time, without per-site jobs, with claims as in common.md.
   - `instrumentation.ts` runs migrations, then starts the tick, on the Node runtime only.
   - `server/auth/`, from the CMS `auth/`: scrypt passwords, sessions, tokens, resets and the email check. Drop invites, TOTP, two-factor and the authenticator app.
   - `services/context.ts`: `Ctx`, `requireUser` and `requireCheckedEmail`.
   - Rate limits on sign-up, log-in, reset and resending the check, per IP and per email.
6. **Services and routes.**
   - `services/auth.ts`:
     - sign up: email; a password of 12 or more with the strength line the screen shows; workspace named from the email domain (`brightfield.com.au` becomes "Brightfield"); time zone from the browser;
     - log in and log out;
     - check email and resend;
     - request a reset and reset;
     - change the password and change the email;
     - delete the account and everything in it.
   - `users.ts`.
   - `api-keys.ts` (common.md › Services).
   - `projects.ts`.
   - `index.ts`.
   - Routes: `/api/auth/*`, `/api/projects` and `/api/health`, which pings the database and returns the version.
   - `SIGNUPS=closed` gives a friendly message.
   - Sessions: an httpOnly cookie, Secure when `APP_URL` is https, SameSite Lax, 30 days and sliding.
   - An origin check on every route that changes state.
7. **Design system.**
   - **Port `design/canvas/project/dialed.css`** into `client/src/styles/`, split by its sections. Keep every class name, value and media query (laptop at 1180, phone at 760, reduced motion), and drop the canvas-only rules (`.board*`, artboard wrappers, `x-dc`, `helmet`).
     - Yours: `tokens.css` (also mapped into Tailwind v4 `@theme`), `base.css`, `components.css`, `shell.css`, `auth.css`.
     - Chat A's: `onboarding.css`, `new-project.css`, `setup.css`, `settings.css`.
     - Chat B's: `controls.css`, `workspace.css`, `results.css`, `projects.css`, `data.css`, `schedules.css`.
     - Import them all from `globals.css` now.
   - **Fonts** through `next/font/google`: Onest, Plus Jakarta Sans and Geist Mono, under the CSS variables the canvas uses.
   - **Large screens:** from 1920 to 3840, keep the 1440 composition, only bigger. Use one method for the whole app: a CSS `zoom` ramp on the app root, because the canvas CSS is in px.
   - **Components** in `client/src/components/ui/`:
     - Built on `radix-ui`, cmdk, react-day-picker and sonner, and styled with the ported classes.
     - Each one has hover, focus-visible, active and disabled states and the pointer cursor.
     - Button: primary, secondary, ghost, danger and icon tile.
     - Field (label, hint, inline error), Input, PasswordInput (show and hide, strength line), Textarea.
     - Select (styled), SearchSelect, MultiSelect (chips), Segmented, Switch (320ms slide), Checkbox.
     - FolderTabs, Dialog, Popover, Menu, Tooltip, Toast.
     - DatePicker (one date or a range) and TimePicker (a styled list).
     - Led: live, connected, paused and failed, with a halo; it pulses three times, then rests.
     - Chip, Tag, Monogram, Kbd, Card, Panel, Kpi.
     - CopyField (with a copied state), Stepper, EmptyState, Skeleton.
     - A DataTable shell on TanStack Table with virtual rows.
   - **`/dev/ui`:** a page, outside production only, that shows every component and state, for chats A and B.
8. **App shell** (`components/shell/` and `app/(app)/layout.tsx`, from the rail, topbar and tab bar in the canvas):
   - The rail: logo, Projects, Data, Schedules, Settings, the avatar with initials, and active states.
   - The topbar:
     - the workspace name and page title;
     - the ⌘K search, which opens a command palette over projects, datasets and pages;
     - a slot for the page's main action.
   - On phone: the header and the bottom tab bar.
   - The page frame and side-panel layout.
   - The redirect when signed out.
   - The banner for an unchecked email: "Check your email to start", with Resend.
9. **Account screens (01).**
   - `/sign-up`, exactly as `SignUp.dc.html` and `SignUpPhone.dc.html`: the calm form on one side, and the dark box on the other with the narrative mini-UI (doc line, fader, data, Ready). The mini-UI plays once; under reduced motion it shows the final state.
   - `/log-in` in the same layout.
   - `/check-email`: where it was sent, Resend, and a link for a wrong address.
   - `/reset-password`: ask for the link, then set a new password from it.
   - `/privacy` and `/terms`: short, plain pages for an open-source app where people bring their own keys. What's stored, that keys are sealed, that no data is sold, and that the account can be deleted in Settings. Flag both in your Report for the user to review.
   - "Open source on GitHub" uses `NEXT_PUBLIC_REPO_URL`.
   - After the email check, people go to `/welcome/ai`. Chat A builds it, so a 404 there is expected for now.
10. **Seed** (`npm run db:seed`). It refuses unless `DATABASE_URL` is unset, a file, or 127.0.0.1.
    - **People,** both with `SEED_PASSWORD`:
      - `nadia@dialed.test`: Nadia Rahman, workspace "Brightfield", Australia/Sydney, email checked.
      - `new@dialed.test`: email not checked.
    - **Three ready projects** from `client/src/server/seed/specs/`. Write each spec from the API's own docs, and check every path, field and cost there:
      - `open-meteo.json`, "Store weather": the forecast for a list of places, days ahead, and which daily values (temperature, rain). No key needed.
      - `hacker-news.json`, "AI launch posts": Hacker News search by Algolia, with a query, story type, a minimum of points and a time window. No key needed.
      - `coresignal.json`, "AU software companies": company search, then collect, with the key in an `apikey` header and no key saved. The design brief says the filter search is free and returns ids, a full record costs 20 credits, and there's no radius search, only place names. Confirm each against docs.coresignal.com. Anything you can't confirm goes in the spec's notes and your Report.
    - Chat B adds runs, datasets and schedules on top with its own `client/scripts/seed-data.ts`.
11. **Ship files.**
    - `client/Dockerfile`: Node 24 slim, the standalone output, a non-root user, a `/data` volume for SQLite, migrations on start, and a health check on `/api/health`.
    - `client/docker-compose.yml`: the app with a volume, and a Postgres service, commented out, for those who want it.
    - Root `README.md`, with a section for each:
      - what Dialed is, in one paragraph;
      - run it locally in three commands, with nothing to install;
      - use Postgres by setting `DATABASE_URL`;
      - self-host with Docker;
      - connect your AI (chat A fills this in);
      - runs, data and schedules (chat B fills this in);
      - licence;
      - credits for the open-source libraries and data.
    - `LICENSE`: MIT, 2026, DeveloperLook, at the repo root, where GitHub looks for it.
12. **Test once** (below), then write your Report.

## Done when

- `npm run lint`, `typecheck`, `test` and `test:pg` pass in `client/`.
- On both SQLite and Postgres:
  - signing up works, with the check link from `.dev-mail/`;
  - logging in, logging out and the password reset work;
  - the seed loads three projects whose specs pass the contract.
- `/sign-up` and `/log-in` match their artboards at 390 and 1440, and `/dev/ui` shows every component state.
- `docker build` of `client/` works, and the container answers `/api/health` with SQLite on a volume.

## Module test steps

1. Run every script once.
2. **SQLite.** Dev server on 3300 with `.data/f.db`, then go through the flow with curl:
   - sign up;
   - the check link from `.dev-mail/`;
   - a session, and `/api/projects` empty for the new account;
   - the log-in rate limit;
   - the reset flow;
   - `SIGNUPS=closed`.
3. **Postgres.** The same on `db:pg` at port 5530.
4. Run the seed on both databases.
5. **Design QA** (`saimul:design-qa`):
   - `/sign-up` and `/log-in` at 390 and 1440, against `SignUp.dc.html` and `SignUpPhone.dc.html`;
   - the shell and `/dev/ui` at 390, 1440 and 2560.
6. `docker build`, then run the container with a volume and curl `/api/health`.

## Report

- Done:
- Files:
- Tests:
- Open issues:
- Requests:
