# Chat A: AI setup and MCP

Model and effort: Opus 5.5, Extra high. Start after: chat F. You run side by side with chat B in this folder.

## Scope

This chat builds the AI side of Dialed:
- the built-in assistant: the CMS AI layer, with the person's own keys tried from the top;
- finding an API's docs;
- the setup agent, which reads the docs and writes the spec;
- the live Setup screen;
- Dialed's MCP server with OAuth, so people's own Claude, ChatGPT or Cursor can do the same work.

Screens: 02 Connect your AI, 04 New project, 05 AI sets up the API, and 10 Settings (all four tabs).

Load the `claude-api` skill before you touch the Anthropic provider (model ids, tool use, streaming), and `saimul:house-style` for the screens.

## Owned files

- **Server:**
  - `client/src/server/ai/`, `discovery/`, `setup/`, `oauth/`, `mcp/`
  - `client/src/server/services/ai-keys.ts`, `setups.ts`, `settings.ts`, `usage.ts`, `mcp-status.ts`
- **Pages:**
  - `client/src/app/(onboarding)/`, with its own layout and `welcome/ai/`
  - `client/src/app/(app)/projects/new/`
  - `client/src/app/(app)/projects/[id]/setup/`
  - `client/src/app/(app)/settings/`
  - `client/src/app/oauth/`, `.well-known/`, `mcp/`
- **API routes:** `client/src/app/api/ai/`, `api-keys/`, `discovery/`, `setup/`, `settings/`, `mcp-status/`.
- **Components:** `client/src/components/onboarding/`, `new-project/`, `setup/`, `settings/`.
- **Styles:** `client/src/styles/onboarding.css`, `new-project.css`, `setup.css`, `settings.css`.
- **Migrations:** `0002_a_<what>.ts`, only if you must change the schema.

## Don't touch

- Chat F's files, apart from the shared files in common.md.
- Chat B's files:
  - `client/src/server/runner/`, `datasets/`, `schedules/`, `places/`
  - B's services and API routes
  - `app/(app)/projects/page.tsx`, `app/(app)/projects/[id]/page.tsx`
  - `app/(app)/data/`, `app/(app)/schedules/`, `app/csv/`
  - `components/controls/`, `workspace/`, `projects/`, `data/`, `schedules/`
  - B's CSS files and `scripts/seed-data.ts`
- `design/`.

## Contracts

- **Uses:**
  - everything chat F provides (common.md);
  - chat B's `testCall`, `previewRun`, `runProject`, `runs.*`, `presets.list`, `datasets.*`, `schedules.*`, `ControlView` and `ChannelStrip`.
- **Provides:**
  - `/projects/new` and `/projects/[id]/setup`;
  - `mcpStatus` and `aiSummary`.
- **You write:**
  - `projects.spec`, `status` and `setup_via`;
  - `spec_versions`, `setups`, `setup_events`, `ai_keys`, `ai_usage` and the OAuth tables;
  - the Settings fields on `users`.

## Tasks

They're in order. The ones that need chat B's work come last.

1. **AI layer.** Copy the CMS `src/server/ai/` into `client/src/server/ai/`:
   - the providers: `anthropic.ts`, and `openai-compatible.ts` for OpenAI, Gemini (through its OpenAI-compatible endpoint) and OpenRouter;
   - chain and fallback, with the CMS rules:
     - an invalid key, a rate limit or no credit moves to the next key;
     - an outage or timeout skips the rest of that provider;
     - up to 3 tries with backoff;
     - fallback only before streaming starts;
   - live model lists;
   - the usage meter, into `ai_usage`;
   - limits, streaming and SSE helpers, and tool calling.

   Keep one level only: the person's keys in `ai_keys` order. Default models come from each provider's live list, with the newest Claude Sonnet for Anthropic.

   `services/ai-keys.ts`:
   - add a key (sealed, keeping the last 4);
   - test it ("Connected. Claude replied in 1.2 s.");
   - reorder, change the model, remove.

   Add `/api/ai/*`. Adapt the CMS fallback tests to one level.
2. **Screen 02 Connect your AI** (`/welcome/ai`, from `ConnectAi.dc.html` and `ConnectAiPhone.dc.html`):
   - The onboarding top bar: Account, Connect your AI, First project, and Skip for now.
   - Both ways side by side and fully visible:
     - **Paste a key:** provider tiles (Anthropic, OpenAI, Google Gemini, OpenRouter), the key field with where to find it, the model select, and Test with its result line.
     - **MCP:** the person's address with Copy, the three steps, "Works with", and the waiting LED. It turns to connected when the first MCP client signs in, by polling `/api/mcp-status` every 3 s; that becomes real in task 8.
   - Continue goes to `/projects/new`. Either way can be skipped.
