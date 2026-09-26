import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    RESOLUTION_MODES,
    HEALING_TARGETS,
    RESOLUTION_PLUS_BUCKETS,
    getRollId,
    getDefaultResolutionAssignments,
    getAssignmentOptions,
    getPrimaryBonusBucket,
    getResolutionBonusTotals,
    calculateAssignedTotals,
    calculateResolutionPlusUsage,
    getHealingAssignments,
    applyShieldsToCrits,
    parseCritList,
    getRangeExtensionResults,
    getChainMaxedDieCost
} from '../js/resolution-rules.js';

// Roll factory: roll[i] gets implicit id=String(i) so tests can build
// assignment maps with predictable keys.
function rolls(...vals) {
    return vals.map((val, i) => ({ die: 'd6', val, source: `src${i}` }));
}

function result(originalRolls, overrides = {}) {
    return {
        originalRolls,
        adds: 2,
        flatBonus: 0,
        appliedTagBonuses: [],
        ...overrides
    };
}

// Build an assignment map from a list of slot names matching originalRolls
// by index, e.g. assignmentsFor(rolls, ['attack', 'impact', 'unused']).
function assignmentsFor(originalRolls, slots) {
    const out = {};
    originalRolls.forEach((roll, i) => {
        out[getRollId(roll, i)] = slots[i];
    });
    return out;
}

describe('getRollId', () => {
    it('uses the roll id when present', () => {
        assert.equal(getRollId({ id: 'abc' }, 99), 'abc');
    });
    it('falls back to the index when id is missing', () => {
        assert.equal(getRollId({}, 3), '3');
    });
    it('falls back when id is null', () => {
        assert.equal(getRollId({ id: null }, 7), '7');
    });
    it('coerces numeric ids to strings so map lookups work', () => {
        assert.equal(getRollId({ id: 42 }, 0), '42');
    });
});

describe('getAssignmentOptions', () => {
    it('returns the mode-specific options', () => {
        assert.deepEqual(
            getAssignmentOptions('attack').map(o => o.value),
            ['attack', 'impact', 'extend', 'unused']
        );
    });
    it('falls back to action options for an unknown mode', () => {
        assert.deepEqual(
            getAssignmentOptions('nonsense').map(o => o.value),
            ['action', 'unused']
        );
    });
});

describe('getPrimaryBonusBucket', () => {
    it('returns expected buckets for each known mode', () => {
        assert.equal(getPrimaryBonusBucket('action'), 'action');
        assert.equal(getPrimaryBonusBucket('attack'), 'attack');
        assert.equal(getPrimaryBonusBucket('defense'), 'evasion');
        assert.equal(getPrimaryBonusBucket('healing'), 'diagnosis');
    });
    it('returns action as the default for unknown modes', () => {
        assert.equal(getPrimaryBonusBucket('weird'), 'action');
    });
});

