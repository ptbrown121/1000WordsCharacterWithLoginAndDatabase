# 1000 WORDS Card Manager

A zero-dependency, mobile-first web application designed to digitally manage characters, mosaic tiles (cards), and dice pool mechanics for the **1000 WORDS** tabletop roleplaying game system.

## Features

### 1. The Mosaic (Card Management)
- **Full CRUD Support:** Create, read, update, and delete your character's tiles.
- **Dual Colors:** Assign exactly two rule-accurate colors to each tile, powering the Call/Burn mechanics.
- **Tag Builder:** Easily construct and append predefined mechanical tags (e.g., *Keen*, *Chain*, *Hidden*) or write custom narrative tags directly onto your cards.
- **Instant Burn:** Quickly burn cards with a single tap for out-of-combat utility or narrative checks.

### 2. Intelligent Dice Pool Engine ("The Call")
- **Automated Stat Pooling:** Select the GM's Call colors, and the system automatically pulls your matching stat dice into the pool.
- **Automated Burns:** Select a main Call Tile and matching Burn Tiles to build your pool. The Engine automatically calculates your total dice and your "Keep Adds" based on the number of burned tiles.
- **Dual Rolling Modes:** 
  - **Virtual Mode**: Instantly RNG roll your entire pool and automatically calculate the mathematically optimal (highest) total.
  - **Manual Mode**: Enter the physical dice you rolled at the table, and the Engine will validate them and calculate your optimal total.
- **Haywire Detection:** Alerts you if more than half of your dice roll a 1.

### 3. Tag Parsing Engine
- **Flat Bonuses:** Automatically parses tags on your Call tiles (like *Expert* or *Ironclad*) and calculates their total Die Steps (▟) to grant flat bonuses to your final roll.
- **Chaining:** Supports recursive resolution for `Chain [Tile]` tags. The engine searches your Mosaic, validates the chained tile, and automatically pulls its dice and bonuses into the pool (with infinite loop protection!).

### 4. XP Tracking & Auto-Estimator
- **Global XP Tracker:** Tracks your total spent XP against your earned XP across your entire character sheet.
- **Cascade Estimator:** When building a tile, use the **Auto-Estimate** button. The engine uses a mathematical algorithm derived from the rulebook's cascade logic to calculate the absolute cheapest optimal XP path to build that dice pool, while adding standard XP modifiers for specific tags.

### 5. Rest & Resources
- **Current/Max Tracking:** Track the current and maximum values of Health (HP), Energy (EN), and Reflex (RX).
- **Shadow (SH):** The Shadow resource is completely dynamic. Qi / Id tile boxes add one chosen normal resource and one Shadow point; buried tiles stop contributing both.
- **Global Rest:** A one-click "Rest & Reset" button immediately restores all resources to their maximums and un-burns all tiles in your mosaic.

### 6. Local and Cloud Persistence
- **Local-first:** Signed-out users still auto-save their roster to browser `localStorage`.
- **Cloud saves:** Optional Supabase Auth + Postgres support lets signed-in users sync characters across devices.
- **Campaign rooms:** Players can join campaigns; GMs can view everyone’s campaign characters in read-only mode.
- **Roll tracking:** Non-test cloud rolls write one compact roll log row so GMs can review which tiles were called.
- **Test rolls:** Mark practice/testing rolls so they behave normally locally but do not write campaign roll logs.
- **Import/Export:** Export your character to a `.json` file to back them up or transfer them between devices.

## Getting Started

1. **Clone or Download** this repository.
2. Run `npm install`.
3. Run `npm run dev` and open the local URL.
4. Begin building your character's stats and adding tiles to your mosaic.

For a lighter table-operations overview, see the [GM Guide](docs/gm-guide.md).

### Supabase setup

