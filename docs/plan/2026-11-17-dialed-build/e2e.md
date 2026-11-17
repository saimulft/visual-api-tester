# E2E brief

## Before you start

- **Start the app** from `client/`:
  - Use the production build from the review step, on port 3330, run as a tracked background task.
  - Use a fresh SQLite database: `DATABASE_URL=file:./.data/r.db`.
  - Run `npm run db:migrate`, `npm run db:seed` and `npx tsx scripts/seed-data.ts` first.
- **Postgres:** flows marked "both" run again on Postgres.
  - Start it with `LOCAL_DB_PORT=5533 LOCAL_DB_DIR=.pglite-r npm run db:pg`.
  - Then set `DATABASE_URL=postgresql://postgres@127.0.0.1:5533/postgres`, migrate, seed and restart the app.
- **Accounts** (from the seed):
  - `nadia@dialed.test` has a checked email, projects and data.
  - `new@dialed.test` hasn't checked its email.
  - The password for both is `SEED_PASSWORD` in `client/.env`.
  - New sign-ups use `e2e+<n>@dialed.test`, and their mail lands in `client/.dev-mail/`.
- **Keys:** `E2E_AI_PROVIDER`, `E2E_AI_MODEL`, `E2E_AI_KEY` and `E2E_CORESIGNAL_KEY` in `client/.env`. If one is missing, ask the user with the picker. Never print them.
- **CoreSignal costs:** searches are free, and collecting records spends credits. Ask the user before any collect, and collect at most 2 records.
- **Browser:** BrowserOS neo, page text first, with each viewport set through CDP as `saimul:design-qa` says. Close your tabs at the end.

## Flows

| # | Flow | URL | Account | Expected result |
| --- | --- | --- | --- | --- |
| 1 | Sign up (both) | `/sign-up` | `e2e+1@dialed.test` | The story box plays once. A weak password gets the strength message. Create account opens `/check-email`, and the link in `.dev-mail/` checks the email and opens `/welcome/ai` |
| 2 | Log in and reset (both) | `/log-in`, `/reset-password` | nadia | A wrong password says so, and repeated tries hit the limit. The reset mail's link sets a new password and ends other sessions |
| 3 | Email-check gate | `/projects/new`, `/projects/[id]` | `new@dialed.test` | A banner asks for the email check, and Set up project and Run say why they're blocked |
| 4 | Connect your AI with a key | `/welcome/ai` | `e2e+1` | Test says "Connected. (AI) replied in x s", the key shows only its last 4, and Continue opens `/projects/new` |
| 5 | Built-in setup on Hacker News (both) | `/projects/new`, then `/projects/[id]/setup` | nadia | The docs are found. The four steps run live, controls drop into channels and notes appear. The free test call passes, and Ready to dial opens the workspace |
| 6 | CoreSignal setup | `/projects/new` | nadia | docs.coresignal.com is found with an endpoint count. The key is saved for api.coresignal.com. The setup builds company search with notes such as "no radius search", and the test call is a free search |
| 7 | Workspace (both) | `/projects/[id]` | nadia | Faders, switches and lists change the live match count (CoreSignal) and the Request tab. Run on Hacker News and Open-Meteo shows rows cascading in. The JSON and Request tabs work, with the key masked. A CoreSignal collect of 2, after the user's OK, uses 40 credits |
| 8 | Presets | `/projects/[id]` | nadia | Save, apply, rename and delete a preset |
| 9 | Saved data (both) | `/data` | nadia | Save to a new dataset with "Add new rows", then run again: repeats are skipped and counted. "Replace all" and "Keep each run" behave as named. The CSV, Excel and JSON downloads open with the right rows. curl on the live CSV link returns CSV, and Turn off makes it 404 |
| 10 | Schedules (both) | `/schedules` | nadia | Weekly on Monday at 09:00 Sydney lists the next three runs correctly across a DST change. Run now saves rows. A due schedule runs once on the tick, not twice. A run over the credit limit stops and sends an email, and so does a bad key. Pause and resume work |
| 11 | MCP (both) | `/mcp/u/<handle>` | nadia | A scripted MCP client registers, sees the consent page, gets a token and uses all seven tools on an Open-Meteo project. The Setup page updates live, and Settings lists the client with its last use. After New address, the old token gets a 401 |
| 12 | Settings | `/settings/*` | nadia, `e2e+1` | AI keys reorder and test. API keys test and replace. The alert email saves. Usage matches the runs. Name, workspace and email change, with the email checked. Deleting the `e2e+1` account removes everything in it |
| 13 | Phone | every screen at 390 | nadia | The bottom tab bar shows. The workspace has the Controls and Results switch with the Run bar pinned. Nothing overflows |
| 14 | Security spot checks | | nadia, `e2e+1` | A private or localhost base URL is refused, and a changed host gets no key. Another account's project, dataset and run ids give 404, and so does a wrong CSV token |
| 15 | Design QA | every screen | nadia | `saimul:design-qa` from 390 to 3840 against the canvas artboards, with every scorecard line at 4 or more |

Fix what fails or write a fix brief, then re-check only the flows that failed. End with the "⚠️ Your action needed" section.
