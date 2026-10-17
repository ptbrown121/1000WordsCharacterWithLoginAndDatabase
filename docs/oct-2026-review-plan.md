# October 2026 Codebase & Security Review Plan

Status: completed 2026-10-16. Follows the phased-step convention from `docs/platform-update-plan.md` and `docs/v5.02-rules-update-plan.md`.

## Execution Order

1. **Step 1 — Fix False-Positive Cloud Save Conflict After Campaign Assignment** (`js/supabaseStore.js`, `js/data.js`, `test/cloud-persistence.test.js`)
2. **Step 2 — Post-Roll Burn Shadow (Qi/Id) Exclusivity, Aberration Drift & Haywire/Titan Recalculation** (`js/pool-tile-selection.js`, `js/rules/engine.js`, `js/ui/postRollBurn.js`, `js/types.js`, `test/pool.test.js`, `test/pool-tile-selection.test.js`)
3. **Step 3 — Spell Builder Chain Target Filter & Pre-Save Custom Tag Limit Validation** (`js/spellBuilder.js`, `js/spell-rules.js`, `test/spell-rules.test.js`)
4. **Step 4 — Supabase RLS & Storage Policy Hardening** (`supabase/migrations/`, `supabase/schema.sql`, `test/schema-security.test.js`)
5. **Step 5 — Atomic Rewind & Turn Commit for `api/ai/edit-message.js`** (`supabase/migrations/`, `supabase/schema.sql`, `api/ai/edit-message.js`, `test/ai-persistence.test.js`)
6. **Step 6 — Cloud Sync & Profile Upsert Performance Optimization** (`js/data.js`, `js/supabaseStore.js`, `test/cloud-persistence.test.js`)
7. **Step 7 — Backup Cron Timeout & Bounded Log Table Export** (`vercel.json`, `api/cron/backup.js`, `test/vercel-config.test.js`, `test/api-hardening.test.js`)
8. **Step 8 — Module Decomposition, Agent Docs Sync & Branch Hygiene** (`js/data.js`, `js/ui/resolution.js`, `js/ui/pool.js`, `AGENTS.md`, `CLAUDE.md`)

---

## Step 1 — Fix False-Positive Cloud Save Conflict After Campaign Assignment

**Status: done 2026-10-16.**

**Why:** `DataManager.assignActiveCharacterToCampaign` called `SupabaseCharacterStore.assignCharacterToCampaign`, which updated `public.characters` (bumping `updated_at`), without flushing pending edits first or recording the new server `updated_at` on `this.cloudUpdatedAt`. The very next character edit sent the stale `this.cloudUpdatedAt` via `ifUnmodifiedSince`, matching 0 rows and raising a false-positive `CloudSaveConflictError`.

**Code changes:**
- `js/supabaseStore.js`: `assignCharacterToCampaign` selects `updated_at` from the updated row and returns the new server timestamp.
- `js/data.js`: `assignActiveCharacterToCampaign` awaits `flushCloudSave()`, sets `cloudSaveInFlight` during the assignment call so live-sync ignores the self-originated realtime echo, and updates `this.cloudUpdatedAt` (plus any cloud draft base timestamp) with the returned `updated_at`.
- `test/cloud-persistence.test.js`: unit tests covering `SupabaseCharacterStore.assignCharacterToCampaign` and `DataManager.assignActiveCharacterToCampaign` followed by subsequent guarded edits.

---

## Step 2 — Post-Roll Burn Shadow (Qi/Id) Exclusivity, Aberration Drift & Haywire/Titan Recalculation

**Status: done 2026-10-16.**

**Why:** Pre-roll `compilePool` prevents mixing Qi and Id tiles on the same check (p.58) and `finalizeRoll` shifts `state.aberration` when Qi or Id is used. Post-roll burning (`compilePostRollBurn` / `burnAfterRoll`) bypassed both checks, did not recompute `haywireThreshold` or `titanActive` when a post-roll burned tile had `Glitch` or `Titan`, and did not auto-assign newly rolled dice when `adds` increased.

**Code changes:**
- `js/pool-tile-selection.js`: `getPostRollBurnEligibleTiles` excludes Qi tiles when the check already used Id (and vice versa).
- `js/rules/engine.js`: `compilePostRollBurn` validates shadow exclusivity across the check's existing tiles + newly burned tile and returns updated `shadowUse`, `haywireThreshold`, and `titanActive`.
- `js/ui/postRollBurn.js`: `burnAfterRoll` applies aberration shift if the check had not yet drifted on that shadow axis, updates `result.haywireThreshold` and `result.titanActive`, and refreshes resolution assignments for newly kept dice.
- `test/pool.test.js` & `test/pool-tile-selection.test.js`: unit tests for post-roll Qi/Id exclusivity, aberration drift, and Glitch/Titan recalculation.

---

## Step 3 — Spell Builder Chain Target Filter & Pre-Save Custom Tag Limit Validation

**Status: done 2026-10-16.**

**Why:**
1. `SpellBuilder.openWizard` populated `#spell-chain-target` using `t.type === 'Skill' && t.isSpellcastSkill`, missing Arcana skills identified via `t.exoticSkill?.system === 'Arcana'` or an `Arcana` tag (used by `isArcanaSkillTile` in `js/spell-rules.js` and `hasArcanaSkill` in `js/rules-review.js`).
2. `SpellBuilder.renderTagLimitStatus` and `SpellBuilder.saveSpell` called `calculateTagLimit` without `{ isSpell: true }` and without including comma-separated tags from `#spell-custom-tags`.