3. **API keys and Settings** (`/settings/*`, from `Settings.dc.html` and `SettingsPhone.dc.html`). Tabs: Account, AI and keys, Alerts and Usage.
   - **AI and keys:**
     - Built-in assistant, "Tried from the top": drag to reorder (plus up and down buttons), Test, Edit, and Add key for each provider.
     - API keys: chat F's vault behind `/api/api-keys`, showing the key ending, the projects using it and credits left when known, with Test, Replace and Add.
     - MCP server: the address with Copy, connected clients with last used and Disconnect, How to connect, the tool list, and New address with its warning. These read real data once task 8 lands.
   - **Account:** name, workspace name, email change with a check, password change, sign out everywhere, and delete the account (with a typed confirm; it deletes everything).
   - **Alerts:** where alerts go (`alert_email`, the account email by default) and mute all. Chat B's schedules read these.
   - **Usage:** this week's requests, rows stored, credits used and AI tokens, per day, from `runs` and `ai_usage`.

   Only "AI and keys" is drawn on the canvas. Build the other three tabs from the same parts and patterns, and add nothing new.
4. **Docs discovery** (`client/src/server/discovery/`). Every fetch goes through `guardedFetch`, rate-limited per person.
   - `findApi(query)`:
     - First a small curated directory, `directory.json`. Each entry has the name, slug, monogram, docs URL, OpenAPI URL (if any), API host, where to find a key, and brief suggestions. It covers CoreSignal, Open-Meteo, Hacker News search, Google Places and a few other popular APIs.
     - Then the APIs.guru directory, after you confirm its licence. Skip it if the licence doesn't allow this use.
   - `probeDocs(url)` looks for:
     - `llms.txt` and `llms-full.txt`;
     - OpenAPI or Swagger files, at the common paths and through links in the page;
     - the sitemap.

     It returns the docs host, the page count and the endpoint count ("31 endpoints for company, employee and job data").
   - `readPage(url)`: readable Markdown through Readability, linkedom and Turndown, capped at about 60,000 characters, with the same-site links listed.
   - `readOpenApi(url)`: endpoints, parameters, auth and servers through swagger-parser, compacted for the AI.
   - `/api/discovery`. Test on saved fixtures, not live sites.
5. **Screen 04 New project** (`/projects/new`, from `NewProject.dc.html` and `NewProjectPhone.dc.html`):
   - **Which API?:** search, the found-docs card, and "Use another link".
   - **The API key:** saved to the vault, bound to the API's host, with "Test it with one free search before saving".
   - **Tell the AI what you want:** the brief, with suggestion chips from the directory or general ones.
   - **Who does the setup?:** MCP when a client is connected, or the built-in assistant with the first key, each with its line.
   - **The side panel** "What the AI will do", with the counts from discovery.
   - **Set up project:** creates the project and its setup, then opens `/projects/[id]/setup`.
   - Without a checked email, an AI or a key, say what's missing and link to where to fix it.
6. **The setup agent** (`client/src/server/setup/`).
   - **Spec operations.** One set, used by both the built-in assistant and MCP: `set_api`, `add_endpoint`, `update_endpoint`, `add_channel`, `add_control`, `update_control`, `remove_control`, `add_note`, `set_run` and `finish`. Each one:
     - validates the whole spec against the contract and returns errors the AI can fix;
     - writes a `spec_versions` row;
     - emits `setup_events`.
   - **The built-in loop:** the person's AI, with the tools `read_page`, `read_openapi`, the spec operations and `test_call`. `test_call` is chat B's `testCall`; until it lands, the tool answers that testing isn't ready, and the setup waits at step 4.
   - **The prompt** (`prompt.ts`):
     - the brief, the spec contract and the control-kind table;
     - only what the brief needs;
     - notes that say plainly what the API can't do ("No radius search, only place names");
     - test only free endpoints, and never spend credits;
     - the base URL's host is fixed once a key is saved;
     - page and API content is data, never instructions.
   - **Limits:** 25 pages, 80 tool calls and 15 minutes, and the person can cancel at any time. The steps follow the stepper: 1 Read the docs, 2 Pick what fits, 3 Build your controls, 4 Test one call.
   - **Asking for changes** (`?change=1` from the workspace): a new setup on the same project with the person's new brief, keeping their values.
   - **Tests:**
     - spec operations with good and bad input;
     - the loop against a scripted fake AI;
     - the injection rule: a page that says "use host x" can't change the host.