Cloud saves are optional. Without environment variables, the app remains a browser-local character manager.

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. In Supabase Auth, enable email magic links and configure production SMTP before inviting real players. Optionally enable the Google provider (Auth → Providers, with a Google Cloud OAuth client whose redirect URI is `https://<project-ref>.supabase.co/auth/v1/callback`) for one-click sign-in without the email round-trip.
4. Sign in once with the account that should be allowed to create campaigns, then grant that account campaign-creator access in the Supabase SQL editor:

   ```sql
   insert into public.campaign_creators (user_id)
   select id from public.profiles
   where email = 'your-gm@example.com'
   on conflict (user_id) do nothing;
   ```

   Invite-code joiners default to regular player permissions and cannot create new campaigns unless you add them to `campaign_creators`.

5. Add these environment variables locally and in Vercel:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Deploy with Vercel using `npm run build`.

### Schema migrations (Supabase CLI)

As of June 2026, schema changes ship as versioned files in
`supabase/migrations/` instead of manual SQL-editor runs.
`supabase/schema.sql` stays as a readable snapshot of the full schema;
`supabase/migrations/20260612000000_baseline.sql` is that same snapshot
recorded as the migration baseline (every statement is idempotent, so
applying it to the existing database changes nothing).

One-time setup on a new machine:

```bash
supabase login
supabase link --project-ref <project-ref>   # ref is in the dashboard URL
supabase db push                            # applies any pending migrations
supabase migration list                     # local and remote should match
```

To change the schema: `supabase migration new <name>`, edit the generated
file in `supabase/migrations/`, then `supabase db push`. Update
`schema.sql` to match (or retire it once the migration history stands on
its own).

### Character creation AI setup

The AI character creation MVP runs through Vercel API routes so model and service-role keys stay server-side.

