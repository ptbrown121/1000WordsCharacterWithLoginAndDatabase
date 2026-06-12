# 1000 Words Character Manager Rules Audit

Audit date: 2026-06-11
Rules reference: `1000 WORDS v5.02W 2026.pdf` (extracted text: `docs/rulebook-v5.02-extracted.txt`)
Update plan and per-PR details: `docs/v5.02-rules-update-plan.md` (all 12 PRs complete)
Scope: vanilla JavaScript web app in this repository (Vite build, optional Supabase cloud saves).

## Executive Summary

The app implements the v5.02 ruleset end to end: stats, tiles (including
3-box special identity tiles), the full tag catalog with context pricing,
resource pools (HP/EN/RX plus Shadow, Core, and Titan), Call/Burn/Chain
pools with chain limits, Freebie dice, Titan rerolls, Glitch haywire,
shields in defense resolution, status conditions and crit tracking, Press
costs, Stranger forms and aspects, Hinders, the v5.02 Spell Builder and
Ammo Builder, reagent templates with a crafting helper, and a GM-side NPC
tracker.

The app remains deliberately permissive: creation budgets, starting caps,
and pacing rules surface as review notes rather than hard blocks, and the
sheet-wide **GM reviewed** override quiets them. Hard play-legality rules
(chain length, tag limits on save, burn colors, Qi/Id exclusivity) are
enforced.

Interpretive choices made where v5.02 is ambiguous are recorded as numbered
assumptions in `docs/v5.02-rules-update-plan.md` Part 3 (items 1-15). The GM
answered all open questions on 2026-06-12 (rulings recorded inline in Part 3);
no GM questions remain open. The two that changed code: Sticky is **Ammo-only**
(an open Sticky would undermine the magic system), and the Titan "shock
box"/"Lethal" wording was TORG cross-editing — Shake Off heals 3× current
Titan in resources, Sterner Stuff soaks a WOUND Crit, Kill Shot turns each
crit dealt into a WOUND.

## Project Architecture Summary

| Area | Main files | Current role |
| --- | --- | --- |
| App shell | `index.html`, `css/*.css`, `js/app.js` | Static browser app; localStorage persistence; optional Supabase cloud. |
| Character state | `js/data.js` | Default state, roster, import/export, migration, tile normalization (boxes, special identity, crits, Core/Titan/Stranger fields). |
| Rules engine | `js/pool.js` | Die steps, XP cascade, tag catalog/classification, duplicate pricing, resource maxes, Call/Burn/Chain compilation (chain limits, Freebie, Glitch, Titan), armor soak, shields, Core/Titan/Stranger/Hinder/Gizmo helpers. |
| Status rules | `js/status-rules.js` | Status conditions from 0 pools, Crits Dashboard catalog, WOUND penalty, Press costs. |
| Ammo/crafting | `js/ammo-rules.js` | Ammo Builder line costs, 🞮/🞧 split, reagent templates (Apothecary, Geomancer, field ammo). |
| NPCs | `js/npc-rules.js`, `js/ui/npcs.js` | GM-side NPC stat blocks, budgets, rolls; stored in localStorage or a GM's campaign (campaign_npcs table). |
| Rules review | `js/rules-review.js`, `js/ui/rulesReview.js` | Non-blocking review notes; GM override. |
| Tile UI | `js/ui/modals.js`, `js/ui/cards.js` | Tile CRUD, tag pickers (crits, shields, exotic, While X), weapon/armor/ammo/Hinder builders, special identity, 3rd box. |
| Dice & resolution | `js/ui/pool.js`, `js/resolution-rules.js`, `js/ui/resolution.js` | Pool preview, rolls, post-roll assignment (attack/defense/healing/extension), shields, ammo, Freebie, Titan spends, crafting hints. |
| Subsystem panels | `js/ui/vitals.js`, `condition.js`, `core.js`, `titan.js`, `stranger.js` | Pools, status/crits/Press, Cyber Core, Titan/H-V, Stranger forms & aspects. |
| Spell builder | `js/spellBuilder.js` | v5.02 🗱 spell wizard (verbs, metrics incl. Crowd, modifiers, sacrifices). |
| AI creation | `api/_lib/aiWorkflow.js`, `js/ui/aiCreation.js` | Narrative backstory scenes; tile *suggestions* only, with a v5.02 vocabulary primer. |
| Tests | `test/*.test.js` | 295 node-test cases across all engine modules. |

