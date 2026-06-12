# Platform & Code Modernization Plan

Status: planned (no PRs started). Follows the same phased-PR convention as
`docs/v5.02-rules-update-plan.md`. The v5.02 rules work is complete; this
plan covers the infrastructure and code-architecture recommendations from
the June 2026 review.

Goals, in the user's priority order:

1. Google OAuth sign-in (first).
2. Operational hardening: schema migrations, backups, free-tier keep-alive.
3. Type-checking the rules engine without a TypeScript rewrite.
4. Safer cloud saves: optimistic concurrency, then realtime sync.
5. The big one: structured tags replacing string re-parsing, then the
   pool.js split.

Explicitly out of scope (decided in review): framework migration
(Next.js/React/Svelte), hosting move off Vercel/Supabase, converting files
to `.ts`, and removing Mailjet entirely (it stays as the magic-link
fallback SMTP).

Dependency notes: PR 2 (migrations) should land before any PR that changes
schema (PRs 3, 5, 6) so those changes ride the migration system. PR 4
(typedefs) should land before the tag refactor (PRs 7-8) so the new shapes
are checked from day one. PRs 7 → 8 → 9 are strictly ordered.

---

## PR 1 — Google OAuth sign-in (keep magic links as fallback)

**Status: done 2026-06-12.** Dashboard setup (Google Cloud OAuth client,
Supabase provider config, redirect allowlist) was completed by the user;
the code (Google button in the auth form, `signInWithOAuth` handler in
cloud.js, `full_name`-aware `ensureProfile`) shipped the same day. Still
to verify manually: magic-link account + Google sign-in on the same email
lands on the same user.

**Why first:** magic-link email is the most fragile login path
(deliverability, spam, third vendor). One-click Google sign-in removes the
email round-trip for most players.

**What already works for us:**
- `js/supabaseClient.js` sets `detectSessionInUrl: true`, so supabase-js
  will absorb the OAuth callback automatically.
- `js/ui/cloud.js` restores sessions via `auth.getSession()` +
  `auth.onAuthStateChange(...)`; an OAuth session looks identical to a
  magic-link session downstream.
- `SupabaseCharacterStore.ensureProfile()` upserts the profile row
  client-side from `user.email`, which Google identities also carry.

**Code changes:**
- `index.html`: "Sign in with Google" button in the cloud panel auth
  section, above the email/magic-link form ("or sign in by email").
- `js/els.js`: new button entry.
- `js/ui/cloud.js`: click handler calling
  `supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })`.
  Disable the button while redirecting; surface errors through the
  existing `setCloudStatus` path.
- `js/supabaseStore.js` (nicety): `ensureProfile()` prefers
  `user.user_metadata.full_name` over `email.split('@')[0]` for
  `display_name` — but only on first insert; do not clobber a name the
  user already has (make the upsert an insert-if-missing, or read first).
- `docs/gm-guide.md` + README: sign-in instructions mention both paths.

**Manual steps (dashboard, one-time):**
1. Google Cloud Console → create an OAuth 2.0 Client ID (Web application);
   authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
2. Supabase → Authentication → Providers → Google: paste client ID +
   secret.
3. Supabase → Authentication → URL Configuration: Site URL = production
   Vercel URL; additional redirect URLs for `http://localhost:5173` and
   the Vercel preview domain pattern.

**Risks / verification:**
- Account linking: a player who previously used magic links and signs in
  with Google **using the same email** gets the same `auth.users` row only
  if Supabase's automatic identity linking applies (verified-email match).
  Verify with a test account before announcing; if it creates a duplicate
  user, enable manual identity linking or tell players to keep using their
  original method.
- Verify: fresh Google sign-in creates a profile row; existing roster
  loads; magic-link path still works; sign-out clears both.

---

## PR 2 — Supabase CLI migrations baseline

