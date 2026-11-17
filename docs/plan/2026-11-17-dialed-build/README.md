# Dialed: build plan (2026-11-17)

**Goal:** build Dialed, the open-source app on the approved design canvas.

- People sign up with email and password.
- They connect their own AI: a pasted AI key, or their own Claude, ChatGPT or Cursor over MCP.
- The AI reads an API's docs and turns the API into numbered channels of faders, switches and lists.
- People dial the controls in, run, keep the data, download it and schedule regular pulls.

The first API is CoreSignal. The build matches the canvas exactly: same layout, copy, type, colours and motion.

## Where things stand (checked 2026-11-17)

- **Repo:** `saimulft/visual-api-tester` (private now, meant to go public), branch `main`, one commit.
  - Not committed yet: `.gitignore` (its `.env` lines removed), `.env` (the database URL), `design/` and `docs/`.
  - There's no app code yet.
- **Design** (approved and final):
  - Canvas: https://claude.ai/artifact/CdcKNL1PzJhzEXp8cieeZ7
  - Source: `design/canvas/project/`, one `.dc.html` per artboard plus the shared `dialed.css`
  - Direction: `docs/design-direction.md`
  - References: `docs/design-references.md`
  - It has 10 screens, each with a 1440 artboard and a 390 phone artboard, plus the controls reference board (07).
  - The workspace (06) is `Main.dc.html`.
- **Database:** the role and database `visual_api_tester` sit on the DeveloperLook Postgres server.
  - Server: 5.189.129.139:5432, Postgres 16.15, with SSL off.
  - The database is empty.
  - Its URL is in the root `.env`. Chat F moves it to `client/.env` as `LIVE_DATABASE_URL`, and only go-live uses it.
- **Code to copy:** the DeveloperLook CMS (`~/Downloads/dl-cms/cms`) runs on Next.js 16.4 on Dokploy and already has the backend pieces Dialed needs. Each chat file names the exact files.

| CMS module | Path in `dl-cms/cms/` | Becomes | Chat |
| --- | --- | --- | --- |
| Auth | `src/server/auth/` (passwords, sessions, tokens, resets, mail) | Sign-up, log-in, email check, resets | F |
| HTTP helpers | `src/server/http/` (handle, errors, inputs, rate-limit, cookies) | Route handlers | F |
| Outbound guard | `src/server/net/public-address.ts` | Every call to an API or a docs page | F |
| Jobs | `src/server/jobs/`, `src/instrumentation.ts` | The scheduler tick | F (B uses it) |
| Local Postgres | `scripts/db-local.mjs` (PGlite) | Postgres test runs | F |
| AI layer | `src/server/ai/` (providers, chain, fallback, models, limits, meter, stream, sse, tools, settings) | The built-in assistant, with keys tried from the top | A |
| OAuth and MCP | `src/server/oauth/`, `src/server/mcp/`, `src/app/oauth/`, `src/app/.well-known/`, `src/app/api/mcp/` | Dialed's MCP server | A |

The CMS talks to Postgres in plain SQL through `pg`. Dialed runs on SQLite and on Postgres, so every copied query is rewritten through Kysely (common.md › Database).

## Decisions (2026-11-17)

| Topic | Decision |
| --- | --- |
| Base | Copy and adapt the CMS modules above, with their queries rewritten through Kysely. |
| App | One Next.js 16 app in `client/` holds the pages, route handlers, MCP server and scheduler, like the CMS. It runs wherever a Node server runs: Docker, Dokploy, Railway, Fly, Render or a VPS. No Cloudflare or Vercel. |
| Database | SQLite by default (`client/.data/dialed.db`, nothing to set up). Postgres when `DATABASE_URL` is a `postgres://` URL. Built with Kysely (MIT), better-sqlite3 (MIT) and pg (MIT). One set of migrations, and tests run on both. The hosted instance uses the Postgres database above. |
| Accounts | Email and password, with an email check and password reset. Anything that calls an API or an AI needs a checked email. Sign-ups are open, and `SIGNUPS=closed` turns them off. One workspace per person, named from their email domain and renamed in Settings. |
| Your AI | Either keys the person pastes, or their own AI over MCP. Keys: Anthropic, OpenAI, Google Gemini or OpenRouter, each with a model, tried from the top. MCP: Claude, ChatGPT, Cursor or any MCP client, signed in with OAuth 2.1 at a per-person address that "New address" replaces. |
| The API spec | One validated JSON document per project (common.md › The spec), versioned on every change. The AI writes it through tools; values the person changes are marked as theirs. |
| Calls | Only the server calls APIs. A saved key is sent only to the host it was saved for. Every outbound call goes through the guard, with timeouts, size caps and per-person rate limits. The AI's test call uses free endpoints only. A run that spends credits shows the cost first and stops at the credit limit. |
| Data | Rows are kept in the database per dataset (add new rows, replace all, or keep each run). They export as CSV, Excel or JSON, and there's a live CSV link with a secret token that can be turned off. |
| Schedules | Hourly, daily, weekly or monthly, in the person's time zone, with a credit limit per run and email alerts. The CMS scheduler's one-minute tick runs them. |
| Email | The CMS mailer (Nodemailer over SMTP). With no SMTP set, mail goes to the console and to `client/.dev-mail/`. |
| Licence | MIT. |
| Out of scope | Cloudflare, Vercel, teams and sharing, billing, 2FA, an admin UI, webhooks, pushing to Google Sheets (the live CSV link covers it), native apps. |

