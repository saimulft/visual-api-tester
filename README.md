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

Dialed runs no AI of its own. Your AI reads an API's docs and writes the project's controls, in one of two ways. Pick either when you sign up (Connect your AI), and add the other later in Settings, AI and keys.

**Paste an AI key (the built-in assistant).** Dialed calls your provider with your key, and your provider bills you.

- **Providers:** Anthropic, OpenAI, Google Gemini or OpenRouter. Pick one, paste the key and pick a model from the provider's live list (the newest Claude Sonnet is the default for Anthropic). Test sends one tiny message and says how long the answer took.
- **Tried from the top:** add as many keys as you like and drag them into order. A rejected key, a rate limit or an empty balance moves on to the next key; an outage skips the rest of that provider's keys.
- **Safe keeping:** keys are encrypted with `APP_SECRET` and never sent back to the browser; you see the last four characters only. Every call is counted in Settings, Usage.
- **Limits per setup:** 25 docs pages, 80 tool calls and 15 minutes. You can stop a setup at any time.

**Use your own AI over MCP.** Connect the Claude, ChatGPT or Cursor you already pay for. That AI sets up and runs your projects through Dialed's MCP server, and you need no AI key in Dialed.

1. Copy your MCP address from Settings, AI and keys. It looks like `https://your-dialed.example.com/mcp/u/k7xq2m9ph4rt`.
2. Add it in your AI app:
   - **Claude:** Settings, then Connectors, then Add custom connector. Paste the address and name it Dialed.
   - **ChatGPT:** Settings, then Apps and connectors. Turn on Developer mode under Advanced, choose Create, paste the address, name it Dialed and pick OAuth.
   - **Cursor:** Settings, then MCP, then Add new MCP server. Paste the address as the server URL and name it Dialed.
3. Sign in to Dialed when the app asks, and press Allow.

Then ask it, for example, "Set up my Dialed project AU software companies", and watch the Setup page fill in. The AI gets seven tools: `list_projects`, `create_project`, `read_api_docs`, `set_controls`, `run_request`, `get_results` and `schedule_pull`.

- **Your address only:** a token works on your own address and nowhere else. Disconnect signs one app out; New address signs every app out at once.
- **Spending stays yours:** your AI tests free endpoints only. A run that costs credits shows the cost first and runs only after you say yes.
- **Keys never reach the AI:** add API keys in Dialed. A saved key is sent only to the host it was saved for, and no docs page or prompt can change that host.
- **Standards:** OAuth 2.1 with PKCE and dynamic client registration, with the metadata at `/.well-known/oauth-authorization-server`, so any MCP client that speaks Streamable HTTP can connect.

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

**Places.** The places control searches countries and about 34,000 cities offline. The cities are in `client/src/server/places/data/cities.tsv`, built from [GeoNames](https://www.geonames.org) `cities15000` (every city with 15,000 people or more). To refresh it, run these in `client/`:

```bash
curl -O https://download.geonames.org/export/dump/cities15000.zip && unzip cities15000.zip
```

```bash
curl -O https://download.geonames.org/export/dump/admin1CodesASCII.txt
```

```bash
npx tsx src/server/places/build-cities.ts cities15000.txt admin1CodesASCII.txt
```

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