**Code changes:**
- `js/spellBuilder.js` & `js/spell-rules.js`: use `isArcanaSkillTile` for the chain target dropdown and include `#spell-custom-tags` + `{ isSpell: true }` in `calculateTagLimit`.
- `test/spell-rules.test.js`: unit tests for Arcana skill detection and spell tag-limit calculation with custom tags and `Chain`.

---

## Step 4 — Supabase RLS & Storage Policy Hardening

**Status: done 2026-10-16.**

**Why:**
1. `characters_update_owner_only` only checked `with check (owner_id = auth.uid())`, allowing a character owner to set `campaign_id` to a campaign they have not joined (unlike `characters_insert_owner`, which checks `is_campaign_member(campaign_id)`).
2. `ai_agent_logs_insert_thread_owner_or_gm` allowed `thread_id is null` or mismatched `campaign_id`/`character_id`.
3. `ai_scene_summaries` had no trigger preventing `scope_type`, `scope_id`, or `campaign_id` changes on update.
4. `campaign_files` storage policies cast `((storage.foldername(name))[1])::uuid` directly without guarding against non-UUID folder names.

**Code changes:**
- `supabase/migrations/20261016000000_rls_campaign_and_log_hardening.sql` & `supabase/schema.sql`: added `public.try_parse_uuid` and `public.guard_ai_summary_scope_change`, and tightened `characters_update_owner_only`, `ai_agent_logs_insert_thread_owner_or_gm`, and `campaign_files` storage policies.
- `test/schema-security.test.js`: regression assertions verifying the hardened policies and trigger in `supabase/schema.sql`.

---

## Step 5 — Atomic Rewind & Turn Commit for `api/ai/edit-message.js`

**Status: done 2026-10-16.**

**Why:** `api/ai/edit-message.js` called `rewind_ai_thread_from_message` before calling OpenAI (`runSceneAgent`), then performed three separate writes. If OpenAI failed, later messages and summaries were already deleted/reverted.

**Code changes:**
- `supabase/migrations/20261016010000_atomic_rewind_and_commit_ai_turn.sql` & `supabase/schema.sql`: added `public.rewind_and_commit_ai_scene_turn`, which locks the thread (`for update`), checks `operation_id` idempotency and `expected_thread_updated_at`, rewinds later messages/summaries, inserts the revised assistant reply, updates the thread, and records the agent log in one transaction.
- `api/ai/edit-message.js` & `js/ui/aiCreation.js`: slice the prior transcript in memory for `runSceneAgent`, pass retry-safe `requestId`, and commit via `rewind_and_commit_ai_scene_turn` only after `runSceneAgent` succeeds.
- `test/ai-persistence.test.js`: tests for `rewind_and_commit_ai_scene_turn` schema guarantees, `sliceMessagesBeforeEdit`, and `createEditMessageHandler` failure/success paths.

---

## Step 6 — Cloud Sync & Profile Upsert Performance Optimization

**Status: done 2026-10-16.**

**Why:** `DataManager.queueCloudSave` called `refreshCloudRoster()` after every debounced save (up to 5 Supabase requests), and `SupabaseCharacterStore.ensureProfile` upserted `profiles` on every `listRoster()` call.

**Code changes:**
- `js/data.js`: added `syncCloudRosterCharacterName(charId, name)` and used it in `queueCloudSave`, `resolveCloudConflictByOverwriting`, and `applyRemoteCloudCharacter` instead of re-fetching the entire roster on every auto-save.
- `js/supabaseStore.js`: run `ensureProfile()` once per `SupabaseCharacterStore` session and pass `{ onConflict: 'id', ignoreDuplicates: true }` to avoid clobbering existing `display_name`.
- `test/cloud-persistence.test.js`: tests verifying roster name sync without redundant `listRoster()` calls on auto-save and once-per-session `ensureProfile()`.

---

## Step 7 — Backup Cron Timeout & Bounded Log Table Export

**Status: done 2026-10-16.**

**Why:** `vercel.json` did not configure `maxDuration` for `api/cron/*.js`, and `api/cron/backup.js` dumped unbounded append-only log tables (`roll_logs`, `ai_agent_run_logs`).

**Code changes:**
- `vercel.json`: added `"api/cron/*.js": { "maxDuration": 60 }`.
- `api/cron/backup.js`: bounded `roll_logs` and `ai_agent_run_logs` exports to a recent window (default 90 days via `BACKUP_LOG_RETENTION_DAYS`) and row cap (default 5000 rows via `BACKUP_LOG_MAX_ROWS`), ordered newest-first.
- `test/vercel-config.test.js` & `test/api-hardening.test.js`: tests for cron `maxDuration` and bounded log backup queries.

---

## Step 8 — Module Decomposition, Agent Docs Sync & Branch Hygiene

**Status: done 2026-10-16.**

**Why:** Keep large modules (`js/data.js`) maintainable, synchronize `AGENTS.md` with `CLAUDE.md`, and clean up stale local branches.

**Code changes:**
- Extracted pure character/tile normalization helpers (~360 lines) from `js/data.js` into `js/character-normalizer.js` with full re-exports from `js/data.js`.
- Synchronized `AGENTS.md` and `CLAUDE.md` (`js/sheet-rules.js`, `js/character-normalizer.js`, `vercel.json` CSP notes, and `docs/oct-2026-review-plan.md`).
- Cleaned up 10 stale/merged local branches (`worktree-agent-*`, `fix/*`, `hotfix/*`), leaving only `main`.
