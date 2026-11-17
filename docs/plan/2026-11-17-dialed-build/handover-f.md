# Chat F hand-over (foundation, 2026-11-17)

For chats A and B. The binding contracts are in `docs/plan/2026-11-17-dialed-build/common.md`; this note says where things are and what differs.

## Where things are (all in `client/`)

- Database: `src/server/db/index.ts` (`db`, `dialect`, `newId`, `now`, `json`, `parseJson`, `bool`, `transaction`, plus `changed()`, `likePattern()`, `createKysely()`), `schema.ts` (row types: wrap in Kysely's `Selectable<>` when you type a selected row), `claim.ts` (`claim('jobs'|'schedules', id, until, at)`), `migrate.ts`, `migrations/index.ts` (add `'0002_a_x': m0002a,`), `testing.ts` (`createTestDb()` in a test file's top level or beforeAll; `test-setup.ts` gives each file its own SQLite file or PGlite).
- Inside `transaction(fn)`, `db` *is* the transaction (AsyncLocalStorage, like the CMS). Never call the root db's `.transaction()` yourself.
- Booleans: SQLite returns 0/1, so selected boolean columns type as `boolean | number`; read them with `bool()`. Inserting `true`/`false` works on both (the SQLite driver turns them into 1/0).
- Insert types are strict: every column without a default in TS must be passed (see `seed/index.ts` for a full user insert).
- Services: `src/server/services/index.ts` exports `auth`, `users`, `apiKeys`, `projects`, `requireUser`, `requireCheckedEmail`, `Ctx`. `Ctx = { user: Me, now }`.
  - `apiKeys.secretFor(ctx, keyId, hostOrUrl)` throws `wrong_host` unless the host matches, and needs a checked email.
  - `projects.saveSpec(ctx, id, spec, { author, note, status })` validates, bumps `spec_version`, writes `spec_versions`, sets status `ready` by default. `projects.markRun(ctx, id, at)` for B.
  - `users.replaceHandle(ctx)` gives a new MCP handle ("New address"); `users.byHandle(handle)`; `users.update(ctx, patch)` for Settings.
- Pages: `src/server/services/page-context.ts` has `currentCtx()` (or null) and `pageCtx()` (redirects to /log-in) for server components.
- Routes: `src/server/http` has `route()` (signed in) and `publicRoute()`; they check Origin, renew the session cookie and shape errors. Input checks: `checkBody(schema, body)`, `checkQuery(schema, query)`. Rate limits: `rateLimit(key, limit, windowMs)`.
- Outbound: `src/server/net/guarded-fetch.ts` `guardedFetch(url, { method, headers, body }, { timeoutMs, maxBytes, maxRedirects, secretHeaders })`. Returns `{ ok, status, headers, url, redirects, ms, bytes, text(), json() }`; throws `GuardError` with `code` (`bad_url`, `private_address`, `timeout`, `too_large`, `too_many_redirects`, `network`, `bad_json`). Pass the API's key header name in `secretHeaders` so a cross-host redirect drops it. Tests can stand up a local server with `allowLoopbackForTests(true)` (Vitest only).
- Mail: `src/server/mail` `send()`, `trySend()`, templates in `templates.ts` (add yours there or next to your feature). Tests read `sentMail`.
- Jobs: `src/server/jobs` `registerJob`, `runJobNow`, `tickJobs`, time helpers (`zonedToUtc`, `zonedParts`, `nextDailyRun`, `validTimeZone`). Add your list in `jobs/registry.ts`.
- Secrets: `src/server/secrets.ts` `seal`, `unseal`, `last4`, `masked`.
- Contracts: `src/contracts/` `spec.ts` (`checkSpec`, `ApiSpecSchema`, `valueProblem`, `allControls`, `channelNumber`), `values.ts` (`defaultValues`, `isChanged`, `startValue`, `isEmptyValue`, `resolveValues`), `runs.ts`, `events.ts`, `auth.ts`, `projects.ts`, `api-keys.ts`.
- Seed specs: `src/server/seed/specs/*.json`, all passing the contract.

## The spec: one addition (please read, B especially)

CoreSignal's company search is Elasticsearch DSL only (POST body, ids back, cursor in the `x-next-page-after` header, total in `x-total-results`), and the Hacker News time window needs `created_at_i>…` inside `numericFilters`. The spec as written couldn't express either, so `Control` gained one optional field, `template`, and the builder rules are written at the top of `contracts/spec.ts`:

1. Empty values leave the parameter out.
2. `format` shapes the value (comma, array, iso-date, unix, year).
3. `template` wraps it: a string with `{value}`, or a JSON object whose strings `"{value}"`, `"{min}"`, `"{max}"`, `"{lat}"`, `"{lng}"`, `"{radius}"` are replaced with that part of the value, type kept; unfilled object entries are dropped.
4. A body key ending in `[]` appends to that array (`query.bool.filter[]`).
5. Two query controls with the same key join their parts with commas.
6. `pagination.cursorPath` may be `header:<name>`.

All three seed specs use these. Chat A's AI prompt should know them too.

## UI

- `/dev/ui` shows every component (dev only). Import from `@/components/ui` and `@/components/shell` (`Topbar`, `PageFrame`, `useShell`). Every page under `(app)` renders `<Topbar title action phoneAction />` first, then `<PageFrame>` or its own layout.
- Your screens' CSS files are ported and imported already (`src/styles/<screen>.css`); edit only your own. Each file has its phone and laptop rules at its end.
- `Select` is Radix (wrapped in `.pop`), `SearchSelect`/`MultiSelect` are cmdk in a popover, `DatePicker` is the canvas `.cal` grid (date-fns) for one date or a range, `TimePicker` a styled list. `DataTable` is TanStack Table **v9** (`useTable`, not `useReactTable`) with virtual rows: columns are `DataColumn<T>[]`, `meta: { align: 'right' }` right-aligns.
- Large screens: `body { zoom: var(--zoom) }` from 1920 up. Full-height screens divide `100vh` by `var(--zoom)` (`body .app`, `body .auth`, `body .onb` already do).
- `cacheComponents` is off: pages that read cookies render per request.

## Dev notes

- `npm run db:pg` doesn't migrate; the app migrates on start, or run `npm run db:migrate`.
- The BrowserOS neo window here doesn't paint background tabs; open pages with `tabs new` and reload after changing the emulated size, or screenshots time out and CSS may look missing.
