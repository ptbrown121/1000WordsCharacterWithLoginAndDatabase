// @ts-check
// Pure rules engine for the post-roll resolution screen.
//
// These helpers were previously private functions inside app.js. They have
// no DOM dependencies and no shared mutable state - every input is a
// parameter, every output is a fresh value. This file is consequently
// safe to import from `node --test` and is covered by
// test/resolution-rules.test.js.
//
// Extraction notes (split-app-js PR):
// - calculateAssignedTotals, calculateResolutionPlusUsage, and
//   getHealingAssignments previously read uiState.currentResolutionAssignments
//   directly. They now take `assignments` as a required parameter. Call
//   sites in app.js pass uiState.currentResolutionAssignments, so user-
//   visible behavior is unchanged.
// - calculateResolutionPlusUsage previously defaulted `mode` to
//   uiState.currentResolutionMode; that default is removed, callers must
//   pass the mode explicitly.

import { DIE_STEPS } from './rules/shared.js';
import { activeParsedTags, MECHANICAL_PREFIXES } from './rules/tags.js';
import { getAvailableShadowAbilities } from './rules/shadow.js';

// Resolution buckets follow the book's worked examples: attacks split dice
// between attack and impact (p.26), defenses between evasion and grit
// (p.27), and medical checks between the diagnosis test and assigned
// healing dice (p.46).
export const RESOLUTION_MODES = {
    action: {
        label: 'Action',
        options: [
            { value: 'action', label: 'Roll' },
            { value: 'unused', label: 'Unused' }
        ]
    },
    attack: {
        label: 'Attack',
        options: [
            { value: 'attack', label: 'Attack' },
            { value: 'impact', label: 'Impact' },
            { value: 'extend', label: 'Range/Duration' },
            { value: 'unused', label: 'Unused' }
        ]
    },
    defense: {
        label: 'Defense',
        options: [
            { value: 'evasion', label: 'Evasion' },
            { value: 'grit', label: 'Grit' },
            { value: 'unused', label: 'Unused' }
        ]
    },
    healing: {
        label: 'Healing',
        options: [
            { value: 'diagnosis', label: 'Diagnosis Roll' },
            { value: 'heal_energy', label: 'Heal Energy (6)' },
            { value: 'heal_health', label: 'Heal Health (8)' },
            { value: 'heal_reflex', label: 'Heal Reflex (10)' },
            { value: 'fading_crit', label: 'All Fading Crits (6)' },
            { value: 'afire', label: 'Afire -> Down (4)' },
            { value: 'sticky_crit', label: 'Sticky Crit (8)' },
            { value: 'burned_tile', label: 'Burned Tile (10)' },
            { value: 'wound', label: 'Wound (12)' },
            { value: 'unused', label: 'Unused' }
        ]
    }
};

// Medical treatment difficulties from the Diagnosis table (p.46): a spare
// die can repair a Resource or Crit whose Test is at or below the check.
// The ordering mirrors natural healing (p.45): Fast Crits fade first,
// Wounds need the most care.
export const HEALING_TARGETS = {
    afire: { label: 'Afire -> Down', difficulty: 4, kind: 'count' },
    heal_energy: { label: 'Energy', difficulty: 6, kind: 'resource' },
    fading_crit: { label: 'All Fading Crits', difficulty: 6, kind: 'count' },
    heal_health: { label: 'Health', difficulty: 8, kind: 'resource' },
    sticky_crit: { label: 'Sticky Crit', difficulty: 8, kind: 'count' },
    heal_reflex: { label: 'Reflex', difficulty: 10, kind: 'resource' },
    burned_tile: { label: 'Burned Tile', difficulty: 10, kind: 'count' },
    wound: { label: 'Wound', difficulty: 12, kind: 'count' }
};

export const RESOLUTION_PLUS_BUCKETS = {
    attack: new Set(['attack', 'impact']),
    defense: new Set(['evasion', 'grit']),
    healing: new Set(['diagnosis', 'heal_energy', 'heal_health', 'heal_reflex'])
};

