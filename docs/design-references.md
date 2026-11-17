# Design references: Visual API Tester

Borrow moves, never copy a site. Rows marked (own) are the owner's apps, so reuse is free of licence questions. Rows marked (fetched) were checked on the live page or docs on 2026-11-17; rows marked (known) come from product knowledge and were not re-checked.

| Reference | Link | What we borrow | Used in |
|---|---|---|---|
| CRM app shell (own) | `/Users/saimulislam/Downloads/developerlook-crm/client/src/components/shell/app-sidebar.tsx`, `nav-config.ts`, `workspace-switcher.tsx`, `command-palette.tsx`, `layouts/AppLayout.tsx` | Sidebar driven by one nav config, a switcher at the top (maps to the project switcher), a Cmd-K palette, and a page header slot | Projects list, project workspace, all screens |
| CRM patterns kit (own) | `.../developerlook-crm/client/src/components/patterns/` (`empty-state.tsx`, `kpi-strip.tsx`, `filter-bar.tsx`, `filter-chips.tsx`, `segmented.tsx`, `bulk-action-bar.tsx`, `kbd.tsx`) | Empty state with icon, title, one action and a dashed frame; filter chips; a segmented Table/JSON/Map switch; a KPI strip for run stats | Projects list, results, saved data, schedules |
| CRM and CMS UI primitives (own) | `.../developerlook-crm/client/src/components/ui/` (`slider.tsx`, `multi-select.tsx`, `searchable-select.tsx`, `switch.tsx`, `date-picker.tsx`, `table.tsx`) | The exact control set we need already exists as shadcn-style parts: slider, switch, multi-select chips, date picker, table | Project workspace control panel |
| CRM and CMS AI key list (own) | `.../developerlook-crm/client/src/components/settings/ai-key-list.tsx`; `/Users/saimulislam/Downloads/dl-cms/cms/src/components/ai/key-list.tsx`, `provider-settings.tsx`, `model-picker.tsx` | Per-provider key rows with label, masked value, show/hide, reorder (first key tried first), model picker | Connect AI, settings |
| CRM AI-building scene (own) | `.../developerlook-crm/client/src/components/forms/FormAiBuildingScene.tsx` | A stepped progress scene with named phases ("Understanding your request", "Designing form fields") for the AI setup run | New project with AI setup progress |
| CRM assistant thread (own) | `.../developerlook-crm/client/src/components/assistant/` (`assistant-composer.tsx`, `assistant-conversation.tsx`) | Composer plus conversation for the built-in assistant, including tool-result blocks | Project workspace (assistant panel) |
| CMS auth shell (own) | `/Users/saimulislam/Downloads/dl-cms/cms/src/components/auth/auth-shell.tsx`, `sign-in-screen.tsx`, `sign-up-screen.tsx`, `code-step.tsx`; CRM `components/auth/auth-layout.tsx` | Split screen with a brand panel and a calm form; email code step; password input with reveal | Sign up and log in |
| CMS jobs and MCP server (own) | `.../dl-cms/cms/src/server/jobs/` (`registry.ts`, `index.ts`); `.../dl-cms/cms/src/server/mcp/` (`server.ts`, `auth.ts`, `tools/`) | Not visual, but a working pattern for a job registry per feature and an authenticated MCP server with tool files per area. Check before building our own | Schedules, Connect AI (MCP) |
| Internal system tables and shell (own) | `/Users/saimulislam/Downloads/internal-system/src/components/ui/table.jsx`, `bulk-action-bar.jsx`, `multi-select-filter.jsx`; `components/shell/AppShell.jsx`, `CommandPalette.jsx` | A second take on table plus bulk bar plus filter, with a library page layout (`research-sites-page.jsx`) | Saved data |
| Apify Console (fetched) | https://docs.apify.com/platform/actors/development/actor-definition/input-schema | A form generated from a JSON schema: `enum` plus `enumTitles` for dropdowns, `sectionCaption` for grouped fields, `prefill` and `default` for sample values, Markdown in descriptions. Our AI emits this same shape per endpoint | Project workspace control panel |
| Apify datasets (fetched) | https://docs.apify.com/platform/storage/dataset | A Table / JSON toggle on results and one Export dialog: format picker (CSV, JSON, Excel and more), field include/omit, a Preview before download | Results, saved data downloads |
| Apify schedules (fetched) | https://docs.apify.com/platform/schedules | Cron with a visual builder, timezone, a "Next runs" list (next five) to test the setting, new schedules start disabled, an email on failure | Schedules |
| Hoppscotch (fetched) | https://github.com/hoppscotch/hoppscotch | Request tabs (Parameters, Headers, Authorization, Body) next to a response pane with status, headers, body, and raw/preview. Keep the response layout, drop the HTTP jargon | Project workspace |
| Bruno (fetched) | https://github.com/usebruno/bruno | Collections as plain folders; a request is a readable file. We borrow the idea of "an endpoint is a saved, readable thing", plus offline-first trust | Endpoint list, saved runs |
| Leva and Tweakpane (fetched) | https://github.com/pmndrs/leva, https://github.com/cocopon/tweakpane | Compact parameter panel: label left, value right, drag-to-scrub sliders, collapsible folders, a live value readout | Project workspace control panel |
| Scalar (fetched) | https://github.com/scalar/scalar | API client with a built-in OpenAPI reference: pick an endpoint from the spec, the form is built for you, with code examples beside it | Endpoint list, workspace |
| Zapier / Make connect flow (known) | https://zapier.com | One calm "Connect account" step per service, a named connection you reuse later, a test before you continue. Apply to pasting an AI key and the target API key | Connect AI, new project |
| Linear, Vercel, Raycast shell (known) | https://linear.app, https://vercel.com, https://raycast.com | App shell quality: dense but quiet sidebar, keyboard-first, Cmd-K, very restrained colour, strong empty states | App shell, all screens |
| Clay and Airtable tables (known) | https://www.clay.com, https://airtable.com | Result grids with typed columns (links, tags, numbers), column show/hide, sticky header, row count in the footer | Results table, saved data |
| PostHog (favorites, App UI) | https://posthog.com (favorite_design_get id `cd87f23dfca5dd8ad989861e2`) | Plain-language, friendly tone and a tabbed demo of an AI chat on sample data, useful for an "ask the AI" empty state | Empty states, onboarding copy |
| Dashline (favorites, Minimal / Product Feature) | https://www.dashline.tech | Pale grey canvas split into white rounded panels on a faint grid, one electric-blue accent | Visual direction (light theme) |

