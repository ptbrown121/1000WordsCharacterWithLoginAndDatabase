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
// Time table. The first die applied needs a 3, the second a 4, the third a
// 5, etc. Dice are sorted descending so the player's spare dice are applied
// in their best order. Instant, Sustain, and Rite durations cannot be
// modified; modifications are one-use.
export function getRangeExtensionResults(result, assignments) {
    const values = [];
    (result.originalRolls || []).forEach((roll, index) => {
        if ((assignments[getRollId(roll, index)] || 'unused') === 'extend') values.push(roll.val);
    });
    values.sort((a, b) => b - a);

    const entries = values.map((val, index) => ({
        val,
        threshold: 3 + index,
        success: val >= 3 + index
    }));

    return { entries, increments: entries.filter(entry => entry.success).length };
}

// Chain cost (p.25): "Each maxed die used costs 1 resource." Counts dice
// contributed by chain-called tiles (source "Chain (...)") that rolled their
// maximum face. The resource (EN, RX, or HP) is the player's choice, so the
// UI reports the cost rather than auto-deducting it.
export function getChainMaxedDieCost(result) {
    const chainRolls = (result.originalRolls || [])
        .filter(roll => String(roll.source || '').startsWith('Chain ('));
    const maxedCount = chainRolls.filter(roll => {
        const faces = parseInt(String(roll.die || '').replace('d', ''), 10);
        return Number.isFinite(faces) && roll.val === faces;
    }).length;

    return { chainDiceCount: chainRolls.length, maxedCount };
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
export function getDefaultResolutionAssignments(result, mode) {
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