// On-the-fly Range/Duration extension (pp.52-53): spare dice assigned to
// 'extend' raise Range or Duration tags one increment each on the Space and
// Time table. "The first die applied needs a 3 ... The second die applied
// needs a 4, and the third die needs a 5, etc." (p.53). The player picks
// the order, so the dice are applied in their best order: lowest first,
// each against the next threshold. A die too low for the current threshold
// is simply not applied (it does not use up a threshold), so a 4 and a 3
// give two increments, as in Amonkenet's primal burst example (p.53).
// Instant, Sustain, and Rite durations cannot be modified; modifications
// are one-use.
/**
 * @returns {{entries: Array<{val: number, threshold: number, success: boolean}>, increments: number}}
 *   entries in application order; an unsuccessful entry was not applied,
 *   and its `threshold` is the value it would have needed.
 */
export function getRangeExtensionResults(result, assignments) {
    const values = [];
    (result.originalRolls || []).forEach((roll, index) => {
        if ((assignments[getRollId(roll, index)] || 'unused') === 'extend') values.push(roll.val);
    });
    values.sort((a, b) => a - b);

    let threshold = 3;
    const entries = values.map(val => {
        const success = val >= threshold;
        const entry = { val, threshold, success };
        if (success) threshold += 1;
        return entry;
    });

    return { entries, increments: entries.filter(entry => entry.success).length };
}

// Resources that may pay a chain cost, in display order.
export const CHAIN_COST_RESOURCE_KEYS = ['hp', 'en', 'rx', 'sh'];

// Chain cost (p.25): "Each maxed die used costs 1 resource." Per the
// upcoming-edition ruling (2026-06-12) the cost applies to any check that
// calls chained tiles — Chain tags, Spells (Chain to an Arcana skill), and
// World links all contribute dice labeled "Chain (...)" — and prices EVERY
// die in that check that rolled its maximum face, not just the chained
// tiles' own dice. The resource (HP, EN, RX, or SH) is the player's choice
// per die, and a maxed die assigned to Unused costs nothing: the player may
// decline the die to skip the cost. This reports each maxed die so the UI
// can offer that choice; nothing is auto-deducted here.
export function getChainMaxedDieCost(result, assignments = {}) {
    const rolls = result.originalRolls || [];
    const chained = rolls.some(roll => String(roll.source || '').startsWith('Chain ('));
    if (!chained) return { chained: false, entries: [], dueCount: 0 };

    const entries = [];
    rolls.forEach((roll, index) => {
        const faces = parseInt(String(roll.die || '').replace('d', ''), 10);
        if (!Number.isFinite(faces) || roll.val !== faces) return;
        const rollId = getRollId(roll, index);
        entries.push({
            rollId,
            source: roll.source,
            die: roll.die,
            val: roll.val,
            used: (assignments[rollId] || 'unused') !== 'unused'
        });
    });

    return { chained: true, entries, dueCount: entries.filter(entry => entry.used).length };
}

// Free-text crit list ("BLEED, DOWN") -> lowercased crit names.
export function parseCritList(text) {
    return String(text || '')
        .split(/[\s,;/]+/)
        .map(part => part.trim().toLowerCase())
        .filter(Boolean);
}

// Shield tags block matching inbound Crits one-for-one after Grit fails
// (p.39: "each Shield tag blocks a matching inbound Crit"). Each shield is
// consumed by the crit it blocks, so two inbound JOLTs need two JOLT shields.
export function applyShieldsToCrits(incomingCrits = [], shieldCrits = []) {
    const available = shieldCrits.map(crit => String(crit).toLowerCase());
    const blocked = [];
    const remaining = [];

    incomingCrits.forEach(crit => {
        const index = available.indexOf(String(crit).toLowerCase());
        if (index === -1) {
            remaining.push(crit);
            return;
        }
        available.splice(index, 1);
        blocked.push(crit);
    });

    return { blocked, remaining };
}

// Stable id for a roll within a result. Prefers the roll's own id, falls
// back to its index so unsorted rolls and sorted rolls agree on identity.
export function getRollId(roll, index) {
    return String(roll.id ?? index);
}

// Rolls sorted high-to-low, each tagged with its rollId so callers can
// match a sorted roll back to its position in the original array.
export function getSortedRolls(result) {
    return (result.originalRolls || [])
        .map((roll, index) => ({ ...roll, rollId: getRollId(roll, index) }))
        .sort((a, b) => b.val - a.val);
}