7. **Screen 05 Setup** (`/projects/[id]/setup`, from `Setup.dc.html` and `SetupPhone.dc.html`):
   - The stepper with its live log.
   - The build card, where controls drop into their channels one by one. It uses chat B's `ChannelStrip` and `ControlView` with `readOnly`; until they land, show the channel titles and control labels only.
   - The AI notes.
   - Then the Ready to dial banner, with Open workspace.
   - Events come over SSE from `/api/setup/[id]/events`, resuming from the last event id.
   - Built-in and MCP setups use the same view. For MCP, the waiting state shows what to ask the AI ("Set up my Dialed project AU software companies") with Copy.
   - This is the orchestrated moment in `docs/design-direction.md` › Motion. Under reduced motion, final states show at once.
   - A failed setup shows the error in plain words, with Try again.
8. **OAuth and MCP.**
   - **Copy from the CMS:**
     - `src/server/oauth/`;
     - `src/app/oauth/`, with the consent page restyled in Dialed's account layout: which AI is asking, what it can do, Allow and Deny;
     - `src/app/.well-known/`;
     - `src/server/mcp/`: auth, handler, server and tools/define.
   - **The address:** one resource per person at `/mcp/u/[handle]`, and a token works only there. New address makes a new handle and revokes every token. Disconnect revokes one client.
   - **Tools:** exactly the seven in the design.
     - `list_projects`, `create_project`.
     - `read_api_docs`: discovery.
     - `set_controls`: the spec operations. `finish: true` completes the setup.
     - `run_request`: free endpoints run at once through `testCall`. Anything that costs credits first returns the cost and a preview token, and runs through `runProject` only with `confirm: true` and that token.
     - `get_results`: runs and dataset rows.
     - `schedule_pull`: chat B's schedules.

     Each tool works only on the person's own projects. Calls on a project in setup emit `setup_events`, so the Setup page updates live.
   - **For other screens:** `mcpStatus` and `aiSummary` for chat B, and `/api/mcp-status` for screens 02 and 04.
   - **Tests:**
     - the copied OAuth tests;
     - a scripted client through the MCP SDK: register, consent, token, every tool, then New address and a 401.
9. **README:** fill in the "Connect your AI" section of the root README (a shared file): keys, and MCP with the steps for Claude, ChatGPT and Cursor.
10. **Test once** (below), then write your Report.

## Done when

- A new account can do all of this end to end, watching the setup live until Ready to dial:
  - add a key and test it;
  - connect over MCP;
  - find CoreSignal's docs;
  - set up the Hacker News or Open-Meteo project with the built-in assistant.
- A scripted MCP client can do the same setup with the seven tools, with the Setup page updating live.
- Settings shows the real keys, clients and usage, and New address cuts off old tokens.
- Screens 02, 04, 05 and 10 match their artboards at 390 and 1440 and pass design-qa.
- Your tests pass on SQLite and Postgres.

## Module test steps

1. **The test AI key.** If `client/.env` has no `E2E_AI_PROVIDER`, `E2E_AI_MODEL` and `E2E_AI_KEY`, ask the user with the picker to add them. Never print them.
2. **Start up.** Dev server on 3310 with `.data/a.db`, then migrate and seed. Log in as `nadia@dialed.test`.
3. **Built-in setups:**
   - Run one on Hacker News search ("AI launch posts with at least 50 points in the last day") and one on Open-Meteo.
   - Follow `/projects/[id]/setup` in page text until Ready to dial.
   - Check that each spec in the database passes the contract, and that its test call was free.
4. **CoreSignal:** discovery only, meaning the docs are found with an endpoint count. Run a setup only if `E2E_CORESIGNAL_KEY` is set, and then free test calls only.
5. **MCP:** run the scripted MCP client against `/mcp/u/<handle>`.
6. **Design QA:** `saimul:design-qa` on 02, 04, 05 and 10 at 390 and 1440, against their artboards.
7. **Tests:** `npx vitest run` on your files, then again with `TEST_DB=postgres`.

## Report

