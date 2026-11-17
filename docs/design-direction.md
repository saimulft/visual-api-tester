# Dialed: design direction

One direction, agreed on 17 Nov 2026: own brand on the DL system, working name **Dialed**, AI by key or MCP, full app flow on the Claude Design canvas.

- Canvas: https://claude.ai/artifact/CdcKNL1PzJhzEXp8cieeZ7 (private until shared)
- Canvas source: `design/canvas/project/` (one `.dc.html` per artboard, shared `dialed.css`)
- References: `docs/design-references.md`

## Brief

| | |
| --- | --- |
| Product | Dialed, an open-source web app that lets non-technical people test and use any API. Their own AI (a pasted AI key, or their Claude/ChatGPT connected over MCP) reads the API docs and builds visual controls. They dial the controls in, run, store, download and schedule. |
| Audience | Marketers, researchers, analysts, ops people and founders, 25 to 55. They set up on desktop and check results and schedules on phone. |
| The app's one job | Get data out of an API without writing code. |
| Actions | Primary: **Run**. Secondary: save a preset, download, schedule a pull. |
| First API | CoreSignal Company API v2. Filter search is free and returns IDs; a full record costs 20 credits; the key goes in an `apikey` header; there's no radius search, only place names. |

## Direction: Control surface

**Idea:** every API becomes a mixing desk. Numbered channels hold faders, switches and dropdowns under silkscreen labels, LEDs show what's live, and the data sits on a stage beside them.

**Base system:** the DL system for SaaS, adapted to an app. Onest headings, a Plus Jakarta Sans body, one saturated hue with an ink tinted to match, and white surfaces on a neutral rack.

**Signature moves**

1. **Channel strips.** Numbered channels (CH 01, CH 02 and so on) come from a CSS counter. Each control has a mono silkscreen label and the raw parameter name under it, so nothing is hidden from people who want to learn.
2. **Tick-scale faders.** Dual-handle faders sit over printed tick scales, with a log scale for headcounts and mono readouts. The match count and credit cost update as you drag.
3. **LED dots with a halo** for live, connected, paused and failed states.
4. **The Run module.** It's a cut-corner dark module with a corner glow and a hairline rim, one per screen.
5. **A folder-tab results stage** with Table, JSON and Request tabs. HTTP details live in the Request tab instead of up front.

There's also a narrative mini-UI: a doc line becomes a fader, then data, then "Ready". It runs in the sign-up box and in the AI setup scene.

**AI provenance:** violet marks everything the AI made or set, and teal marks what you changed. That's the second accent's single job.

## Colour

| Token | Hex | Role |
| --- | --- | --- |
| `--paper` | #FFFFFF | Surfaces, cards, inputs |
| `--rack` | #F4F6F5 | App ground behind cards and the control rack (neutral, not a tint) |
| `--line` / `--line-2` | #E1E6E4 / #CDD6D3 | Hairlines / input borders |
| `--ink` | #0B1F1C | Text, and the dark boxes (auth box, Run module, Ready banner) |
| `--muted` | #55625F | Secondary text |
| `--signal` | #0C8577 | Brand: primary buttons, faders, on states, LEDs |
| `--signal-deep` | #096B60 | Hover fill, text on the signal tint |
| `--signal-tint` | #E2F2EE | Selected chips, channel numbers |
| `--ai` / `--ai-tint` | #5B45D6 / #EEEBFC | AI provenance only |

Status colours are functional, not brand: warn #9A5B00 on #FFF3DC, error #B42318 on #FDECEA.

**Contrast pairs (WCAG 2.2 AA)**
- Ink on paper is 16.9:1.
- Muted on paper is 6.4:1, and on the rack 5.9:1.
- White on signal is 4.5:1 (button labels at 15px semibold and up).
- White on signal-deep is 6.4:1.
- Signal-deep on signal-tint is 5.5:1.
- AI #4532B5 on the AI tint is 7.5:1.
- The switch's off track (#84918D) against paper is 3.3:1.
- All text on dark is white.

## Type

- **Onest** (OFL) for headings, 600 weight, tracking -0.02 to -0.035em.
- **Plus Jakarta Sans** (OFL) for body and UI text.
- **Geist Mono** (OFL) for silkscreen labels, parameter names, readouts and code.
- All three come from Google Fonts on the canvas and will be self-hosted with next/font in the build.

| Style | Size |
| --- | --- |
| Auth box headline | 44 |
| Auth title | 36 |
| Page title | 30 (26 on phone) |
| Section | 18 |
| Channel title | 15 |
| Body | 15 (16 on phone) |
| Small | 13 to 13.5 |
| Micro label | 12 mono, uppercase, 0.14em |
| Readouts | 14 mono, tabular |
| KPI | 28 |