// Default assignment map for a fresh roll: spend the keep-budget on the
// primary slot(s) for the chosen mode, mark everything else 'unused'.
// Attack/defense put the last keep on the secondary slot (impact / grit)
// when adds > 1, matching the typical "attack with crit" pattern.
/** @returns {import('./types.js').ResolutionAssignments} */
export function getDefaultResolutionAssignments(result, mode) {
    /** @type {import('./types.js').ResolutionAssignments} */
    const assignments = {};
    const sortedRolls = getSortedRolls(result);
    const adds = result.adds ?? 2;

    sortedRolls.forEach((roll, index) => {
        let assignment = 'unused';

        if (index < adds) {
            if (mode === 'attack') {
                assignment = index === adds - 1 && adds > 1 ? 'impact' : 'attack';
            } else if (mode === 'defense') {
                assignment = index === adds - 1 && adds > 1 ? 'grit' : 'evasion';
            } else if (mode === 'healing') {
                assignment = 'diagnosis';
            } else {
                assignment = 'action';
            }
        }

        assignments[roll.rollId] = assignment;
    });

    return assignments;
}

export function getAssignmentOptions(mode) {
    return RESOLUTION_MODES[mode]?.options || RESOLUTION_MODES.action.options;
}

// Bucket where a flat bonus (e.g. result.flatBonus) lands when the
// current mode has no more specific bucket for it.
export function getPrimaryBonusBucket(mode) {
    if (mode === 'attack') return 'attack';
    if (mode === 'defense') return 'evasion';
    if (mode === 'healing') return 'diagnosis';
    return 'action';
}

// Apply each tag bonus' context string to the buckets the current mode
// actually uses. Bonuses that don't match any bucket for this mode are
// not silently dropped - they are reported in `details` so the UI can
// explain why the user didn't get them.
export function getResolutionBonusTotals(result, mode) {
    const totals = { action: 0, attack: 0, impact: 0, evasion: 0, grit: 0, soak: 0, diagnosis: 0 };
    const details = [];

    (result.appliedTagBonuses || []).forEach(bonus => {
        const context = (bonus.context || '').toLowerCase();
        let bucket = null;

        if (mode === 'action') {
            bucket = 'action';
        } else if (context.includes('attack')) {
            bucket = mode === 'attack' ? 'attack' : null;
        } else if (context.includes('damage') || context.includes('impact')) {
            bucket = mode === 'attack' ? 'impact' : null;
        } else if (context.includes('evasion') || context.includes('detection')) {
            bucket = mode === 'defense' ? 'evasion' : null;
        } else if (context.includes('grit')) {
            bucket = mode === 'defense' ? 'grit' : null;
        } else if (context.includes('soak')) {
            bucket = mode === 'defense' ? 'soak' : null;
        } else if (context.includes('action')) {
            bucket = getPrimaryBonusBucket(mode);
        }

        if (!bucket) {
            details.push(`${bonus.tag} from ${bonus.sourceTileName}: not used in ${RESOLUTION_MODES[mode].label.toLowerCase()} resolution`);
            return;
        }

        totals[bucket] += bonus.steps;
        details.push(`${bonus.tag} from ${bonus.sourceTileName}: +${bonus.steps} ${bucket}`);
    });

    totals[getPrimaryBonusBucket(mode)] += result.flatBonus || 0;
    return { totals, details };
}

// Sum each roll's value into its assignment slot. Returns both the totals
// map and how many dice were assigned to a non-unused slot.
export function calculateAssignedTotals(result, assignments) {
    const totals = {};
    let usedCount = 0;

    (result.originalRolls || []).forEach((roll, index) => {
        const rollId = getRollId(roll, index);
        const assignment = assignments[rollId] || 'unused';

        if (assignment !== 'unused') usedCount += 1;
        totals[assignment] = (totals[assignment] || 0) + roll.val;
    });

    return { totals, usedCount };
}