describe('getDefaultResolutionAssignments', () => {
    it('action mode: assigns the top `adds` rolls to action, rest to unused', () => {
        const r = result(rolls(1, 6, 3, 4), { adds: 2 });
        const out = getDefaultResolutionAssignments(r, 'action');
        // Sorted desc: roll[1]=6, roll[3]=4 win the keep slots.
        assert.equal(out['1'], 'action');
        assert.equal(out['3'], 'action');
        assert.equal(out['0'], 'unused');
        assert.equal(out['2'], 'unused');
    });

    it('attack mode with adds>=2 puts the lowest keep on impact', () => {
        const r = result(rolls(2, 6, 4), { adds: 2 });
        const out = getDefaultResolutionAssignments(r, 'attack');
        // Sorted desc: roll[1]=6 (top -> attack), roll[2]=4 (last keep -> impact).
        assert.equal(out['1'], 'attack');
        assert.equal(out['2'], 'impact');
        assert.equal(out['0'], 'unused');
    });

    it('attack mode with adds=1 puts the single keep on attack (no impact)', () => {
        const r = result(rolls(2, 6), { adds: 1 });
        const out = getDefaultResolutionAssignments(r, 'attack');
        assert.equal(out['1'], 'attack');
        assert.equal(out['0'], 'unused');
    });

    it('defense mode mirrors attack with evasion/grit', () => {
        const r = result(rolls(2, 6, 4), { adds: 2 });
        const out = getDefaultResolutionAssignments(r, 'defense');
        assert.equal(out['1'], 'evasion');
        assert.equal(out['2'], 'grit');
        assert.equal(out['0'], 'unused');
    });

    it('healing mode keeps every kept die on diagnosis (no per-slot split)', () => {
        const r = result(rolls(2, 6, 4), { adds: 2 });
        const out = getDefaultResolutionAssignments(r, 'healing');
        assert.equal(out['1'], 'diagnosis');
        assert.equal(out['2'], 'diagnosis');
        assert.equal(out['0'], 'unused');
    });

    it('defaults adds to 2 when result.adds is missing', () => {
        const r = { originalRolls: rolls(1, 6, 3) };
        const out = getDefaultResolutionAssignments(r, 'action');
        const usedCount = Object.values(out).filter(s => s !== 'unused').length;
        assert.equal(usedCount, 2);
    });

    it('handles an empty roll set without crashing', () => {
        assert.deepEqual(getDefaultResolutionAssignments(result([]), 'action'), {});
    });
});

describe('calculateAssignedTotals', () => {
    it('sums each roll into its assigned bucket', () => {
        const r = result(rolls(3, 6, 4));
        const a = assignmentsFor(r.originalRolls, ['attack', 'attack', 'unused']);
        assert.deepEqual(
            calculateAssignedTotals(r, a),
            { totals: { attack: 9, unused: 4 }, usedCount: 2 }
        );
    });

    it('treats missing entries as unused', () => {
        const r = result(rolls(2, 5));
        const partial = { '0': 'action' }; // roll[1] has no entry
        const out = calculateAssignedTotals(r, partial);
        assert.equal(out.totals.action, 2);
        assert.equal(out.totals.unused, 5);
        assert.equal(out.usedCount, 1);
    });

    it('returns zeroed totals for an empty roll set', () => {
        assert.deepEqual(
            calculateAssignedTotals(result([]), {}),
            { totals: {}, usedCount: 0 }
        );
    });
});

describe('calculateResolutionPlusUsage', () => {
    it('returns 0/budget for action mode (no plus-bucket math)', () => {
        const r = result(rolls(6, 4, 2), { adds: 2 });
        const a = assignmentsFor(r.originalRolls, ['action', 'action', 'unused']);
        assert.deepEqual(
            calculateResolutionPlusUsage(r, 'action', a),
            { used: 0, budget: 1, bucketCounts: {} }
        );
    });

    it('charges no pluses when each bucket has at most one die', () => {
        const r = result(rolls(6, 4), { adds: 2 });
        const a = assignmentsFor(r.originalRolls, ['attack', 'impact']);
        const out = calculateResolutionPlusUsage(r, 'attack', a);
        assert.equal(out.used, 0);
        assert.equal(out.budget, 1);
        assert.deepEqual(out.bucketCounts, { attack: 1, impact: 1 });
    });

    it('charges one plus per extra die piled into a single bucket', () => {
        // 3 dice all on attack: 1 free + 2 pluses charged.
        const r = result(rolls(6, 4, 2), { adds: 3 });
        const a = assignmentsFor(r.originalRolls, ['attack', 'attack', 'attack']);
        const out = calculateResolutionPlusUsage(r, 'attack', a);
        assert.equal(out.used, 2);
        assert.equal(out.budget, 2);
        assert.deepEqual(out.bucketCounts, { attack: 3 });
    });

    it('sums pluses across both buckets in dual-bucket modes', () => {
        // 2 attack + 2 impact = 1 plus from each bucket = 2 used.
        const r = result(rolls(6, 5, 4, 3), { adds: 4 });
        const a = assignmentsFor(r.originalRolls, ['attack', 'attack', 'impact', 'impact']);
        const out = calculateResolutionPlusUsage(r, 'attack', a);
        assert.equal(out.used, 2);
        assert.equal(out.budget, 3);
    });

    it('ignores non-bucket assignments like "unused"', () => {
        const r = result(rolls(6, 4, 2), { adds: 2 });
        const a = assignmentsFor(r.originalRolls, ['attack', 'unused', 'unused']);
        const out = calculateResolutionPlusUsage(r, 'attack', a);
        assert.equal(out.used, 0);
        assert.deepEqual(out.bucketCounts, { attack: 1 });
    });

    it('budget is 0 when result.adds is 0 (nullish coalescing preserves explicit zero)', () => {
        const r = result(rolls(6), { adds: 0 });
        assert.equal(calculateResolutionPlusUsage(r, 'attack', {}).budget, 0);
        assert.equal(calculateResolutionPlusUsage(r, 'action', {}).budget, 0);
    });
});

