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
- **Import/Export:** Export your character to a `.json` file to back them up or transfer them between devices.

## Getting Started

1. **Clone or Download** this repository.
2. Run `npm install`.
3. Run `npm run dev` and open the local URL.
4. Begin building your character's stats and adding tiles to your mosaic.

### Supabase setup

Cloud saves are optional. Without environment variables, the app remains a browser-local character manager.

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. In Supabase Auth, enable email magic links and configure production SMTP before inviting real players.
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

## Technical Architecture

The codebase is plain browser JavaScript bundled by Vite so Supabase can be imported safely and Vercel can inject public environment variables.

### Module layout

- `index.html` - UI shell (header, mosaic, action dashboard, journal) and all modal markup (tile, spell wizard, vital, info).
- `css/styles.css` - thin aggregator that `@import`s eight partials in `css/`: `_variables`, `_base`, `_layout`, `_cards`, `_dashboard`, `_modal`, `_journal`, `_responsive`.
- `js/app.js` - bootstrap. Constructs `DataManager`, `PoolEngine`, `SpellBuilder`, optional Supabase client, then calls `init({ deps })` on each UI module.
- `js/data.js` - persistence model. `DataManager` owns local/cloud character switching, legacy-save migration, JSON import/export, and `tile.tags` normalization. Also exports `STAT_COLORS`, `COLOR_HEX`, `VALID_DICE`, and the `getEffectiveMax(state, key, baseOverride)` vital helper.
- `js/supabaseClient.js` / `js/supabaseStore.js` - optional Supabase Auth, campaign, and cloud character storage integration.
- `js/pool.js` - the rules brain. Pure, DOM-free. `PoolEngine` for tag limits, XP cascade math, resource maxes, recursive Chain resolution, virtual rolls, and optimal-keep selection. Also exports shared helpers (`escapeHtml`, `parseDiceInput`, `tileTagList`, `formatTagLimitStatus`, `tagLimitErrorMessage`).
- `js/resolution-rules.js` - pure post-roll engine. Mode tables, default die assignments, plus-budget accounting, healing-target rules, bonus routing.
- `js/spellBuilder.js` - the 5-step spell wizard. Owns its own DOM lookups today; consumes `PoolEngine` and `formatTagLimitStatus`.
- `js/render.js` - top-level `renderAll()` that delegates to each UI module's render function.
- `js/state.js` - shared mutable `uiState` singleton (call tile, burn tiles, current resolution mode, etc.).
- `js/els.js` - centralized DOM cache. All UI modules import from here rather than calling `getElementById` directly.
- `js/ui/` - one module per dashboard concern: `cards.js` (mosaic render + select/burn), `pool.js` (dice pool preview + roll), `resolution.js` (post-roll resolution screen), `modals.js` (tile add/edit modal), `journal.js`, `roster.js` (character switcher + import/export), `stats.js` (stat dice + XP tracker), `vitals.js` (HP/EN/RX/SH inputs + Rest + Auto-Calc).

### Tests, lint, and CI scripts

- `npm test` - runs all `test/**/*.test.js` files via `node --test`. Pure-logic modules (`pool.js`, `resolution-rules.js`, `data.js`) are covered.
- `npm run lint` - runs ESLint with a flat config (`eslint.config.js`). `import/no-cycle`, `no-alert`, and `no-unused-vars` are warnings today; tightening them is a follow-up.
- `npm run dev` - serves the workspace via Vite.
- `npm run build` - builds the static Vercel artifact.