// Pluses are charged when the user splits dice across both slots in a
// dual-bucket mode (attack/impact, evasion/grit, healing diagnosis +
// resource). The first die in each bucket is "free"; every subsequent
// die in that same bucket consumes one plus from the budget. The player
// chooses where each Add lands ("The Add can be used anywhere", pp.26-27).
//
// Modes without dual buckets (action) return used=0 and budget=adds-1
// for consistent UI semantics.
export function calculateResolutionPlusUsage(result, mode, assignments) {
    const plusBuckets = RESOLUTION_PLUS_BUCKETS[mode];
    const bucketCounts = {};

    if (!plusBuckets) {
        return {
            used: 0,
            budget: Math.max(0, (result.adds ?? 2) - 1),
            bucketCounts
        };
    }

    (result.originalRolls || []).forEach((roll, index) => {
        const rollId = getRollId(roll, index);
        const assignment = assignments[rollId] || 'unused';
        if (!plusBuckets.has(assignment)) return;

        bucketCounts[assignment] = (bucketCounts[assignment] || 0) + 1;
    });

    const used = Object.values(bucketCounts)
        .reduce((sum, count) => sum + Math.max(0, count - 1), 0);

    return {
        used,
        budget: Math.max(0, (result.adds ?? 2) - 1),
        bucketCounts
    };
}

// Map of healing-target-id -> { ...HEALING_TARGETS[id], amount, count }
// for assignments that target a healing slot. `amount` is the dice sum
// (used for resource healing); `count` is the number of dice (used for
// count-style healing like "all fading crits" or per-wound treatment).
export function getHealingAssignments(result, assignments) {
    const healing = {};

    (result.originalRolls || []).forEach((roll, index) => {
        const rollId = getRollId(roll, index);
        const assignment = assignments[rollId];
        const target = HEALING_TARGETS[assignment];
        if (!target) return;

        if (!healing[assignment]) {
            healing[assignment] = { ...target, amount: 0, count: 0 };
        }

        healing[assignment].count += 1;
        healing[assignment].amount += roll.val;
    });

    return healing;
}

// ---------------------------------------------------------------------------
// Play-time tag effects and resource spends on the resolution screen.
// Everything below takes the called tile objects (the UI resolves them from
// result.calledTileIds) and plain values, so it stays DOM-free.

// A tile's ▟ is the sum of its dice's steps - the same value the call-time
// contextual bonuses (Keen, Sharp, Agile, ...) use.
function getTileDieSteps(tile) {
    return (tile?.dice || []).reduce((sum, die) => sum + (DIE_STEPS[die] || 0), 0);
}

function getDieFaces(die) {
    const faces = parseInt(String(die || '').replace('d', ''), 10);
    return Number.isFinite(faces) ? faces : 0;
}

// Flat flaw penalties (p.20 "Flaw Tags—Weapon Condition"; p.29 armor
// Condition table; glossary p.79): "Old — armor resistance — -3 grit",
// "Primitive — weapon impact — -3 damage", "Worn — weapon reliability —
// -3 attack". Flaws are drawbacks, so they apply automatically whenever the
// tile is called in the matching resolution mode. Like the Glitch flaw in
// the pool compiler, any prefix form counts ("Old", "Detail: Old",
// "Flaw: Old").
export const FLAW_PENALTIES = {
    old: { name: 'Old', mode: 'defense', bucket: 'grit', amount: 3 },
    primitive: { name: 'Primitive', mode: 'attack', bucket: 'impact', amount: 3 },
    worn: { name: 'Worn', mode: 'attack', bucket: 'attack', amount: 3 }
};

// ▟-scaled tags that only take effect after the roll (weapon Detail tags
// p.30, armor Function tags p.29, glossary p.78):
// - Piercing "-▟ to foe's soak" and Blinding "-▟ to foe's evasion" change
//   the target's numbers, so they cannot ride on the call-time +▟ bonus
//   list; they apply to an attack made with the called tile.
// - Loose "+▟ defenses". Reading: +▟ to the defense check, which lands in
//   Evasion - the defense total compared against the attack (p.27), and
//   the bucket flat defense bonuses already use (getPrimaryBonusBucket).
//   "Defenses" is not read as Evasion AND Grit: nothing in the text doubles
//   the bonus, and Loose costs the same 2 XP as Agile (+▟ evasion).
// The call-time +▟ bonuses (Keen, Agile, ...) are opt-in because a called
// tile may be used for a check its bonus does not fit. Here the resolution
// mode already says how the tile is used, so these apply automatically in
// the matching mode, with the same ▟ (the tile's die steps) and the same
// qualifying prefixes, one application per tag instance.
export const CALLED_TILE_STEP_MODIFIERS = {
    piercing: { name: 'Piercing', mode: 'attack', bucket: 'foeSoak' },
    blinding: { name: 'Blinding', mode: 'attack', bucket: 'foeEvasion' },
    loose: { name: 'Loose', mode: 'defense', bucket: 'evasion' }
};