Headings, buttons and nav are in sentence case. Numbers use tabular figures. There are no em or en dashes in the UI copy.

## Shape and depth

- **Radii:**
  - 6 for tags and tick labels
  - 10 to 12 for chips and inputs
  - 14 for buttons (the DL icon-tile button)
  - 18 for channels
  - 20 for project cards
  - 24 for panels
  - 28 for the auth box
- **Cut corner:** a 20px chamfer on the Run module only.
- **Borders:** 1px hairlines in `--line`, with inputs in `--line-2`.
- **Shadows:** three ink-tinted levels: rest, raised (card hover) and pop (menus, calendar).

## Motion

- **Curves:** ease-out `cubic-bezier(.22,1,.36,1)` for arrivals, and sine `cubic-bezier(.37,0,.63,1)` for loops and LED pulses.
- **Durations:** 200ms for colour, 320ms for hovers and menus, 450ms for panels, 700ms for reveals.
- **The orchestrated moment:** AI setup. The steps tick, controls drop into their channels one by one, the test call passes, and it ends on a **Ready to dial** banner. The sign-up box plays a short version once.
- **Micro motion:**
  - The fader knob grows a halo on hover and scales on press.
  - Readouts and the match count update live.
  - Result rows cascade in after a run.
  - Cards lift 3px.
  - Switches slide over 320ms.
  - LEDs pulse three times, then rest.
- **Reduced motion:** final states show instantly.

## Screens, in order

| # | Screen | Job | Working piece and interaction |
| --- | --- | --- | --- |
| 01 | Sign up | Create an account with email and password | A split screen: a calm form on one side, and on the other a dark box with the narrative mini-UI (doc line, fader, data, Ready) that plays once |
| 02 | Connect your AI | Pick how the AI is powered | Two ways side by side, both fully visible: paste a key (provider picker, model, test) or connect your own AI over MCP (copy address, three steps, waiting LED) |
| 03 | Projects | See everything at a glance | A KPI strip; whole-card project links with a mini control strip, last run and schedule LED; recent runs with friendly errors (429 retried) |
| 04 | New project | Point the AI at an API | API search with the docs found, the API key with a test toggle, a plain-language instruction with suggestion chips, and who does the setup (built-in or MCP) |
| 05 | AI sets up the API | Show the AI's work, honestly | A stepper (read docs, pick endpoints, build controls, test call), controls arriving per channel, AI notes on what the API can't do, then Ready to dial. The canvas tweak switches between Animated, In progress and Done |
| 06 | Project workspace | Dial in and run | Endpoint list, the channel rack, the dark Run module and the results stage. The faders, switches, tabs and Run work, and the match count and credits update live |
| 07 | Parameters become controls | Show the mapping rules | Twelve tiles covering text, keywords, short list, long list, toggle, range, log range, dial, date, cost-aware amount, places, and map with radius, plus the control states |
| 08 | Saved data | Keep and take the data | A dataset table, a detail panel with new rows per run, a save mode (append, replace, keep each run), export (CSV, Excel, JSON) and a live CSV link for Sheets |
| 09 | Schedules | Pull data regularly | A schedule list with LEDs, an editor (cadence, days, time, timezone), the next three runs, a credit cap per run, alerts and run history |
| 10 | Settings | Manage the AI and keys | AI keys in order, the MCP server address, connected clients and exposed tools, and the API key vault |

Every screen has a 1440 artboard and a 390 phone artboard, except 07, which is a reference board. On phone, the rail becomes a bottom tab bar. The workspace splits into Controls and Results with the Run bar pinned, and the side panels stack.

## Imagery

- No photos. This is app UI.
- Projects use monogram tiles instead of third-party logos, so no brand marks are copied.
- The radius control uses an illustrated SVG map.

## Defaults this direction rejects

- A dark, neon, developer-tool look (Postman or Insomnia style).
- A request builder where you fill in raw JSON.
- HTTP methods and headers up front.
- Tailwind slate with indigo, gradient blobs, emoji icons.
- Native selects and date pickers.
- The generic SaaS card kit, cream with a serif, everything centred.
- Hiding what the AI did: every AI value is marked, and its notes say plainly what the API can't do.

## Dummy data to replace later

- **The user:** Nadia Rahman, Brightfield.
- **Companies:** fictional Australian ones (Kestrel Labs, Tidepool Analytics, Ironbark Systems and the rest) and their domains.
- **Credits:** 11,480 credits left, and every count and timing shown.
- **Projects:**
  - Open-Meteo store weather
  - Google Places cafés
  - CoreSignal jobs
  - Hacker News AI posts
- **The MCP address:** `mcp.dialed.app/u/nadia-r` and the MCP tool names.
- **AI models:** "Claude Sonnet 5.5", and the provider list.
- **The live CSV link** feature: a proposal, so keep it or drop it.
