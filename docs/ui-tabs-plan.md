# UI Tabs Plan

Goal: the sheet has grown into seven stacked zones (cloud/campaign panel, header
vitals, stats + six collapsible subsystem panels, dice dashboard, mosaic, AI
creation, journal) on one long scroll. Reorganize into tabs so each activity
gets a focused screen, without changing any behavior, ids, storage format, or
rules code.

Conventions follow `docs/platform-update-plan.md`: small PRs in order, each
leaves `npm test` / `npm run typecheck` / eslint / `npm run build` green.

## Design

### The one hard constraint

Rolling is a two-surface workflow: call colors and roll buttons live in
`#action-dashboard`, but the tile being called (and burns) are selected by
clicking cards in `#mosaic-section` (`uiState.callTile`, `uiState.burnTiles`
in `js/ui/cards.js`). **The Call and the Mosaic must share a tab.**

### Tab structure (4 tabs)

| Tab | Contents | Why |
|---|---|---|
| **Play** (default) | `#action-dashboard`, `#mosaic-section`, Condition panel, Shadow/Core/Stranger/Titan tracker panels | Everything touched during a session: call, roll, burn, crits/Press, current Shadow/Core/Titan, Stranger form |
| **Character** | `#stats-section` core: stats grid, rules-review strip, GM-reviewed toggle, Auto-Calculate XP / Vitals | Build-time concerns; changes mid-session are rare |
| **Story** | `#journal-section`, `#ai-creation-section` | The AI creation thread finalizes scenes into journal entries — same activity |
| **Campaign** | campaign management (upload/create/join, members, roll log, files, AI docs/settings), NPCs (GM) panel | Table-level rather than character-level |

Always visible above the tabs:
- the `<header>` (roster select, name, Rest/New/Del/Export/Import/Info, HP/EN/RX/SH
  pools, armor, XP, SP) — vitals are needed on every tab;
- a slimmed cloud strip: mode label, status text, sign-in (Google / magic link)
  / sign-out, read-only banner. The rest of today's `#cloud-panel` moves to the
  Campaign tab.

Placement judgment calls (cheap to change later — each is a markup move):
- Subsystem trackers went to **Play** because they hold play state (current
  Core/Titan, Aberration, current form), not just configuration.
- NPCs went to **Campaign** because they are table-level and follow the GM's
  campaign. Confirmed by the user 2026-06-13: the GM will rarely have a
  character active, and in the rare case they roll for a player they can swap
  tabs.
- The roll log stays on Campaign for now; surfacing recent rolls on Play is a
  possible follow-up.

### Mechanics

- All sections stay in the DOM permanently; tabs only toggle `hidden` on four
  wrapper `<div role="tabpanel">` elements. Nothing re-renders on tab switch,
  `js/els.js` keeps resolving every id at startup, and every existing
  `els.X.hidden = ...` toggle (cloud.js, aiCreation.js, panel show/hide) keeps
  working because those elements merely get new ancestors.
- `renderAll()` continues to render hidden panels — it is cheap and avoids any
  staleness logic.
- New `js/ui/tabs.js` (~80 lines): click + Left/Right arrow key handling,
  `aria-selected`/`tabindex` management, persists the active tab per device in
  `localStorage` (UI preference, **not** character state — never enters the
  save payload or cloud sync), restores on load, supports `#tab-play` style
  hashes for deep links.
- Known interactions checked in advance: the only `scrollIntoView` (roll
  results, `js/ui/resolution.js:841`) stays within Play; modals are
  document-level overlays and unaffected; live sync updates hidden panels
  harmlessly.

## PR 1 — Tab shell and section moves

- `index.html`: add `<nav class="app-tabs" role="tablist">` with four buttons
  after `</header>`; wrap sections into four tabpanel divs, moving existing
  markup verbatim (ids untouched). Move the Condition + Shadow/Core/Stranger/
  Titan panels out of `#stats-section` into the Play panel, and the NPC panel
  into the Campaign panel.
- New `js/ui/tabs.js`, registered in `js/app.js`; new `css/_tabs.css`.
- Verification: full manual smoke pass (roll a pool with a call tile + burn,
  edit a tile, add journal entry, sign in, switch characters), plus the usual
  test/lint/typecheck/build gates. Tab state survives reload; URL hash opens
  the right tab.

**Status: done 2026-06-13.** As planned. Notes:
- Trackers are wrapped in `#trackers-section` (glass panel) at the top of Play,
  ordered Condition first, then Shadow/Core/Stranger/Titan; the NPC panel is
  wrapped in `#gm-section` on Campaign.
- Deep links are read-only: tabs.js never writes `location.hash`, so Supabase
  auth callback fragments (`#access_token=...`) are never clobbered. The tab
  nav sits outside `header`/`main`, so read-only mode never disables it.
- Deliberate side effect: journal and AI-creation markup now live inside
  `main`, so `applyReadOnlyMode` disables their controls on read-only sheets.
  Previously the buttons were clickable and the save was silently refused by
  the `data.js` guards; the disable is the correct UX and `aiCreation.js` had
  its own `isMine && !readOnly` gate anyway.