const MODIFIER_BUCKET_LABELS = {
    action: 'action',
    attack: 'attack',
    impact: 'impact',
    evasion: 'evasion',
    grit: 'grit',
    soak: 'soak',
    diagnosis: 'diagnosis',
    foeSoak: 'foe\'s soak',
    foeEvasion: 'foe\'s evasion'
};

function emptyModifierTotals() {
    return { action: 0, attack: 0, impact: 0, evasion: 0, grit: 0, soak: 0, diagnosis: 0, foeSoak: 0, foeEvasion: 0 };
}

/**
 * Automatic modifiers from tiles called in the check. Broken gear carries
 * no tags (activeParsedTags). `foeSoak` / `foeEvasion` are reductions
 * (positive numbers) to subtract from the target's values; the other
 * buckets are signed adjustments.
 * @param {any[]} calledTiles
 * @param {string} mode
 */
export function getCalledTileModifiers(calledTiles = [], mode = 'action') {
    const totals = emptyModifierTotals();
    const details = [];

    (calledTiles || []).forEach(tile => {
        if (!tile) return;
        const tileName = tile.name || 'Unnamed tile';
        activeParsedTags(tile).forEach(parsed => {
            const stepRule = CALLED_TILE_STEP_MODIFIERS[parsed.base];
            if (stepRule) {
                if (stepRule.mode !== mode || !MECHANICAL_PREFIXES.has(parsed.prefix)) return;
                const steps = getTileDieSteps(tile);
                if (steps <= 0) return;
                totals[stepRule.bucket] += steps;
                const sign = stepRule.bucket.startsWith('foe') ? '-' : '+';
                details.push(`${stepRule.name} from ${tileName}: ${sign}${steps} ${MODIFIER_BUCKET_LABELS[stepRule.bucket]}`);
                return;
            }

            const flaw = FLAW_PENALTIES[parsed.base];
            if (flaw && flaw.mode === mode) {
                totals[flaw.bucket] -= flaw.amount;
                details.push(`${flaw.name} flaw on ${tileName}: -${flaw.amount} ${MODIFIER_BUCKET_LABELS[flaw.bucket]}`);
            }
        });
    });

    return { totals, details };
}

// JOLT (p.38): "target loses 3 Grit on next defense" - per active JOLT.
export const JOLT_GRIT_LOSS = 3;

export function getJoltGritPenalty(activeJolts = 0) {
    return Math.max(0, parseInt(String(activeJolts), 10) || 0) * JOLT_GRIT_LOSS;
}

// Dice a called tile contributed to the pool. The compiler labels them
// "Tile (name)" (call and Hitch-called tiles) or "Chain (name)". Burned
// dice ("Burn (name)") are excluded: "Burn tiles do NOT trigger tags"
// (p.24), and burned tiles are not in result.calledTileIds.
function isCalledTileRoll(roll, tile) {
    const name = tile?.name || '';
    return roll.source === `Tile (${name})` || roll.source === `Chain (${name})`;
}

/**
 * Risky (p.20 "take 1 HP / rolled 1"; p.30 and glossary p.79 "lose 1 HP /
 * rolled 1"): count the 1s rolled on each called Risky tile's own dice.
 * Reported, not deducted - the UI offers a button.
 * @param {import('./types.js').RollResult} result
 * @param {any[]} calledTiles
 */
