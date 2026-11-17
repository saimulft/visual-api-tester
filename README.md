# Dialed

Dialed gets data out of any API without writing code. You bring your own AI (a pasted AI key, or your own Claude, ChatGPT or Cursor connected over MCP) and your own API keys. The AI reads the API's docs and turns it into numbered channels of faders, switches and lists. You dial the controls in, run, keep the data, download it as CSV, Excel or JSON, and schedule regular pulls. It's one Next.js app that runs anywhere Node runs, on SQLite by default or Postgres when you want it.

## Run it locally

You need Node 24. Nothing else: the database is a SQLite file the app makes for you.

```bash
cd client
```

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3300 and sign up. Without SMTP settings, emails (the sign-up check, resets) print to the console and land in `client/.dev-mail/`, links included. For sample projects, set `SEED_PASSWORD` in `client/.env` (12 or more characters; `.env.example` lists every setting) and run `npm run db:seed`, then log in as `nadia@dialed.test`.

Useful scripts, all from `client/`:

| Script | What it does |
| --- | --- |
| `npm run dev` | The app on port 3300 (`PORT` changes it) |
| `npm run db:migrate` | Applies migrations to whichever `DATABASE_URL` is set (the app also migrates when it starts) |
| `npm run db:seed` | Two people and three ready projects (local databases only) |
| `npm run db:pg` | A throwaway Postgres (PGlite) on 127.0.0.1:5530 |
| `npm test` / `npm run test:pg` | The tests on SQLite / on Postgres |
| `npm run lint`, `npm run typecheck`, `npm run format` | Checks |

## Use Postgres

Set `DATABASE_URL` to a Postgres URL and the app uses it instead of SQLite. Migrations run on start.

```bash
DATABASE_URL=postgres://user:password@host:5432/dialed npm run start
```

To try Postgres without installing it, run `npm run db:pg` in one terminal and set `DATABASE_URL=postgresql://postgres@127.0.0.1:5530/postgres` in another.

## Self-host with Docker

The image runs the standalone Next server as a non-root user, keeps SQLite in a `/data` volume, migrates on start and has a health check on `/api/health`.

```bash
cd client && docker build -t dialed .
```

```bash
docker run -d -p 3000:3000 -v dialed-data:/data -e APP_SECRET="$(openssl rand -base64 32)" -e APP_URL=http://localhost:3000 dialed
```

Or use `client/docker-compose.yml`, which also has a Postgres service ready to uncomment. Keep `APP_SECRET` safe and never change it once keys are saved: it seals every API and AI key. Behind a proxy, set `TRUSTED_PROXY_HOPS` so rate limits see the real client address.

## Connect your AI

_Chat A fills this in: AI keys (Anthropic, OpenAI, Gemini, OpenRouter) and connecting your own AI over MCP._

## Runs, data and schedules

**Running a project.** Open a project, dial the controls in and press Run (or ⌘Enter). Violet dots mark values the AI set; teal dots mark the ones you changed.

- **The live count.** The Run module shows the API's own match count, updated as you move a control. It only comes from a free search, so watching it never spends credits.
- **Search, then collect.** For APIs like CoreSignal, Run searches for free, then collects the first records you asked for, and shows the cost before it starts.
- **Spending limits.** A run that would spend more than the project's credit limit asks you first. A scheduled run that would pass its schedule's limit spends nothing, stops and emails you.
- **Keys stay with their API.** A saved key is only ever sent over https to the host it was saved for.
- **Retries and limits.**
  - A rate limit (429) is retried after the API's Retry-After, up to 3 times.
  - A server error or a timeout gets one more try.
  - Each person can make 60 calls a minute and 5,000 a day.
- **Results.** Table, JSON and the masked request (Copy as cURL) sit under the run.

**Saved data.** Save a run's rows to a dataset, from the run or every time a schedule runs. Pick one of three modes:

- **Add new rows:** skips repeats, matched on the records' id. For search-then-collect APIs it skips them before collecting, so repeats cost no credits.
- **Replace all:** each save replaces every row.
- **Keep each run:** every run's rows stay, side by side.

Download any dataset as CSV, Excel or JSON. Big datasets stream a page at a time.

**The live CSV link.** Turn on a dataset's live link and paste it into Google Sheets as `=IMPORTDATA("…")`.