## Open source we could build on

| Name | Link | Licence | Use |
|---|---|---|---|
| shadcn AutoForm | https://github.com/vantezzen/autoform | MIT | Zod schema to a form. Best fit if we generate a Zod or JSON schema per endpoint |
| react-jsonschema-form | https://github.com/rjsf-team/react-jsonschema-form | Apache-2.0 | JSON schema to form, has a shadcn theme and custom widgets (sliders, map) |
| Leva | https://github.com/pmndrs/leva | MIT | Floating parameter panel. Probably too "dev tool" in look, so borrow the feel only |
| Tweakpane | https://github.com/cocopon/tweakpane | MIT | Same as Leva, framework-free |
| Scalar | https://github.com/scalar/scalar | MIT | OpenAPI parser and API client pieces |
| swagger-parser | https://github.com/APIDevTools/swagger-parser | MIT | Validate and `$ref`-resolve Swagger 2 / OpenAPI 3 specs. Needs Node 22.19+ |
| pg-boss | https://github.com/timgit/pg-boss | MIT | Postgres job queue with cron and RRULE schedules. Needs Postgres 13+, Node 22.12+ |
| TanStack Table | https://github.com/TanStack/table | MIT | Headless table, matches our shadcn table |
| Glide Data Grid | https://github.com/glideapps/glide-data-grid | MIT | Canvas grid for very large result sets (millions of rows) |
| MapLibre GL JS | https://github.com/maplibre/maplibre-gl-js | BSD-3-Clause | Map for the location control and map results (radius circle drawn as a layer). Needs a tile source with its own terms |
| shadcn/ui Blocks, Blocks.so | https://ui.shadcn.com/blocks, https://github.com/ephraimduncan/blocks | MIT | Login, sidebar, form and table starting blocks. Both are in the research-sites list under Open Source / Use as Base |
| Number Flow | https://number-flow.barvian.me | MIT | Animated counters for run stats |
| Hoppscotch, Bruno | https://github.com/hoppscotch/hoppscotch, https://github.com/usebruno/bruno | MIT | Reference only. Both are full apps, not libraries |

## What was not reachable

- Mobbin sent the browser to its login page, and Refero showed no results without an account. Page Flows is paid. I did not sign in, so no screens from these three are in the table.
- Only the favorite designs for PostHog and Dashline fit this product. The rest of the App UI, Dark Mode, Minimal and Product Feature picks are social posts and marketing sites.
- Apify's input-schema page does not list sliders, toggles or a datepicker; if we want to copy its editor names, check the Apify field-type docs before committing.