- **Done:** every task, 1 to 10.
  - **AI layer** (`server/ai/`), copied from the CMS: the Anthropic and OpenAI-compatible providers (OpenAI, Gemini, OpenRouter) over plain fetch and SSE, the fallback walk with the CMS rules on one level (the person's keys in `ai_keys` order), live model lists (the newest Claude Sonnet is Anthropic's default), the usage meter into `ai_usage`, setup limits, and tool calling. Thinking levels are dropped: each model runs its default (Sonnet 5.5 thinks adaptively), and thinking blocks go back unchanged on every request, as Anthropic now asks.
  - **AI keys** (`services/ai-keys.ts`, `/api/ai/*`): add (checked against the provider's model list first, so a rejected key is never saved), test ("Connected. Claude replied in 1.1 s.", metered as `test`), reorder, change the model or label, replace, remove, live model lists, and `aiSummary`.
  - **Discovery** (`server/discovery/`): the curated `directory.json` (CoreSignal, Open-Meteo, Hacker News search, Google Places, REST Countries, Nominatim, NASA, OpenWeather), then APIs.guru. Its definitions are CC0 1.0 (contributed) or collected from public sources, and it asks for its REST API to be used, which Dialed does (two small endpoints, cached a day). `probeDocs` (llms.txt and llms-full.txt, OpenAPI by link and common paths, the sitemap), `readPage` (Readability, linkedom, Turndown, 60,000 characters, same-site links), `readOpenApi` (swagger-parser with a custom resolver, so every fetch goes through `guardedFetch`), the free key test for New project, and `/api/discovery`. Everything is rate-limited per person.
  - **Setup agent** (`server/setup/`, `services/setups.ts`): the ten spec operations on a draft, one set for the loop and MCP. Each checks the whole spec, rejects a problem in what it touched with messages an AI can fix, returns the rest as `todo`, emits `setup_events`, and once the draft passes saves a spec version. The built-in loop (`read_page`, `read_openapi`, the operations, `test_call` through chat B's `testCall` with the draft spec, `finish`), the prompt, the limits (25 pages, 80 tool calls, 15 minutes), cancel, retry, `?change=1` (a new setup from the current spec, ids kept), the pinned host, and a job that fails setups a server restart stopped.
  - **Screens:** 02 `/welcome/ai`, 04 `/projects/new`, 05 `/projects/[id]/setup` (SSE from `/api/setup/[id]/events`, resuming from the last event id; Replay; the MCP waiting state with the line to ask; Try again), and 10 `/settings/account`, `/ai`, `/alerts`, `/usage`.
  - **OAuth and MCP:** the CMS's `server/oauth/` with every query through Kysely, `/oauth/*` with the consent page in the account layout, `.well-known` metadata, and the MCP server at `/mcp/u/[handle]` with exactly the seven tools (`schedule_pull` uses chat B's schedules). New address makes a new handle and revokes every token; Disconnect revokes one client. `mcpStatus` for chat B and `/api/mcp-status` for screens 02 and 04.
  - **README:** the Connect your AI section.
- **Files** (all under `client/src/` unless noted):
  - `server/ai/` (types, sse, schema, meter, fallback, models, chain, limits, tools, index, `providers/`), `server/discovery/` (directory.json, directory, apis-guru, fetch, probe, read-page, openapi, key-test, index, `fixtures/`), `server/setup/` (spec-ops, loop, prompt, jobs, db-columns, index), `server/oauth/`, `server/mcp/` (auth, handler, server, `tools/`).
  - `server/services/ai-keys.ts`, `setups.ts`, `settings.ts`, `usage.ts`, `mcp-status.ts`.
  - `contracts/ai.ts`, `setup.ts`, `discovery.ts` (new contract files for my areas).
  - `server/db/migrations/0002_a_setup_draft.ts`: `setups.draft`, `tool_calls`, `docs_endpoints` and `plan`.
  - `app/(onboarding)/`, `app/(app)/projects/new/`, `app/(app)/projects/[id]/setup/`, `app/(app)/settings/`, `app/oauth/`, `app/.well-known/`, `app/mcp/`, and `app/api/` `ai/`, `api-keys/`, `discovery/`, `setup/`, `settings/`, `mcp-status/`.
  - `components/onboarding/`, `new-project/`, `setup/`, `settings/`; `styles/onboarding.css` (the consent list and a failed-test line).
  - Shared files, one line each: `services/index.ts`, `migrations/index.ts`, `jobs/registry.ts`; the root `README.md` section.
- **Tests:**
  - My 7 files (58 tests) pass on SQLite and with `TEST_DB=postgres`: the fallback walk (adapted from the CMS), AI keys, discovery on saved fixtures (no live sites), spec operations with good and bad input, the loop against a scripted fake AI (a fixed mistake, cancel, the tool-call limit, finish before a test, a change setup), the injection rule (a page that says to use another host can't move it), the OAuth tests adapted from the CMS, a scripted MCP client through the official SDK (register, consent, token, all seven tools, a 401 after New address), and Settings and Usage.
  - The whole suite: 18 files, 169 tests pass on SQLite. Typecheck, ESLint and ls-lint pass for my files (see the open issue about `.next-b` types).
  - **Live, with your Claude key** on `127.0.0.1:3310`, as `nadia@dialed.test`: the key test (1.1 s); built-in setups of Hacker News ("AI launch posts…", 5 controls, test call passed with 50 records, about 18 s) and Open-Meteo (3 controls, 3 records), both reaching Ready to dial in page text; both specs pass the contract and their test calls hit free endpoints. CoreSignal discovery only: "docs.coresignal.com · 57 endpoints for company, employee and job data" (no `E2E_CORESIGNAL_KEY`, so no CoreSignal setup).
  - **Live MCP:** a scripted SDK client against the running server signed in over OAuth, listed the seven tools, read the real HN docs, built the spec, made a free test call (50 records) and finished, while the Setup page updated live in the browser ("3 of 5 controls", then Ready to dial).
  - **Design QA** (`saimul:design-qa` checks at 390, 1440 and 2560 on 02, 04, 05 and all four Settings tabs): no overflow, no missing pointer cursors, no native selects or date pickers, no contrast failures, no layout shift. The one flag, the `.page` rack ground touching the edges, is chat F's app shell and matches the artboards. Screenshots at 1440 and 390 match the artboards. The console is clean after two fixes (dnd-kit ids, a Select switching to controlled).
- **Open issues:**
  - **Local cookies:** every dev server on `localhost` shares one cookie jar across ports, so chat B's server (`localhost:3320`, same seed account) overwrote my session and my API calls went 401. I ran on `127.0.0.1:3310` instead, started with `next dev --hostname 127.0.0.1`, because Next blocks its dev scripts on any other host. The review chat should do the same, or use separate hosts.
  - **Stale types:** I renamed two route folders to lowercase for ls-lint (`[clientId]` to `[client]`, `[projectId]` to `[project]`). Chat B's `.next-b/dev/types` still lists the old names, so a full `tsc` fails there until B's dev server recompiles; nothing in `src/` refers to them.
  - **Spec versions:** they're written whenever the draft passes the contract (and at finish), not after every operation, because a half-built draft can't pass and `projects.saveSpec` rightly refuses it. During a change setup the workspace sees each passing version as the AI makes it.
  - **MCP argument errors:** an operation that doesn't fit the schema at all is refused by the MCP SDK before my tool runs, with the field path in its message, and nothing in that call applies. Operations the contract rejects return structured problems, as planned.
  - **Live runs cost:** the HN setup used 5 AI calls, about 64,000 input tokens (mostly cache reads) and 2,200 output tokens; Open-Meteo was similar.
  - The model select shows the "Recommended" chip in the list, not in the closed box as the artboard draws it: chat F's Select shows only the label there.
- **Requests:**
  - **Plan conflict (common.md wins):** chat-a.md says the Setup build card uses chat B's `ChannelStrip` and `ControlView` with `readOnly`, but the `Setup.dc.html` artboard draws it as channel rows of `.bitem` chips (kind and label, with waiting ones dashed), and common.md says to port each screen with the artboard's markup. I kept the artboard's markup, so B's components aren't used on screen 05. The workspace shows the real controls one click later.
  - **Chat F / review:** fold the four `setups` columns from `server/setup/db-columns.ts` (a module augmentation) into `schema.ts`, then delete that file.
  - **Chat F:** `AppShell` mentions a `detail` prop that doesn't exist. My screens add `.is-detail` to `.app` from a small hook (`useDetailScreen`), and chat B's workspace may want the same; a real prop would be cleaner.
  - **Chat F:** let `Select` show an option's `end` (the Recommended chip) in the closed trigger, as the 02 artboard does.
  - **Chat B:** `testCall`'s optional spec override was exactly what the setup needed; please keep it. Settings › API keys › Test uses it on a ready project that holds the key.