- The obsolete `margin: 2rem 1rem` on `.ai-creation-section` / inline on
  `#journal-section` (which existed because both sat outside `main`) was
  removed; the tab panel's flex gap provides spacing now.
- Gates: 331/331 tests, eslint 0 errors (61 accepted warnings), typecheck 0,
  Vite build clean. Manual browser smoke pass is still pending (user).

### Interim change (user request, 2026-06-13): collapsible cloud panel

The cloud panel was felt to be intrusive. Its status row (`cloud-mode-label`,
`cloud-status-text`) now carries a Hide/Show toggle (`#btn-cloud-toggle`,
same pattern as the tracker panels); the auth form, cloud actions, and
campaign panel are wrapped in `#cloud-panel-body`, which the toggle collapses.
The readonly banner stays outside the collapse — it is a safety signal.
Collapsed state persists per device (`1000words_cloud_panel_collapsed`).
This also stages PR 2: `#cloud-panel-body` minus the auth form is exactly the
content that moves to the Campaign tab.

## PR 2 — Campaign tab consolidation

- Split `#cloud-panel`: keep a slim always-visible strip (`cloud-mode-label`,
  `cloud-status-text`, auth form, readonly banner); move `#cloud-actions`,
  `#campaign-panel` (members, roll log, files panel, AI docs panel) into the
  Campaign tabpanel.
- `js/ui/cloud.js` already toggles each piece by id, so this is mostly a markup
  move; adjust any container-level styling in `css/_cloud.css`.
- Empty-state copy on the Campaign tab when signed out ("Sign in above to use
  campaigns").

**Status: done 2026-06-13.** As planned. Notes:
- `#cloud-actions` + `#campaign-panel` moved into `#campaign-section` (glass
  panel, first child of the Campaign tabpanel, above `#gm-section`). The top
  strip keeps the status row, the Hide/Show collapse (now covering just the
  auth form), and the readonly banner; its aria-label updated to "Cloud save
  and sign-in".
- `#campaign-signed-out-note` shows on the Campaign tab when signed out,
  toggled in `renderCloudControls`.
- `applyReadOnlyMode` now skips nodes inside `#campaign-section` (like the
  existing `#npc-panel` exclusion): campaign management is campaign-level and
  this markup was never disabled when it lived outside `<main>`. This keeps
  GM file/AI-note uploads working while viewing a player's read-only sheet.
- The `.cloud-panel input/select/::placeholder` styling rules were extended to
  `#campaign-section` so the moved controls keep their appearance.
- Gates: 331/331 tests, eslint 0 errors (61 accepted warnings), typecheck 0,
  build clean.

## PR 3 — Polish

- Tab badges: rules-review issue count on Character; a dot on Story when an AI
  creation thread is open. Driven from the existing render fns, no new state.
- Mobile: convert the tab nav to a fixed bottom bar under a `max-width` media
  query (`css/_responsive.css`).
- Extract the inline `style="..."` attributes from the markup that PRs 1–2
  touched into the CSS partials (index.html currently has 332 inline styles;
  this PR only cleans the moved sections, not the whole file).

**Status: done 2026-06-13. All three PRs of this plan are complete.** Notes:
- Badges: `#tab-character-badge` shows the rules-review item count, hidden
  when the GM-reviewed override is on (same quieting as the strip);
  `#tab-story-badge` is a dot shown while an AI creation thread is open.
  Both are toggled inside `renderRulesReview` / `renderAiCreation`,
  including their early-return paths.
- Bottom bar: at `max-width: 700px` (the existing mobile breakpoint) the nav
  becomes `position: fixed` at the bottom, z-index 90 (under modals at 100+
  and notifications at 1000), with `env(safe-area-inset-bottom)` padding and
  `body { padding-bottom: 4.5rem }` so content scrolls clear of it.
- Inline styles inside `<main>` went 74 → 33. Extracted: the NPC form
  (id-scoped rules in `_dashboard.css`, deliberately outranking
  `.shadow-panel-body label/input`), `.panel-note`/`.panel-select` for the
  tracker panels, `.section-header` adoption for stats/journal plus
  `.section-header-stack`/`.section-header-actions`/`.btn-slim`, and
  `.empty-note` (also de-duplicated from journal.js's innerHTML). What
  remains inline is JS-toggled `display:none`, layout-only `grid-column`
  spans, dashboard internals, and one-offs — left to keep computed styles
  byte-identical.
- Gates: 331/331 tests, eslint 0 errors (61 accepted warnings), typecheck 0,
  build clean, no duplicate ids.

## Out of scope (noted during this pass, not part of the tabs work)

- `js/ui/modals.js` (1,115 lines) and `js/spellBuilder.js` (1,091 lines) are
  the two remaining oversized modules; same split treatment as pool.js (PR 9)
  would apply if they grow further.
- A full inline-style purge of index.html beyond the sections tabs touch.