## Run order

| Wave | Chats | Start after |
| --- | --- | --- |
| 0 | F Foundation | |
| 1 | A AI setup and MCP, B Runs, data and schedules (side by side in this folder) | F |
| Final | Review and E2E, then go-live with your OK | A and B |

## Chats

| Chat | Model, effort | Owns (exact paths in each chat file) | Start after |
| --- | --- | --- | --- |
| F Foundation | Opus 5.5, High | Scaffold and tooling, the database layer and every migration, contracts, CMS auth and helpers, the design system, app shell, account screens, seed, Dockerfile, README, LICENSE | none |
| A AI setup and MCP | Opus 5.5, Extra high | AI layer and keys, docs discovery, the setup agent, OAuth and MCP; screens 02, 04, 05 and 10 | F |
| B Runs, data and schedules | Opus 5.5, Extra high | Request builder, the twelve controls, runs, datasets, exports, live CSV link, schedules; screens 03, 06, 08 and 09 | F |
| Review and E2E | Opus 5.5, Extra high | The Reports, the diff, full checks on both databases, E2E, go-live | A, B |

Chat files:
- [common.md](common.md): rules and binding contracts for every chat
- [chat-f.md](chat-f.md)
- [chat-a.md](chat-a.md)
- [chat-b.md](chat-b.md)
- [review.md](review.md)
- [e2e.md](e2e.md)

## Kickoff prompts

- `You are chat F. Read docs/plan/2026-11-17-dialed-build/common.md and chat-f.md and do it.`
- `You are chat A. Read docs/plan/2026-11-17-dialed-build/common.md and chat-a.md and do it.`
- `You are chat B. Read docs/plan/2026-11-17-dialed-build/common.md and chat-b.md and do it.`
- `You are the review and E2E chat. Read docs/plan/2026-11-17-dialed-build/common.md, review.md and e2e.md and do them.`

## Go-live

The review and E2E chat does this at its end. Each step that touches production waits for your OK in the picker.

1. **Address:** pick the app's address with the user, for example a DeveloperLook subdomain, and add its DNS record.
2. **Dokploy app:** create a Dialed application in Dokploy (https://deploy.developerlook.com/) from the GitHub repo.
   - Build path `client/`, using its Dockerfile.
   - Health check `/api/health`.
3. **Environment:**
   - `DATABASE_URL`: the `visual_api_tester` database. If the app runs on the same Dokploy server as that Postgres, use its internal host so the traffic doesn't cross the public port with SSL off.
   - `APP_URL`.
   - `APP_SECRET`: a new one.
   - `SMTP_*`: the CMS's SMTP settings.
   - `MAIL_FROM`: an address picked with the user.
   - `TRUSTED_PROXY_HOPS`.
   - Print key names only.
4. **Deploy:** migrations run on start.
5. **Live check** with page text and curl:
   - A sign-up email arrives and its link works.
   - Log-in works.
   - `/api/health` and `/.well-known/oauth-authorization-server` answer.
   - The MCP address answers 401 with the OAuth challenge.
6. **Real MCP check:** the user adds Dialed as a custom connector in their Claude account and runs one setup. The chat watches the Setup page.

## Rough size

| Chat | Hours |
| --- | --- |
| F Foundation | 11 to 12 |
| A AI setup and MCP | 13 to 14 |
| B Runs, data and schedules | 12 to 14 |
| Review, E2E and go-live | 5 to 6 |

- With A and B side by side, that's about 30 hours from start to finish and about 44 agent hours in all.
- Expect roughly 1.3 billion tokens, nearly all of them re-reads of cached context, with about 3.5M output. That's about $890 at API prices.
- The yardstick is the CMS organizations build of 1 to 5 Nov, which had a similar shape: about 780M tokens and $520.