export function getRiskyHpLoss(result, calledTiles = []) {
    const rolls = result?.originalRolls || [];
    const entries = [];

    (calledTiles || []).forEach(tile => {
        if (!tile) return;
        const riskyCount = activeParsedTags(tile).filter(parsed => parsed.base === 'risky').length;
        if (riskyCount === 0) return;
        const ones = rolls.filter(roll => isCalledTileRoll(roll, tile) && roll.val === 1).length;
        if (ones === 0) return;
        entries.push({ tileId: tile.id, tileName: tile.name || 'Unnamed tile', ones, hp: ones * riskyCount });
    });

    return { entries, total: entries.reduce((sum, entry) => sum + entry.hp, 0) };
}

/**
 * Roll ids of every die in the check that rolled its maximum face.
 * @param {import('./types.js').RollResult} result
 */
export function getMaxedRollIds(result) {
    const ids = [];
    (result?.originalRolls || []).forEach((roll, index) => {
        const faces = getDieFaces(roll.die);
        if (faces > 0 && roll.val === faces) ids.push(getRollId(roll, index));
    });
    return ids;
}

// Cyber flaws (p.65 flaw table; glossary p.79) whose trigger can be read
// off the roll. Readings:
// - "On any 1" (Feedback SLOW, Rube DOWN) fires once when any die in the
//   check rolls a 1: "any" is the whole pool, and "on any" (vs the Ammo
//   cards' "for each") means once, not once per die.
// - "Haywire deals X" (Overload PAIN, Solo FEAR, Torn ▟ HP, Undroid WOUND)
//   fires when the check goes haywire; Torn's ▟ is the Torn tile's.
// - Numb "Reroll each maxed die" covers every maxed die in the check.
// All require the flawed tile to be called. Glitch is applied by the pool
// compiler (haywire threshold) and Hungry is a call cost, so neither is
// here; the rest (Adware, Bound, Hacked, Malware, Stigma) are story flaws.
export const CYBER_FLAW_TRIGGERS = {
    feedback: { name: 'Feedback', trigger: 'one', effect: 'take SLOW' },
    rube: { name: 'Rube', trigger: 'one', effect: 'take DOWN' },
    overload: { name: 'Overload', trigger: 'haywire', effect: 'take PAIN' },
    solo: { name: 'Solo', trigger: 'haywire', effect: 'take FEAR' },
    torn: { name: 'Torn', trigger: 'haywire', effect: 'lose ▟ HP' },
    undroid: { name: 'Undroid', trigger: 'haywire', effect: 'take WOUND' },
    numb: { name: 'Numb', trigger: 'maxed', effect: 'reroll each maxed die' }
};

/**
 * @param {import('./types.js').RollResult} result
 * @param {any[]} calledTiles
 * @returns {Array<{tag: string, name: string, tileName: string, trigger: string, effect: string, hp: number, maxedRollIds: string[]}>}
 */
export function getCyberFlawTriggers(result, calledTiles = []) {
    const rolls = result?.originalRolls || [];
    const anyOne = rolls.some(roll => roll.val === 1);
    const maxedRollIds = getMaxedRollIds(result);
    const triggered = [];

    (calledTiles || []).forEach(tile => {
        if (!tile) return;
        const seen = new Set();
        activeParsedTags(tile).forEach(parsed => {
            const rule = CYBER_FLAW_TRIGGERS[parsed.base];
            if (!rule || seen.has(parsed.base)) return;
            seen.add(parsed.base);

            const fires = (rule.trigger === 'one' && anyOne)
                || (rule.trigger === 'haywire' && Boolean(result?.isHaywire))
                || (rule.trigger === 'maxed' && maxedRollIds.length > 0);
            if (!fires) return;

            const hp = parsed.base === 'torn' ? getTileDieSteps(tile) : 0;
            triggered.push({
                tag: parsed.base,
                name: rule.name,
                tileName: tile.name || 'Unnamed tile',
                trigger: rule.trigger,
                effect: parsed.base === 'torn' ? `lose ${hp} HP` : rule.effect,
                hp,
                maxedRollIds: parsed.base === 'numb' ? maxedRollIds : []
            });
        });
    });

    return triggered;
}