**Status: code/docs done 2026-06-12; user runs `supabase link` +
`supabase db push` + `supabase migration list` to record the baseline.**
Docker is not installed locally, so instead of `supabase db pull` (which
needs a Docker shadow database) the baseline is a copy of the idempotent
`schema.sql` at `supabase/migrations/20260612000000_baseline.sql` —
pushing it against the live database is a recorded no-op. Note discovered
during this PR: the AI routes already use `SUPABASE_SERVICE_ROLE_KEY`
(README AI setup) — when PR 3 introduces `SUPABASE_SECRET_KEY`, migrate
the AI routes' env var to the new-style key at the same time.

**Why:** `supabase/schema.sql` is run by hand in the SQL editor; the repo
and database can drift. Later PRs in this plan change schema and should
land as migration files.

**Changes:**
- `supabase init` (adds `supabase/config.toml`).
- Baseline migration generated with `supabase db pull` against the linked
  hosted project (preferred over hand-converting schema.sql — it captures
  what is actually deployed, including anything applied ad hoc).
- `supabase/schema.sql` gains a header comment: "Reference only — new
  changes go in supabase/migrations/." (Keep it one release as a safety
  net, delete later.)
- README: workflow section — `supabase link --project-ref <ref>`,
  `supabase migration new <name>`, `supabase db push`.

**Manual steps:** install the Supabase CLI; `supabase login`; `supabase
link`. The pull/diff run is interactive, so the user drives it (`!`-prefix
commands in a session work).

**Risks:** none at runtime — this PR changes no deployed objects. The only
trap is a baseline that doesn't match production; `supabase db pull`
avoids it.

---

## PR 3 — Vercel crons: weekly backup + keep-alive

**Status: code done 2026-06-12.** Shipped as planned plus the
`SUPABASE_SECRET_KEY` switch with legacy `SUPABASE_SERVICE_ROLE_KEY`
fallback in `createServiceClient()` (covers the AI routes too) and the
eslint guard. User steps remaining: `supabase db push` (backups bucket
migration), add `SUPABASE_SECRET_KEY` + `CRON_SECRET` in Vercel, deploy,
then `curl` the backup route once to verify (command in README).

**Why:** characters are irreplaceable and the Supabase free tier has no
PITR; free projects also pause after ~a week of inactivity, which would
break login on game night after a two-week break.

**Changes:**
- `vercel.json`: a `crons` block with exactly two jobs (the Hobby plan
  allows two, with daily-or-coarser granularity):
  - `/api/cron/keepalive` daily,
  - `/api/cron/backup` weekly.
- `api/cron/keepalive.js`: verifies `Authorization: Bearer ${CRON_SECRET}`
  (Vercel sends it automatically once the env var exists), then performs
  one trivial service-role query (`select count(*) from profiles`) so the
  database registers activity.
- `api/cron/backup.js`: same auth; service-role client dumps
  `characters`, `campaigns`, `campaign_memberships`, `campaign_npcs`,
  `roll_logs`, and the campaign AI tables to a single gzipped JSON object
  in a new **private `backups` storage bucket**; keeps the most recent 8,
  deletes older. (File blobs in `campaign-files` are not duplicated —
  storage already is the backup of those; the metadata rows are included.)