## Rules Coverage Checklist

### Character creation
| Rule | Status |
| --- | --- |
| Stat/tile XP cascade ({steps} + {other dice}); d3 free | Implemented + tested |
| Starting budgets (25 stat / 50 tile XP) and 3▟ starting cap | Advisory review notes |
| Story Point per stat advance; Story Point per bought Chain tag | Tracked fields + advisory note |
| Tag catalog incl. Sticky (Ammo-only per GM), Titan family, Crowd ranges, World 3 XP, Bestial/Celestial 2/4 | Implemented + tested |
| Duplicate tags +2 per copy; Crit vs Shield same-name not duplicates | Implemented + tested |
| Exotic skill tiles: +2 base, own exotic tag free | Implemented + tested |
| Special identity tiles (Homeworld, Titan Identity): 3rd box, costume discounts/limits | Implemented + tested |

### Gear
| Rule | Status |
| --- | --- |
| Weapon templates (incl. Kick), Far +2, armor material/coverage + base soak | Implemented |
| Hard armor: Shield/Detail -1, flaws rebate 1 more | Implemented (confirmed by v5.02) |
| Shield tags block matching crits; weapon parry opt-in; soak applies when called | Implemented in defense resolution |
| Hinders: subtype, -3 rebate, assault-type guidance, resist rule | Implemented + review notes |
| Gizmo 4/2 XP, gizmo/sliver caps, Qi/Id restrictions | Implemented + review notes |
| Ammo supply mechanic, Ammo Builder, reagent templates, crafting Test/doses | Implemented + tested (loose, per GM: crafting unfinished in v5.02) |

### Play
| Rule | Status |
| --- | --- |
| Call/Burn/Chain pools; chain length ≤ root ▟; maxed chain dice cost 1 resource | Implemented (cost reported, not auto-deducted) |
| Freebie die (pre- and post-roll, EN = ▟, once per test) | Implemented |
| Haywire (>half 1s; Glitch counts 2s) | Implemented + tested |
| Attack/defense/healing resolution incl. Range/Duration extension dice | Implemented |
| Status conditions, Crits Dashboard, WOUND -3 auto-penalty, JOLT defense flag | Implemented |
| Press tracker (costs, repeat/Fast/Recoil/Reticle, haywire bumps) | Implemented |
| Healing diagnosis difficulties (+2/die, +4 combat) | Implemented |

### Subsystems
| Rule | Status |
| --- | --- |
| Shadow (Qi/Id boxes, Aberration, abilities, tags) | Implemented (pre-v5.02 test-drive rules, confirmed by v5.02) |
| Cyber Core (pool from tiles, Grit add, spend abilities, Reticle) | Implemented |
| Titan (pool, rerolls, spends, H/V economy, Costume) | Implemented (spend effects per GM ruling 2026-06-12) |
| Stranger (Bestial resources/Pace, While X forms, Celestial ranks) | Implemented |
| Spells (v5.02 🗱 builder, casting Test data, spell tag-limit exemptions) | Builder implemented; cast-Test *workflow* remains manual |
| NPCs (Rank, Might/Charm/Skill, budgets, descriptors) | Implemented, GM-side; browser-local or shared per campaign (GM-only) |

## Remaining gaps (deliberate)

- **Arcana cast Test workflow**: spell XP is the Test and chained skill ▟
  reduces it, but there is no dedicated casting panel; tables handle it.
- **Automatic crit application**: incoming crits update the Condition panel
  manually; resolution reports what lands but does not mutate pools.
- ~~NPC cloud sync~~: done — a GM can store NPCs in a campaign
  (`campaign_npcs` table, GM-only RLS) via the panel's "Stored in" selector.
- **BLEED on NPCs** (die downgrade) is a manual edit with a hint.
- **v5.03**: the author promises more; crafting is the most likely area to
  change (GM 2026-06-12: narrowing focus to **gizmo crafting** next; the
  Ammo Builder stays because tables use it, potions are unused — keep the
  reagent data but invest nothing further until the new rules land).