describe('getResolutionBonusTotals', () => {
    function bonus(overrides) {
        return {
            tag: 'Tag',
            sourceTileName: 'Source',
            steps: 1,
            context: 'Action',
            ...overrides
        };
    }

    it('routes Action-context bonuses to the action bucket', () => {
        const r = result([], {
            appliedTagBonuses: [bonus({ context: 'Action', steps: 2 })]
        });
        const out = getResolutionBonusTotals(r, 'action');
        assert.equal(out.totals.action, 2);
        assert.equal(out.totals.attack, 0);
    });

    it('routes attack-context bonuses only when in attack mode', () => {
        const r = result([], {
            appliedTagBonuses: [bonus({ context: 'Attack roll', steps: 3 })]
        });
        const inAttack = getResolutionBonusTotals(r, 'attack');
        assert.equal(inAttack.totals.attack, 3);
        const inDefense = getResolutionBonusTotals(r, 'defense');
        assert.equal(inDefense.totals.attack, 0);
        // The bonus is reported in details so the user knows why.
        assert.match(inDefense.details[0], /not used in defense resolution/);
    });

    it('routes damage- or impact-context bonuses to impact in attack mode', () => {
        const r = result([], {
            appliedTagBonuses: [
                bonus({ tag: 'A', context: 'Damage', steps: 2 }),
                bonus({ tag: 'B', context: 'Impact', steps: 1 })
            ]
        });
        const out = getResolutionBonusTotals(r, 'attack');
        assert.equal(out.totals.impact, 3);
    });

    it('routes evasion / detection / grit / soak in defense mode', () => {
        const r = result([], {
            appliedTagBonuses: [
                bonus({ tag: 'E', context: 'Evasion bonus', steps: 1 }),
                bonus({ tag: 'D', context: 'Detection', steps: 1 }),
                bonus({ tag: 'G', context: 'Grit', steps: 2 }),
                bonus({ tag: 'S', context: 'Soak', steps: 3 })
            ]
        });
        const out = getResolutionBonusTotals(r, 'defense');
        assert.equal(out.totals.evasion, 2);
        assert.equal(out.totals.grit, 2);
        assert.equal(out.totals.soak, 3);
    });

    it('lands flat bonus on the primary bucket for the mode', () => {
        const r = result([], { flatBonus: 4 });
        assert.equal(getResolutionBonusTotals(r, 'action').totals.action, 4);
        assert.equal(getResolutionBonusTotals(r, 'attack').totals.attack, 4);
        assert.equal(getResolutionBonusTotals(r, 'defense').totals.evasion, 4);
        assert.equal(getResolutionBonusTotals(r, 'healing').totals.diagnosis, 4);
    });

    it('reports unmatched bonuses in details rather than silently dropping them', () => {
        const r = result([], {
            appliedTagBonuses: [bonus({ tag: 'Weird', context: 'Pyromancy', steps: 99 })]
        });
        const out = getResolutionBonusTotals(r, 'attack');
        // No bucket gained anything from the unknown context.
        assert.equal(Object.values(out.totals).every(v => v === 0), true);
        assert.equal(out.details.length, 1);
        assert.match(out.details[0], /not used in attack resolution/);
    });

    it("a context-less bonus in action mode lands on the action bucket", () => {
        // Action mode short-circuits before checking context.includes(),
        // so any applied bonus contributes to the action total.
        const r = result([], {
            appliedTagBonuses: [bonus({ context: '', steps: 5 })]
        });
        assert.equal(getResolutionBonusTotals(r, 'action').totals.action, 5);
    });
});