- Migration (via PR 2's system): create the `backups` bucket, no public
  policies at all — service role only.
- README: restore procedure (download JSON from the bucket, re-insert).

**New env vars (Vercel, server-side only, never `VITE_`-prefixed):**
`SUPABASE_SECRET_KEY`, `CRON_SECRET`. Use a new-style secret API key
(`sb_secret_...`) created under Supabase Settings → API Keys — the legacy
`service_role` JWT key is deprecated in favor of these (the dashboard
banner the user saw on 2026-06-12). supabase-js accepts a secret key in
the same `createClient(url, key)` slot and it bypasses RLS the same way.
Optional rider for this PR: also move the browser app from the legacy
anon key to a publishable key (`sb_publishable_...`) — same swap in
`VITE_SUPABASE_ANON_KEY`'s value, no code change needed.

**Risks:** the secret key bypasses RLS — it must only ever appear in
`api/` code. Lint guard: the existing eslint setup can forbid
`SUPABASE_SECRET` references under `js/`.

---

## PR 4 — Type-checking via JSDoc + `checkJs`

**Status: done 2026-06-12.** jsconfig (strict minus noImplicitAny),
`js/types.js` typedefs, `// @ts-check` on the seven pure rules modules
(pool, status-rules, resolution-rules, npc-rules, ammo-rules,
rules-review, data) — all findings fixed, `npm run typecheck` added to
package.json and CI. Findings were nullability/inference nits, no logic
bugs.

**Why:** the rules engine passes complex shapes (tiles, roll results,
resolution assignments) through many hands; a checker catches the
`calledTileIds`-style omissions (the PR 2 v5.02 bug) before tests do. No
runtime or syntax changes — files stay `.js`.

**Changes:**
- `jsconfig.json`: `checkJs: false` globally with per-file opt-in via
  `// @ts-check`, `strict: true`, `moduleResolution: bundler`.
- `js/types.js`: central `@typedef`s — `Tile`, `TileBox`, `Tag` (string
  now; the parsed object arrives in PR 7), `RollResult`, `CharacterState`,
  `Npc`, `ResolutionAssignments`, `CampaignFile`.
- Opt in the pure rules modules first: `pool.js`, `status-rules.js`,
  `resolution-rules.js`, `npc-rules.js`, `ammo-rules.js`, `rules-review.js`,
  `data.js`. UI modules follow opportunistically.
- `package.json`: `"typecheck": "tsc --noEmit -p jsconfig.json"` with
  `typescript` as a devDependency; add the script to the existing CI
  workflow next to test/lint.

**Risks:** the first run will surface dozens of latent nullability nits in
pool.js; budget the PR as "fix or annotate every finding in the opted-in
files," not "annotate everything everywhere."

---

## PR 5 — Optimistic concurrency on character saves

**Status: done 2026-06-12.** As planned, plus two findings: cloud saves
are now serialized through a promise chain (`queueCloudSave`) so a
debounced save can't race an in-flight one and false-conflict against
itself; and `mergeServerJournalEntries` drops the stale guard because the
AI accept-summary route legitimately bumps the row server-side. The
conflict event carries the state snapshot so "overwrite" works even after
switching characters. 4 new tests (3 store-level guard tests, 1 end-to-end
conflict flow).

**Why:** cloud saves are whole-state upserts; two tabs (or phone + laptop
at the table) silently clobber each other. `characters.updated_at` already
exists and is returned by `listRoster`.

**Changes:**
- `js/data.js`: track `cloudUpdatedAt` for the active character (set on
  load and after each successful save).
- `js/supabaseStore.js` `saveCharacter(id, state, { ifUnmodifiedSince })`:
  for existing rows use `.update(...).eq('id', id).eq('updated_at', ifUnmodifiedSince).select()`;
  zero rows back = conflict. New characters keep the insert path.
- `js/ui/cloud.js`: conflict UX — "This sheet changed somewhere else.
  Reload it (recommended) or overwrite?" Reload pulls the remote state
  through the existing import/normalize path; Overwrite retries without
  the guard.
- Tests: store-level unit tests with a mocked client asserting the guard
  and both conflict resolutions.

**Risks:** clock skew is irrelevant (we compare the value previously read,
not wall time). The main design decision is what "Reload" does to
unsaved local edits — answer: nothing destructive without the user
choosing it.

---

## PR 6 — Realtime live sync (depends on PR 5)

**Status: code done 2026-06-12.** New `js/ui/liveSync.js`; the apply/skip
policy is a pure function in data.js (`shouldApplyRemoteCharacterUpdate`,
tested). Self-origin detection compares the realtime row's updated_at with
`cloudUpdatedAt` (no clientId column needed); a `cloudSaveInFlight` flag
covers the echo-before-response race. Tab-hidden unsubscribes, with a
catch-up reload on resume. User step remaining: `supabase db push` to
apply the realtime-publication migration, then a two-browser test.

**Why:** turns the conflict problem into a feature: the GM watches a
player's sheet and the campaign roll log update live during combat.

**Changes:**
- Migration: `alter publication supabase_realtime add table
  public.characters, public.roll_logs;` (Postgres Changes respects RLS for
  authenticated subscribers).
- New `js/ui/liveSync.js` (init-deps pattern like the other modules):
  - When signed in, subscribe to UPDATEs on the active character row
    (`filter: id=eq.<id>`). Remote changes not originated by this client
    refresh state through the PR 5 reload path; if there are unsaved local
    edits, fall back to the PR 5 conflict prompt instead of clobbering.
  - When a GM campaign is selected, subscribe to INSERTs on `roll_logs`
    for that campaign and live-append to the recent-rolls panel.
  - Unsubscribe on character/campaign switch, sign-out, and page hide.
- Self-origin detection: tag saves with a per-tab `clientId` column on the
  payload (inside the state JSON, no schema change) or compare
  `updated_at` against the last save's returned value.

**Risks:** free-tier realtime quotas (concurrent connections / messages)
are far above this app's table size; still, subscribe only while the
relevant panel is visible. Test multi-tab manually before relying on it
at the table.

---

## PR 7 — Structured tag model (parser + canonical serializer)

**Status: done 2026-06-12.** As planned. Design notes for PR 8: `parseTag`
returns a frozen, memoized `{ raw, name, prefix, body, base, args, exempt }`;
`body` keeps original casing so the serializer round-trips user text. Base
names are clean (`while`, `crowd`) rather than the legacy strings
(`while x`, `crowd 50`) — PR 8 re-keys the flaw/exotic sets accordingly.
Two legacy quirks are locked by tests on purpose: `startsWith` matching
("Hitchhiker" is a hitch), and compilePool following only *unprefixed*
chain tags (the parser keeps `prefix` visible so PR 8 can preserve that).
The parser is catalog-free; XP catalogs stay in pool.js so the import
direction stays pool → tag-model. 24 contract tests, including parity
assertions against `getHitchValue`, `getTileWhileForms`, and
`getTileShieldCrits`.

**Why:** tags are strings ("Bestial: HP", "Chain medical scanner",
"Shield: BREAK KO BLEED", "Hitch 3", "Motorized: SPEED", "While Wolf",
"Crowd 50") and the engine re-derives meaning by regex in many places
(`normalizeTagForXp`, `getMechanicalBaseTag`, `stripMechanicalPrefix`,
`getTileWhileForms`, `getTileShieldCrits`, `getHitchValue`, crowd
parsing). Every new rulebook version pays this tax; a typo'd tag silently
becomes a +2 XP "unknown."

**Changes (this PR is additive only — no behavior change):**
- New pure module `js/tag-model.js`:
  - `parseTag(raw) -> { raw, prefix, base, args, exempt }` where `prefix ∈
    {build, detail, crit, shield, flaw, range, duration, null}` and `args`
    carries the structured payload (hitch value, chain target, while form,
    motorized stat, bestial resource, shield crit list, crowd count).
  - `serializeTag(parsed) -> string` producing the canonical display form
    (round-trips everything the catalog knows).
  - `parseTags(tile)` memoized at the `tileTagList` boundary.
- `test/tag-model.test.js`: port every parsing case currently embedded in
  `pool.test.js` fixtures, plus round-trip and typo cases. This test file
  becomes the contract for PR 8.
- Storage format does **not** change: `tile.tags` stays `string[]`, so
  exports, cloud saves, and old browsers stay compatible.

**Risks:** none at runtime (nothing consumes it yet). The design risk is
under-modeling `args`; the existing regexes enumerate the full variety, so
write the parser by transcribing them.

---

## PR 8 — Rules engine consumes parsed tags

**Status: done 2026-06-12.** Converted per-subsystem as planned (base-tag
helpers → XP scoring → tag limits → pool compile/resource maxes →
rules-review), tests green between each step; all seven string helpers
(`getTagName`, `stripExemptSuffix`, `normalizeTagForLimit`,
`normalizeTagForXp`, `stripMechanicalPrefix`, `getMechanicalBaseTag`,
`normalizeMechanicalTag`) are deleted. Two deviations from the plan text:
the "unknown tag" flag stays in `classifyTagForXp` (the parser is
catalog-free by design, so `recognized` can't live there — the
Auto-Estimate warning is unchanged either way); and a small set of
deliberate consistency fixes shipped where the old exact-match string
lookups silently dropped a tag's mechanics: a GM "(Exempt)" suffix no
longer disables contextual bonuses, Tough/Vital/Quick resource points, or
Chain links (it only ever meant tag-limit exemption, p.33), and
rules-review's typed-Bestial check now accepts exactly what
`calculateResourceMaxes` grants instead of its own narrower regex. Those
fixes are locked by 4 new regression tests (suite now 331). `status-rules.js`
and the spell builder needed no changes — neither parses tag strings.

**Changes:**
- `js/pool.js`, `js/rules-review.js`, `js/status-rules.js` (and the spell
  builder's tag handling): replace the normalize/regex helpers with
  `tag-model` lookups, one subsystem at a time (XP scoring → tag limits →
  pool compile → resource maxes → shield/while/hitch helpers), running
  `npm test` between each.
- The "unknown tag" warning moves into the parser (`recognized: false`),
  so the Auto-Estimate UI keeps its typo warning with no UI change.
- Delete the superseded string helpers at the end; the 295 existing tests
  plus the PR 7 contract tests behavior-lock the whole move.

**Risks:** this is the highest-churn PR in the plan; the mitigations are
the test suite, the per-subsystem sequencing, and PR 4's type checking on
the new shapes. Do not combine with any rules-behavior change.

---

## PR 9 — Split pool.js (after PRs 7-8)

**Status: done 2026-06-12.** As planned, with one addition: a seventh
module `js/rules/shared.js` holds the cross-cutting primitives (stat/color/
resource constants, dice parsing, die steps, escapeHtml) that didn't belong
to any one subsystem. Final shape: pool.js is a 14-line barrel; rules
modules are tags 81 / shared 107 / equipment 171 / xp 243 / shadow 254 /
exotic 274 / engine 889 lines. Import direction is acyclic:
shared/tags → xp/equipment/shadow/exotic → engine. Internals that crossed
module lines (DIE_STEPS, the XP catalogs, parsed-tag views, armor XP
tables) are now exported from their home module and flow through the
barrel. Verified the barrel re-exports all 81 pre-split names with no
duplicate exports (`export *` silently drops ambiguous names, so this was
checked explicitly). Zero changes to UI importers or tests.

**Why:** pool.js is ~2,000 lines; the v5.02 review deferred the split
until something forced churn — PRs 7-8 are that churn, and v5.03's
crafting changes will thank us.

**Changes:**
- New `js/rules/` directory: `tags.js` (re-exports tag-model), `xp.js`
  (cascade, tile estimate, catalogs), `equipment.js` (weapons, armor,
  soak), `shadow.js`, `exotic.js` (Core/Titan/Stranger helpers),
  `engine.js` (PoolEngine: compile/roll/total).
- `js/pool.js` becomes a barrel that re-exports everything, so the ~15 UI
  importers and the test files need zero changes on day one; imports
  migrate to the specific modules opportunistically.

**Risks:** low — pure file moves with a compatibility barrel; `npm test`
and `npm run build` are the gate.

---

## Suggested sequence & sizing

| PR | Size | Depends on |
|----|------|-----------|
| 1. Google OAuth | evening | — |
| 2. Migrations baseline | evening | — |
| 3. Backup + keep-alive crons | evening/weekend | 2 |
| 4. checkJs + typedefs | weekend | — |
| 5. Optimistic concurrency | weekend | 2 |
| 6. Realtime sync | week | 2, 5 |
| 7. Tag parser | weekend | 4 (soft) |
| 8. Engine on parsed tags | week | 7 |
| 9. pool.js split | evening | 7, 8 |