// Core spends that change the current roll (p.64 "Spend 1 Core to..."):
// "Machine — Add Core to Soak", "Boost — Maximize dice on [Stat]",
// "Enhanced — Maximize dice on this tile". Offered only when an active tile
// carries the tag and the relevant dice are in the roll (and not already
// maxed). Boost's [Stat] may be written on the tag ("Boost: BODY"); a bare
// "Boost" lets the player pick any stat whose dice are in the pool.
// Enhanced maximizes the tile's dice however they entered the pool
// (called, chained, or burned): it is a Core spend, not a tag triggered by
// the call. Machine is once per check; its amount is the Core left after
// paying the 1 Core (the UI records it on the result).
const STAT_SOURCE_RE = /^Stat \((.+)\)$/;

/** @returns {string|null} '' for a bare Boost, the stat for "Boost: STAT", null otherwise. */
function getBoostStat(parsed) {
    if (parsed.base === 'boost') return '';
    const match = parsed.base.match(/^boost\s*:?\s*([a-z]+)$/);
    return match ? match[1].toUpperCase() : null;
}

/**
 * @param {import('./types.js').RollResult} result
 * @param {any[]} tiles all of the character's tiles
 * @param {string} mode
 * @returns {Array<{id: string, ability: 'machine'|'boost'|'enhanced', label: string, rollIds: string[]}>}
 */
export function getCoreRollSpendOptions(result, tiles = [], mode = 'action') {
    const rolls = result?.originalRolls || [];
    /** @type {Array<{id: string, ability: 'machine'|'boost'|'enhanced', label: string, rollIds: string[]}>} */
    const options = [];
    const activeTiles = (tiles || []).filter(tile => tile && !tile.isBuried);
    const unmaxedRollIds = (predicate) => rolls
        .map((roll, index) => ({ roll, rollId: getRollId(roll, index) }))
        .filter(({ roll }) => predicate(roll) && roll.val < getDieFaces(roll.die))
        .map(({ rollId }) => rollId);

    const boostStats = new Set();
    let boostAnyStat = false;
    let hasMachine = false;
    activeTiles.forEach(tile => {
        activeParsedTags(tile).forEach(parsed => {
            if (parsed.base === 'machine') hasMachine = true;
            const stat = getBoostStat(parsed);
            if (stat === '') boostAnyStat = true;
            else if (stat) boostStats.add(stat);
        });
    });

    if (hasMachine && mode === 'defense' && !result?.coreSoak) {
        options.push({ id: 'machine', ability: 'machine', label: 'Machine: add Core to Soak', rollIds: [] });
    }

    /** @type {string[]} */
    const statsInRoll = [];
    rolls.forEach(roll => {
        const stat = String(roll.source || '').match(STAT_SOURCE_RE)?.[1];
        if (stat && !statsInRoll.includes(stat)) statsInRoll.push(stat);
    });
    statsInRoll.forEach(stat => {
        if (!boostAnyStat && !boostStats.has(stat.toUpperCase())) return;
        const rollIds = unmaxedRollIds(roll => roll.source === `Stat (${stat})`);
        if (rollIds.length === 0) return;
        options.push({ id: `boost:${stat}`, ability: 'boost', label: `Boost: maximize ${stat} dice`, rollIds });
    });

    activeTiles.forEach(tile => {
        if (!activeParsedTags(tile).some(parsed => parsed.base === 'enhanced')) return;
        const name = tile.name || '';
        const rollIds = unmaxedRollIds(roll => isCalledTileRoll(roll, tile) || roll.source === `Burn (${name})`);
        if (rollIds.length === 0) return;
        options.push({ id: `enhanced:${tile.id}`, ability: 'enhanced', label: `Enhanced: maximize ${name || 'tile'} dice`, rollIds });
    });

    return options;
}

// Shadow spends that change the current roll (p.59): "While Neutral or
// Rising, a character may spend 1 Shadow to… add max Shadow to a test" and
// "While Neutral or Falling… add max Shadow to impact". Availability uses
// the character sheet's Aberration classification. "A test" is read as the
// current check, so the bonus lands in the mode's primary bucket (action,
// attack, evasion, or diagnosis); impact exists only in attack mode. Each
// is one spend per check ("a test"). "Pay for a Press" and "add a color to
// a tile for one check" act outside the resolution screen (Press tracker,
// call colors) and are only listed as reminders by the UI.
/**
 * @param {{aberration?: number, maxShadow?: number, tagCounts?: object, mode?: string, spent?: string[]}} options
 * @returns {Array<{id: 'qi-test'|'id-impact', label: string}>}
 */
