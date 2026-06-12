# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Character & dice-pool manager for the **1000 WORDS** TTRPG. A plain-browser-JavaScript single-page app (no framework) bundled by Vite, deployed on Vercel, with optional Supabase auth/cloud saves and OpenAI-powered character creation via Vercel API routes. The extracted rulebook lives at `docs/rulebook-v5.02-extracted.txt`; when a question is about game rules, that file is the source of truth.

## Commands

- `npm run dev` — Vite dev server (client only; `api/` routes are **not** served — use `vercel dev` to test AI/cron routes locally)
- `npm test` — all tests via `node --test` (no test framework)
- `node --test test/pool.test.js` — run a single test file
- `npm run lint` — ESLint flat config over `js/`, `api/`, `test/`
- `npm run typecheck` — `tsc --noEmit` checking JSDoc types in `js/` (typedefs live in `js/types.js`; files opt in with `// @ts-check`)
- `npm run build` — static Vercel artifact

CI (`.github/workflows/ci.yml`, Node 24) runs lint, typecheck, test, build — all four must pass.

Schema changes: `supabase migration new <name>`, edit the file in `supabase/migrations/`, `supabase db push`, and keep `supabase/schema.sql` updated as the readable full-schema snapshot.

## Architecture

The core separation is **pure rules logic vs. UI**, enforced by what gets tested:

- **Pure, DOM-free rules modules** (each has a matching `test/*.test.js`): `js/pool.js` (PoolEngine — re-exports from `js/rules/`, where `engine.js` is the orchestrator and `tags/shared/equipment/exotic/shadow/xp.js` hold catalogs and subsystem helpers), `js/resolution-rules.js` (post-roll engine), `js/tag-model.js`, `js/spell-rules.js`, `js/npc-rules.js`, `js/ammo-rules.js`, `js/status-rules.js`, `js/rules-review.js`, `js/data.js`. New rules logic belongs here with tests, not in UI modules.
- **Persistence**: `js/data.js` — `DataManager` owns local/cloud character switching, legacy-save migration, JSON import/export, and tile normalization. Legacy saves carry loose shapes (e.g. `tags` as string or array); the normalizers in `data.js`/`pool.js` are the choke points that accept loose input and hand strict shapes onward — keep it that way.
- **UI modules** (`js/ui/`, one per dashboard concern): each exports `init(deps)` and usually a render function. `js/app.js` constructs `DataManager`, `PoolEngine`, `SpellBuilder`, and the optional Supabase client, then injects them as `deps` into every UI module — UI modules receive managers through `init`, they don't construct or import them directly.
- **Shared UI plumbing**: `js/els.js` is the centralized DOM cache (UI modules import element refs from here, never call `getElementById` directly); `js/state.js` is the shared mutable `uiState` singleton (selected call tile, burn tiles, resolution mode); `js/render.js` exposes `renderAll()` which delegates to each UI module.
- **Markup**: `index.html` is the entire UI shell including all modals (it's large; search by element id). `css/styles.css` only `@import`s the partials in `css/`.
- **Server side**: `api/ai/*` are Vercel functions for campaign AI documents/settings and the guided character-creation chat; `api/_lib/aiWorkflow.js` + `openaiWorkflow.js` hold prompt builders, structured-output schemas, OpenAI calls, and deterministic local fallbacks used when `OPENAI_API_KEY` is unset. `api/cron/` (backup, keepalive) requires a `CRON_SECRET` bearer token.
- **Supabase**: optional — without `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` the app is localStorage-only. Server routes use `SUPABASE_SECRET_KEY` (new-style `sb_secret_...`; legacy `SUPABASE_SERVICE_ROLE_KEY` read as fallback).

## Domain notes

- Tiles ("cards") have exactly two colors, tags drive mechanics (parsed by `js/tag-model.js`), and Call/Burn builds the dice pool; the GM-facing summary is `docs/gm-guide.md`.
- `docs/` holds the rules audit and active plan documents (`platform-update-plan.md`, `v5.02-rules-update-plan.md`, `ui-tabs-plan.md`) — check these before starting related work.
- Roll-log rows track which tiles were called for GM review; "test rolls" behave normally locally but must not write `roll_logs` rows.