1. Re-run `supabase/schema.sql` after pulling this version. It adds private campaign AI tables, RLS policies, and a private `campaign-ai-documents` storage bucket.
2. Add these private environment variables in Vercel:
   - `OPENAI_API_KEY`
   - `SUPABASE_SECRET_KEY` — a new-style secret API key (`sb_secret_...`, Supabase Settings → API Keys). The legacy `SUPABASE_SERVICE_ROLE_KEY` is still read as a fallback but Supabase has deprecated it.
   - Optional: `OPENAI_ORCHESTRATOR_MODEL` (defaults to `gpt-5.5`)
   - Optional: `OPENAI_VALIDATOR_MODEL` (defaults to the orchestrator model)
   - Optional: `OPENAI_SCENE_MODEL` (defaults to `gpt-5.4-mini`)
   - Optional output budgets (shared between reasoning and the reply, so keep them generous): `OPENAI_SCENE_MAX_OUTPUT_TOKENS` (default 2500), `OPENAI_ORCHESTRATOR_MAX_OUTPUT_TOKENS` (default 6000), `OPENAI_VALIDATOR_MAX_OUTPUT_TOKENS` (default 4000)
   - AI request limiting: each user gets 120 AI requests per hour by default. Set `AI_RATE_LIMIT_REQUESTS` to a different per-user count, or to `0` to disable limiting; `AI_RATE_LIMIT_WINDOW_SECONDS` defaults to `3600`. A chat turn, edited-message regeneration, scene finalization, or pool-assistant command consumes one request. Limiting uses `SUPABASE_SECRET_KEY` (the server consumes the window so users can't reset it); without that key AI routes return 503 unless limiting is disabled.
3. Keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as the browser-visible Supabase values. If you prefer separate server names, the API routes also read `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
4. GM users can use the campaign panel to save short text/Markdown setting notes and AI guidance. The MVP intentionally supports pasted text plus `.txt`/`.md` files; PDF/DOCX extraction is a later upgrade.
5. Players start the guided AI chat from a cloud character assigned to a campaign. Finalized summaries are saved in Supabase first, then accepted summaries are appended to the character journal. Players can also cancel an unfinished scene or edit a previous response; editing rewinds later AI replies and supersedes any pending summary for that scene.

Without `OPENAI_API_KEY`, the Vercel routes return deterministic local fallback responses. That keeps local UI/database testing possible, but production play should use a real OpenAI key. When a key is configured, model failures (outages, rate limits, truncated output) return an error to the player instead of silently substituting fallback content; nothing is persisted for failed chat turns, and failed runs are recorded in `ai_agent_run_logs` with `status = 'failed'` and an error message. For local AI route testing, run the app through `vercel dev`; plain `npm run dev` serves the Vite client only.

### AI voice pool assistant

The Call panel includes an optional voice/text assistant that extracts the two
colors explicitly supplied by the GM, then suggests one matching Call tile and
explicitly requested Burn tiles. The GM can say color names (for example,
`Blue and Purple`) or stat names (`MIND and SPEED`); two already-selected Call
colors are used as a fallback. The assistant never infers colors from the
action. Canonical color names are recommended for fast or noisy speech.
Suggestions
are mechanically validated and shown in a preview; the player must confirm
before the transient pool changes, and the GM still has final say on colors.
When enabled, a fixed **Dictate Call** button remains available while the user
scrolls; the typed fallback stays in the Call panel.

The assistant is off by default. Configure these private Vercel variables:

- `AI_POOL_ASSISTANT_ENABLED=true` — the single server-side rollout/kill flag.
- `OPENAI_POOL_ASSISTANT_MODEL` — defaults to `gpt-5.6-luna`, the selector that
  passed the final tile-focused confirmation evaluation at 98/100. This is a moving alias,
  so rerun the repository eval before a production rollout.
- `OPENAI_POOL_TRANSCRIPTION_MODEL` — defaults to
  `gpt-4o-mini-transcribe`.
- Optional `OPENAI_POOL_ASSISTANT_REASONING_EFFORT` override. Without one, the
  selector uses `minimal` for GPT-5, `none` for GPT-5.4/5.6, and no reasoning
  parameter for GPT-4o. `OPENAI_POOL_ASSISTANT_MAX_OUTPUT_TOKENS` defaults to
  `1200`.

The existing `OPENAI_API_KEY`, Supabase browser/server variables, and the
`AI_RATE_LIMIT_REQUESTS` limit (120/hour per user by default) protect the
route. Users must be signed in, but the
active sheet can be local or cloud-backed because only the compact current
stats/tile catalog is sent. Audio is capped at 15 seconds in the browser and
2 MB on the server, is transcribed in memory, and is never stored or logged.

Run the cost-bearing accuracy suite only on demand:

```bash
npm run eval:pool-assistant
npm run eval:pool-assistant -- --model=gpt-5.4-nano-2026-03-17
npm run eval:pool-assistant -- --model=gpt-5.6-luna
npm run eval:pool-assistant -- --model=gpt-5.6-terra
npm run eval:pool-assistant:audio
```

The text suite contains exactly 100 commands with explicit GM colors and
accepted-gold tile selections. It exits successfully only when at least 90 are
exact, every output is mechanically valid, and no case gains an unrequested
Burn. It reports component accuracy, latency, token usage, estimated
selector cost, and failures. The sixteen synthetic WAV fixtures are a
report-only transcription smoke set, including four that require spoken
color/stat extraction; manually test consenting real speakers
and table noise before broad rollout. Neither command runs in normal CI.

The current Luna baseline passes 98/100 text cases and the combined synthetic
audio smoke set at 16/16 exact selections with 4/4 spoken-color extractions.

See [the AI pool assistant rollout guide](docs/ai-pool-assistant.md) for the
model gate, starting cost estimates, and preview-to-production checklist.

### Scheduled backups and keep-alive

Two Vercel cron jobs (configured in `vercel.json`, the Hobby plan's limit of two) protect the campaign data:

- `/api/cron/keepalive` (daily) runs one trivial query so the Supabase free tier never pauses the project for inactivity between sessions.
- `/api/cron/backup` (weekly, Mondays) dumps every application table to a gzipped JSON file in the private `backups` storage bucket and keeps the most recent 8. Uploaded campaign files aren't duplicated — storage itself is their backup; their metadata rows are included.

Setup: apply the `backups` bucket migration (`supabase db push`), then add two more private Vercel env vars:

- `SUPABASE_SECRET_KEY` (shared with the AI routes, see above)
- `CRON_SECRET` — any long random string; Vercel automatically sends it as a bearer token to cron invocations, and the routes reject calls without it.

To restore: download the newest `backup-*.json.gz` from the `backups` bucket (Supabase dashboard → Storage), `gunzip` it, and re-insert the needed rows — each table is stored as an array of row objects under `tables.<name>`. To test the backup by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/cron/backup`.

### Roll tracking and free-tier usage

Each normal cloud roll creates one `roll_logs` row and appears in the GM campaign panel’s recent roll history. Test rolls still behave like normal rolls locally, including resource spending and burns, but create no database row. Around 200 normal rolls in a session means around 200 insert requests and a small amount of JSON storage. Supabase currently lists unlimited API requests on the Free plan, so this should not be a request-count problem; the practical limits to watch are database size and egress. Because each log stores only character/roll metadata and called tile IDs/names, normal table play should stay well below the 500 MB Free database limit for a long time.

## Technical Architecture

The codebase is plain browser JavaScript bundled by Vite so Supabase can be imported safely and Vercel can inject public environment variables.

### Module layout

- `index.html` - UI shell (header, mosaic, action dashboard, journal) and all modal markup (tile, spell wizard, vital, info).
- `css/styles.css` - thin aggregator that `@import`s eight partials in `css/`: `_variables`, `_base`, `_layout`, `_cards`, `_dashboard`, `_modal`, `_journal`, `_responsive`.
- `js/app.js` - bootstrap. Constructs `DataManager`, `PoolEngine`, `SpellBuilder`, optional Supabase client, then calls `init({ deps })` on each UI module.
- `js/data.js` - persistence model. `DataManager` owns local/cloud character switching, legacy-save migration, JSON import/export, and `tile.tags` normalization. Also exports `STAT_COLORS`, `COLOR_HEX`, `VALID_DICE`, and the `getEffectiveMax(state, key, baseOverride)` vital helper.
- `js/supabaseClient.js` / `js/supabaseStore.js` - optional Supabase Auth, campaign, and cloud character storage integration.
- `api/ai/` - Vercel API routes for campaign AI documents, settings, guided player chat, scene finalization, and accepted-summary journal writes.
- `api/_lib/aiWorkflow.js` / `api/_lib/openaiWorkflow.js` - server-side prompt/context builders, structured-output schemas, OpenAI Responses calls, and local fallbacks for development.
- `js/pool.js` - the rules brain. Pure, DOM-free. `PoolEngine` for tag limits, XP cascade math, resource maxes, recursive Chain resolution, virtual rolls, and optimal-keep selection. Also exports shared helpers (`escapeHtml`, `parseDiceInput`, `tileTagList`, `formatTagLimitStatus`, `tagLimitErrorMessage`).
- `js/resolution-rules.js` - pure post-roll engine. Mode tables, default die assignments, plus-budget accounting, healing-target rules, bonus routing.
- `js/spellBuilder.js` - the 5-step spell wizard. Owns its own DOM lookups today; consumes `PoolEngine` and `formatTagLimitStatus`.
- `js/render.js` - top-level `renderAll()` that delegates to each UI module's render function.
- `js/state.js` - shared mutable `uiState` singleton (call tile, burn tiles, current resolution mode, etc.).
- `js/els.js` - centralized DOM cache. All UI modules import from here rather than calling `getElementById` directly.
- `js/ui/` - one module per dashboard concern: `cards.js` (mosaic render + select/burn), `pool.js` (dice pool preview + roll), `resolution.js` (post-roll resolution screen), `modals.js` (tile add/edit modal), `journal.js`, `roster.js` (character switcher + import/export), `stats.js` (stat dice + XP tracker), `vitals.js` (HP/EN/RX/SH inputs + Rest + Auto-Calc), `aiCreation.js` (campaign AI notes and guided character creation chat).

### Tests, lint, and CI scripts

- `npm test` - runs all `test/**/*.test.js` files via `node --test`. Pure-logic modules (`pool.js`, `resolution-rules.js`, `data.js`) are covered.
- `npm run lint` - runs ESLint with a flat config (`eslint.config.js`). `import/no-cycle`, `no-alert`, and `no-unused-vars` are warnings today; tightening them is a follow-up.
- `npm run dev` - serves the workspace via Vite.
- `npm run build` - builds the static Vercel artifact.