export function getShadowRollSpendOptions({ aberration = 0, maxShadow = 0, tagCounts = {}, mode = 'action', spent = [] } = {}) {
    if (maxShadow <= 0) return [];
    const available = new Set(getAvailableShadowAbilities(aberration, maxShadow, tagCounts).map(ability => ability.id));
    /** @type {Array<{id: 'qi-test'|'id-impact', label: string}>} */
    const options = [];
    if (available.has('qi-test') && !spent.includes('qi-test')) {
        options.push({ id: 'qi-test', label: `Qi: add max Shadow (+${maxShadow}) to this test` });
    }
    if (available.has('id-impact') && mode === 'attack' && !spent.includes('id-impact')) {
        options.push({ id: 'id-impact', label: `Id: add max Shadow (+${maxShadow}) to impact` });
    }
    return options;
}

/**
 * Totals from resource spends recorded on the result:
 * result.shadowSpends ([{id: 'qi-test'|'id-impact', amount}]) and
 * result.coreSoak (Machine). A spend that does not fit the current mode is
 * reported as unused rather than dropped silently.
 * @param {import('./types.js').RollResult} result
 * @param {string} mode
 */
export function getResolutionSpendTotals(result, mode) {
    const totals = emptyModifierTotals();
    const details = [];
    const modeLabel = (RESOLUTION_MODES[mode] || RESOLUTION_MODES.action).label.toLowerCase();

    (result?.shadowSpends || []).forEach(spend => {
        const bucket = spend.id === 'qi-test'
            ? getPrimaryBonusBucket(mode)
            : (mode === 'attack' ? 'impact' : null);
        const label = spend.id === 'qi-test' ? 'Qi Shadow spend' : 'Id Shadow spend';
        if (!bucket) {
            details.push(`${label}: not used in ${modeLabel} resolution`);
            return;
        }
        totals[bucket] += spend.amount;
        details.push(`${label}: +${spend.amount} ${bucket}`);
    });

    if (result?.coreSoak) {
        if (mode === 'defense') {
            totals.soak += result.coreSoak;
            details.push(`Machine Core spend: +${result.coreSoak} soak`);
        } else {
            details.push(`Machine Core spend: not used in ${modeLabel} resolution`);
        }
    }

    return { totals, details };
}

/**
 * Tag bonuses, called-tile modifiers, and resource spends merged into one
 * set of totals (and one detail list) for the resolution summary.
 * @param {import('./types.js').RollResult} result
 * @param {string} mode
 * @param {any[]} calledTiles
 */
export function getResolutionModifierTotals(result, mode, calledTiles = []) {
    const parts = [
        getResolutionBonusTotals(result, mode),
        getCalledTileModifiers(calledTiles, mode),
        getResolutionSpendTotals(result, mode)
    ];
    const totals = emptyModifierTotals();
    parts.forEach(part => {
        Object.entries(part.totals).forEach(([bucket, value]) => {
            totals[bucket] = (totals[bucket] || 0) + value;
        });
    });
    return { totals, details: parts.flatMap(part => part.details) };
}

// Test Chart (p.23: "how hard it is to accomplish things").
export const TEST_CHART = [
    { label: 'Simple challenge', value: 4 },
    { label: 'Average', value: 8 },
    { label: 'Tough', value: 12 },
    { label: 'Heroic', value: 16 },
    { label: 'Epic', value: 20 },
    { label: 'Legendary', value: 24 }
];

// The chart names difficulties but never says whether a tie passes. Read as
// "meets the Test", matching the casting Test (p.48) and the Ammo Supply
// check ("equals or beats", p.72). `tier` names the chart row the Test
// falls in (Legendary is 24+).
export function evaluateActionTest(total, test) {
    const target = parseInt(String(test), 10);
    if (!Number.isFinite(target)) return null;
    const tier = [...TEST_CHART].reverse().find(entry => target >= entry.value) || null;
    return { test: target, passes: total >= target, margin: total - target, tier: tier ? tier.label : null };
}