- It serves the newest rows as plain CSV, behind a long random token.
- New link retires the old one, and Turn off stops it.

**Schedules.** Run a project hourly, daily, weekly on chosen days, or monthly, at a time in your time zone. Daylight-saving changes are handled.

- Each schedule saves to a dataset, has a credit limit per run, and can email you when a run fails or send a CSV after each run.
- Alerts go to your alert email in Settings, unless you mute them.
- The server checks for due schedules every minute. Two servers never run the same schedule twice.

**Sample data.** After `npm run db:seed`, this fills `nadia@dialed.test` with presets, runs, six datasets and five schedules, so every screen has something to show:

```bash
npx tsx --env-file-if-exists=.env scripts/seed-data.ts
```

**Places.** The places control searches countries, and cities when `src/server/places/data/cities.tsv` is there. It's built from [GeoNames](https://www.geonames.org) `cities15000` (name, region, country code, latitude, longitude, population, tab-separated).

## Licence

MIT, see [LICENSE](LICENSE). Copyright 2026 DeveloperLook.

## Credits

Dialed is built on these open-source projects. Thank you to everyone who makes them.

| Project | Licence | Used for |
| --- | --- | --- |
| [Next.js](https://nextjs.org), [React](https://react.dev) | MIT | The app |
| [Kysely](https://kysely.dev) | MIT | Queries for SQLite and Postgres |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | MIT | SQLite |
| [node-postgres (pg)](https://node-postgres.com) | MIT | Postgres |
| [PGlite](https://pglite.dev) and pglite-socket | Apache-2.0 | Throwaway Postgres for development and tests |
| [Zod](https://zod.dev) | MIT | Contracts and validation |
| [undici](https://undici.nodejs.org) | MIT | Outbound calls through the guard |
| [Nodemailer](https://nodemailer.com) | MIT-0 | Email |
| [Radix UI](https://www.radix-ui.com), [cmdk](https://cmdk.paco.me), [Sonner](https://sonner.emilkowal.ski) | MIT | Menus, dialogs, the command palette and toasts |
| [react-day-picker](https://daypicker.dev), [date-fns](https://date-fns.org) | MIT | Dates |
| [Lucide](https://lucide.dev) | ISC | Icons |
| [dnd kit](https://dndkit.com) | MIT | Drag and drop |
| [TanStack Table and Virtual](https://tanstack.com) | MIT | Data tables |
| [NumberFlow](https://number-flow.barvian.me) | MIT | Animated numbers |
| [MapLibre GL JS](https://maplibre.org) | BSD-3-Clause | Maps |
| [OpenFreeMap](https://openfreemap.org) tiles, [OpenMapTiles](https://openmaptiles.org), [OpenStreetMap](https://www.openstreetmap.org/copyright) data | MIT (OpenFreeMap), ODbL (OpenStreetMap data) | The map in the map-radius control |
| [GeoNames](https://www.geonames.org) | CC BY 4.0 | City names for the places control |
| [ExcelJS](https://github.com/exceljs/exceljs) | MIT | Excel exports |
| [Croner](https://croner.56k.guru) | MIT | Schedules |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | The MCP server |
| [Swagger Parser](https://apitools.dev/swagger-parser) | MIT | Reading OpenAPI docs |
| [Readability](https://github.com/mozilla/readability) | Apache-2.0 | Reading docs pages |
| [linkedom](https://github.com/WebReflection/linkedom) | ISC | Parsing docs pages |
| [Turndown](https://github.com/mixmark-io/turndown) | MIT | Docs pages to text |
| [Tailwind CSS](https://tailwindcss.com) | MIT | Utility classes |
| [Vitest](https://vitest.dev), [tsx](https://tsx.is), [Prettier](https://prettier.io), [ESLint](https://eslint.org), [ls-lint](https://ls-lint.org) | MIT | Tests and tooling |
| [Onest](https://fonts.google.com/specimen/Onest), [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans), [Geist Mono](https://fonts.google.com/specimen/Geist+Mono) | OFL-1.1 | Type |

The seed projects use public APIs: [Open-Meteo](https://open-meteo.com) (free for non-commercial use, CC BY 4.0 data), [Hacker News Search by Algolia](https://hn.algolia.com/api) and [CoreSignal](https://coresignal.com) (bring your own key).