describe('getHealingAssignments', () => {
    it('groups dice by healing target with both amount and count', () => {
        const r = result(rolls(3, 5, 4));
        const a = assignmentsFor(r.originalRolls, ['heal_health', 'heal_health', 'wound']);
        const out = getHealingAssignments(r, a);
        assert.equal(out.heal_health.amount, 8);
        assert.equal(out.heal_health.count, 2);
        assert.equal(out.heal_health.kind, 'resource');
        assert.equal(out.wound.amount, 4);
        assert.equal(out.wound.count, 1);
        assert.equal(out.wound.kind, 'count');
    });

    it('ignores non-healing assignments', () => {
        const r = result(rolls(3, 5));
        const a = assignmentsFor(r.originalRolls, ['diagnosis', 'unused']);
        // diagnosis is intentionally not in HEALING_TARGETS - it is the
        // primary roll bucket, separate from the assignable healing slots.
        assert.deepEqual(getHealingAssignments(r, a), {});
    });

    it('returns empty for empty rolls', () => {
        assert.deepEqual(getHealingAssignments(result([]), {}), {});
    });
});

describe('static maps', () => {
    it('RESOLUTION_MODES and HEALING_TARGETS are present and well-formed', () => {
        assert.ok(RESOLUTION_MODES.action && RESOLUTION_MODES.attack);
        assert.equal(typeof HEALING_TARGETS.wound.difficulty, 'number');
    });

    it('RESOLUTION_PLUS_BUCKETS contains the dual-bucket modes only', () => {
        assert.ok(RESOLUTION_PLUS_BUCKETS.attack instanceof Set);
        assert.ok(RESOLUTION_PLUS_BUCKETS.defense instanceof Set);
        assert.ok(RESOLUTION_PLUS_BUCKETS.healing instanceof Set);
        // Action mode is NOT in this map - that's how the UI knows to skip
        // plus accounting.
        assert.equal(RESOLUTION_PLUS_BUCKETS.action, undefined);
    });
});

describe('parseCritList', () => {
    it('splits free text into lowercased crit names', () => {
        assert.deepEqual(parseCritList('BLEED, DOWN'), ['bleed', 'down']);
        assert.deepEqual(parseCritList(' jolt;KO / Fear '), ['jolt', 'ko', 'fear']);
        assert.deepEqual(parseCritList(''), []);
        assert.deepEqual(parseCritList(null), []);
    });
});

describe('applyShieldsToCrits', () => {
    it('blocks matching crits one-for-one and passes the rest', () => {
        const { blocked, remaining } = applyShieldsToCrits(['jolt', 'down'], ['jolt']);
        assert.deepEqual(blocked, ['jolt']);
        assert.deepEqual(remaining, ['down']);
    });

    it('consumes one shield per blocked crit', () => {
        const { blocked, remaining } = applyShieldsToCrits(['jolt', 'jolt'], ['jolt']);
        assert.deepEqual(blocked, ['jolt']);
        assert.deepEqual(remaining, ['jolt']);
    });

    it('matches case-insensitively and handles empty inputs', () => {
        const { blocked, remaining } = applyShieldsToCrits(['JOLT'], ['jolt']);
        assert.deepEqual(blocked, ['JOLT']);
        assert.deepEqual(remaining, []);
        assert.deepEqual(applyShieldsToCrits([], ['jolt']).blocked, []);
        assert.deepEqual(applyShieldsToCrits(['down'], []).remaining, ['down']);
    });
});

describe('getRangeExtensionResults', () => {
    it('applies dice lowest-first against escalating thresholds (3, 4, 5...)', () => {
        const res = result(rolls(2, 5, 4, 6));
        const assignments = { 0: 'extend', 1: 'extend', 2: 'extend', 3: 'attack' };
        const { entries, increments } = getRangeExtensionResults(res, assignments);
        // extend dice are 2, 5, 4 -> 2 is not applied, then 4 vs 3, 5 vs 4.
        assert.deepEqual(entries, [
            { val: 2, threshold: 3, success: false },
            { val: 4, threshold: 3, success: true },
            { val: 5, threshold: 4, success: true }
        ]);
        assert.equal(increments, 2);
    });

    it('gives a 4 and a 3 two increments (p.53 primal burst example)', () => {
        const res = result(rolls(4, 3));
        const { entries, increments } = getRangeExtensionResults(res, { 0: 'extend', 1: 'extend' });
        assert.deepEqual(entries, [
            { val: 3, threshold: 3, success: true },
            { val: 4, threshold: 4, success: true }
        ]);
        assert.equal(increments, 2);
    });

    it('does not use up a threshold on a die that cannot meet it', () => {
        const res = result(rolls(3, 3, 4, 6));
        const assignments = { 0: 'extend', 1: 'extend', 2: 'extend', 3: 'extend' };
        const { entries, increments } = getRangeExtensionResults(res, assignments);
        // 3 vs 3 applied; the second 3 cannot meet 4; 4 vs 4; 6 vs 5.
        assert.deepEqual(entries.map(entry => [entry.val, entry.threshold, entry.success]), [
            [3, 3, true], [3, 4, false], [4, 4, true], [6, 5, true]
        ]);
        assert.equal(increments, 3);
    });

    it('returns no entries when nothing is assigned to extend', () => {
        const res = result(rolls(4, 5));
        const { entries, increments } = getRangeExtensionResults(res, { 0: 'attack', 1: 'impact' });
        assert.deepEqual(entries, []);
        assert.equal(increments, 0);
    });
});

describe('getChainMaxedDieCost', () => {
    it('prices every maxed die used in a chained check, not just chain-sourced dice', () => {
        const res = result([
            { source: 'Stat (MIND)', die: 'd6', val: 6 },
            { source: 'Tile (Kit)', die: 'd4', val: 4 },
            { source: 'Chain (Tinker)', die: 'd6', val: 5 },
            { source: 'Chain (Lore)', die: 'd6', val: 6 }
        ]);
        const cost = getChainMaxedDieCost(res, { 0: 'action', 1: 'action', 2: 'action', 3: 'action' });
        assert.equal(cost.chained, true);
        // The non-maxed chain d6 is not an entry; the maxed stat and call
        // tile dice are.
        assert.deepEqual(cost.entries.map(entry => [entry.rollId, entry.used]), [
            ['0', true], ['1', true], ['3', true]
        ]);
        assert.equal(cost.dueCount, 3);
    });

    it('excludes maxed dice left Unused from the due count', () => {
        const res = result([
            { source: 'Chain (Tinker)', die: 'd6', val: 6 },
            { source: 'Tile (Kit)', die: 'd8', val: 8 }
        ]);
        const cost = getChainMaxedDieCost(res, { 0: 'unused', 1: 'attack' });
        assert.equal(cost.dueCount, 1);
        assert.deepEqual(cost.entries.map(entry => entry.used), [false, true]);
    });

    it('treats unassigned dice as Unused', () => {
        const res = result([{ source: 'Chain (Lore)', die: 'd6', val: 6 }]);
        const cost = getChainMaxedDieCost(res, {});
        assert.equal(cost.dueCount, 0);
        assert.equal(cost.entries[0].used, false);
    });

    it('charges nothing on checks without chained dice, even with maxed dice used', () => {
        const cost = getChainMaxedDieCost(result(rolls(6, 6)), { 0: 'action', 1: 'action' });
        assert.equal(cost.chained, false);
        assert.deepEqual(cost.entries, []);
        assert.equal(cost.dueCount, 0);
    });
});
