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
    getChainMaxedDieCost,
    getCalledTileModifiers,
    getJoltGritPenalty,
    getRiskyHpLoss,
    getMaxedRollIds,
    getCyberFlawTriggers,
    getCoreRollSpendOptions,
    getShadowRollSpendOptions,
    getResolutionSpendTotals,
    getResolutionModifierTotals,
    TEST_CHART,
    evaluateActionTest
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

function tile(name, dice, tags, overrides = {}) {
    return { id: `id-${name}`, name, type: 'Gear', dice, tags, ...overrides };
}

describe('getCalledTileModifiers', () => {
    it('Piercing and Blinding lower the foe\'s soak and evasion by the tile\'s ▟ in attack mode', () => {
        const blade = tile('Blade', ['d6', 'd4'], ['Detail: Piercing', 'Blinding']);
        const mods = getCalledTileModifiers([blade], 'attack');
        assert.equal(mods.totals.foeSoak, 3);
        assert.equal(mods.totals.foeEvasion, 3);
        assert.deepEqual(mods.details, [
            'Piercing from Blade: -3 foe\'s soak',
            'Blinding from Blade: -3 foe\'s evasion'
        ]);
    });

    it('ignores Piercing outside attack mode', () => {
        const blade = tile('Blade', ['d6'], ['Piercing']);
        const mods = getCalledTileModifiers([blade], 'defense');
        assert.equal(mods.totals.foeSoak, 0);
        assert.deepEqual(mods.details, []);
    });

    it('Loose adds the tile\'s ▟ to Evasion in defense mode', () => {
        const jacket = tile('Jacket', ['d8'], ['Detail: Loose']);
        const mods = getCalledTileModifiers([jacket], 'defense');
        assert.equal(mods.totals.evasion, 3);
        assert.equal(mods.totals.grit, 0);
    });

    it('applies the Old, Worn, and Primitive flaws automatically in their modes', () => {
        const armor = tile('Plate', ['d6'], ['Flaw: Old']);
        const pistol = tile('Pistol', ['d6'], ['Worn', 'Detail: Primitive']);
        const defense = getCalledTileModifiers([armor, pistol], 'defense');
        assert.equal(defense.totals.grit, -3);
        assert.deepEqual(defense.details, ['Old flaw on Plate: -3 grit']);

        const attack = getCalledTileModifiers([armor, pistol], 'attack');
        assert.equal(attack.totals.attack, -3);
        assert.equal(attack.totals.impact, -3);
        assert.equal(attack.totals.grit, 0);
    });

    it('turns broken gear tags off', () => {
        const blade = tile('Blade', ['d6'], ['Piercing', 'Worn'], { gearBroken: true });
        const mods = getCalledTileModifiers([blade], 'attack');
        assert.equal(mods.totals.foeSoak, 0);
        assert.equal(mods.totals.attack, 0);
    });

    it('does not apply a Crit-prefixed Piercing', () => {
        const blade = tile('Blade', ['d6'], ['Crit: Piercing']);
        assert.equal(getCalledTileModifiers([blade], 'attack').totals.foeSoak, 0);
    });
});

describe('getJoltGritPenalty', () => {
    it('is 3 Grit per active JOLT', () => {
        assert.equal(getJoltGritPenalty(0), 0);
        assert.equal(getJoltGritPenalty(2), 6);
        assert.equal(getJoltGritPenalty(undefined), 0);
    });
});

describe('getRiskyHpLoss', () => {
    it('counts 1s on the called Risky tile\'s own dice', () => {
        const res = result([
            { source: 'Stat (BODY)', die: 'd6', val: 1 },
            { source: 'Tile (Grenade)', die: 'd6', val: 1 },
            { source: 'Tile (Grenade)', die: 'd4', val: 1 },
            { source: 'Tile (Grenade)', die: 'd4', val: 3 }
        ]);
        const risky = getRiskyHpLoss(res, [tile('Grenade', ['d6', 'd4', 'd4'], ['Single', 'Risky'])]);
        assert.equal(risky.total, 2);
        assert.deepEqual(risky.entries.map(entry => [entry.tileName, entry.ones]), [['Grenade', 2]]);
    });

    it('counts chained Risky tiles but not burned dice', () => {
        const res = result([
            { source: 'Chain (Sonic Blade)', die: 'd6', val: 1 },
            { source: 'Burn (Sonic Blade)', die: 'd6', val: 1 }
        ]);
        assert.equal(getRiskyHpLoss(res, [tile('Sonic Blade', ['d6'], ['Risky'])]).total, 1);
    });

    it('is zero without Risky or without 1s', () => {
        const res = result([{ source: 'Tile (Blade)', die: 'd6', val: 1 }]);
        assert.equal(getRiskyHpLoss(res, [tile('Blade', ['d6'], ['Sharp'])]).total, 0);
        const noOnes = result([{ source: 'Tile (Blade)', die: 'd6', val: 2 }]);
        assert.equal(getRiskyHpLoss(noOnes, [tile('Blade', ['d6'], ['Risky'])]).total, 0);
    });
});

describe('getCyberFlawTriggers', () => {
    const arm = (tags) => tile('Arm', ['d8'], tags);

    it('fires Feedback and Rube once when any die in the check rolls a 1', () => {
        const res = result([
            { source: 'Stat (BODY)', die: 'd6', val: 1 },
            { source: 'Stat (BODY)', die: 'd6', val: 1 },
            { source: 'Tile (Arm)', die: 'd8', val: 5 }
        ]);
        const triggers = getCyberFlawTriggers(res, [arm(['Cyber', 'Feedback', 'Rube'])]);
        assert.deepEqual(triggers.map(entry => [entry.name, entry.effect]), [
            ['Feedback', 'take SLOW'],
            ['Rube', 'take DOWN']
        ]);
    });

    it('fires the haywire flaws only on a haywire check; Torn deals the tile\'s ▟ HP', () => {
        const tags = ['Overload', 'Solo', 'Torn', 'Undroid'];
        const calm = result([{ source: 'Tile (Arm)', die: 'd8', val: 5 }]);
        assert.deepEqual(getCyberFlawTriggers(calm, [arm(tags)]), []);

        const haywire = result([{ source: 'Tile (Arm)', die: 'd8', val: 5 }], { isHaywire: true });
        const triggers = getCyberFlawTriggers(haywire, [arm(tags)]);
        assert.deepEqual(triggers.map(entry => entry.effect), ['take PAIN', 'take FEAR', 'lose 3 HP', 'take WOUND']);
        assert.equal(triggers.find(entry => entry.tag === 'torn').hp, 3);
    });

    it('fires Numb on maxed dice and lists them', () => {
        const res = result([
            { source: 'Stat (MIND)', die: 'd6', val: 6 },
            { source: 'Tile (Arm)', die: 'd8', val: 8 },
            { source: 'Tile (Arm)', die: 'd8', val: 3 }
        ]);
        assert.deepEqual(getMaxedRollIds(res), ['0', '1']);
        const [numb] = getCyberFlawTriggers(res, [arm(['Numb'])]);
        assert.equal(numb.name, 'Numb');
        assert.deepEqual(numb.maxedRollIds, ['0', '1']);
    });

    it('ignores flaws on tiles that were not called and on broken gear', () => {
        const res = result([{ source: 'Stat (BODY)', die: 'd6', val: 1 }], { isHaywire: true });
        assert.deepEqual(getCyberFlawTriggers(res, []), []);
        const broken = tile('Arm', ['d8'], ['Feedback'], { gearBroken: true });
        assert.deepEqual(getCyberFlawTriggers(res, [broken]), []);
    });
});

describe('getCoreRollSpendOptions', () => {
    const roll = result([
        { source: 'Stat (BODY)', die: 'd6', val: 2 },
        { source: 'Stat (MIND)', die: 'd6', val: 6 },
        { source: 'Tile (Arm)', die: 'd8', val: 3 },
        { source: 'Tile (Arm)', die: 'd4', val: 4 }
    ]);

    it('offers nothing without the Core tags', () => {
        assert.deepEqual(getCoreRollSpendOptions(roll, [tile('Arm', ['d8', 'd4'], ['Cyber'])], 'defense'), []);
    });

    it('offers Machine only in defense mode and only once', () => {
        const tiles = [tile('Chassis', ['d6'], ['Cyber', 'Machine'])];
        assert.deepEqual(getCoreRollSpendOptions(roll, tiles, 'defense').map(option => option.id), ['machine']);
        assert.deepEqual(getCoreRollSpendOptions(roll, tiles, 'attack'), []);
        assert.deepEqual(getCoreRollSpendOptions({ ...roll, coreSoak: 2 }, tiles, 'defense'), []);
    });

    it('offers bare Boost for every stat with unmaxed dice in the roll', () => {
        const tiles = [tile('Core', ['d6'], ['Cyber', 'Boost'])];
        const options = getCoreRollSpendOptions(roll, tiles, 'action');
        // MIND's only die is already maxed, so only BODY is offered.
        assert.deepEqual(options.map(option => [option.id, option.rollIds]), [['boost:BODY', ['0']]]);
    });

    it('limits "Boost: STAT" to that stat', () => {
        const tiles = [tile('Core', ['d6'], ['Cyber', 'Boost: MIND'])];
        assert.deepEqual(getCoreRollSpendOptions(roll, tiles, 'action'), []);
        const bodyTiles = [tile('Core', ['d6'], ['Boost: body'])];
        assert.deepEqual(getCoreRollSpendOptions(roll, bodyTiles, 'action').map(option => option.id), ['boost:BODY']);
    });

    it('offers Enhanced for the tile\'s own unmaxed dice', () => {
        const tiles = [tile('Arm', ['d8', 'd4'], ['Cyber', 'Enhanced'])];
        const options = getCoreRollSpendOptions(roll, tiles, 'attack');
        assert.deepEqual(options.map(option => [option.id, option.rollIds]), [['enhanced:id-Arm', ['2']]]);
    });

    it('skips Enhanced tiles whose dice are not in the roll, and buried tiles', () => {
        assert.deepEqual(getCoreRollSpendOptions(roll, [tile('Leg', ['d6'], ['Enhanced'])], 'action'), []);
        const buried = tile('Arm', ['d8', 'd4'], ['Enhanced'], { isBuried: true });
        assert.deepEqual(getCoreRollSpendOptions(roll, [buried], 'action'), []);
    });
});

describe('getShadowRollSpendOptions', () => {
    it('offers both spends at Neutral, impact only in attack mode', () => {
        assert.deepEqual(getShadowRollSpendOptions({ aberration: 0, maxShadow: 4, mode: 'attack' }).map(option => option.id),
            ['qi-test', 'id-impact']);
        assert.deepEqual(getShadowRollSpendOptions({ aberration: 0, maxShadow: 4, mode: 'action' }).map(option => option.id),
            ['qi-test']);
    });

    it('follows alignment: Rising cannot add to impact, Falling cannot add to a test', () => {
        assert.deepEqual(getShadowRollSpendOptions({ aberration: 2, maxShadow: 4, mode: 'attack' }).map(option => option.id),
            ['qi-test']);
        assert.deepEqual(getShadowRollSpendOptions({ aberration: -2, maxShadow: 4, mode: 'attack' }).map(option => option.id),
            ['id-impact']);
    });

    it('is once per check and needs a Shadow pool', () => {
        assert.deepEqual(getShadowRollSpendOptions({ maxShadow: 4, mode: 'attack', spent: ['qi-test', 'id-impact'] }), []);
        assert.deepEqual(getShadowRollSpendOptions({ maxShadow: 0, mode: 'attack' }), []);
    });
});

describe('getResolutionSpendTotals', () => {
    it('puts a Qi test spend in the mode\'s primary bucket and an Id spend on impact', () => {
        const res = result([], { shadowSpends: [{ id: 'qi-test', amount: 4 }, { id: 'id-impact', amount: 4 }] });
        const attack = getResolutionSpendTotals(res, 'attack');
        assert.equal(attack.totals.attack, 4);
        assert.equal(attack.totals.impact, 4);

        const defense = getResolutionSpendTotals(res, 'defense');
        assert.equal(defense.totals.evasion, 4);
        assert.equal(defense.totals.impact, 0);
        assert.ok(defense.details.includes('Id Shadow spend: not used in defense resolution'));
    });

    it('adds Machine Core soak in defense mode only', () => {
        const res = result([], { coreSoak: 3 });
        assert.equal(getResolutionSpendTotals(res, 'defense').totals.soak, 3);
        assert.equal(getResolutionSpendTotals(res, 'attack').totals.soak, 0);
    });
});

describe('getResolutionModifierTotals', () => {
    it('merges tag bonuses, called-tile modifiers, and spends', () => {
        const res = result([], {
            appliedTagBonuses: [{ tag: 'Keen', sourceTileName: 'Blade', steps: 2, context: 'attack' }],
            shadowSpends: [{ id: 'qi-test', amount: 3 }]
        });
        const merged = getResolutionModifierTotals(res, 'attack', [tile('Blade', ['d6'], ['Worn', 'Piercing'])]);
        assert.equal(merged.totals.attack, 2 - 3 + 3);
        assert.equal(merged.totals.foeSoak, 2);
        assert.deepEqual(merged.details, [
            'Keen from Blade: +2 attack',
            'Worn flaw on Blade: -3 attack',
            'Piercing from Blade: -2 foe\'s soak',
            'Qi Shadow spend: +3 attack'
        ]);
    });
});

describe('evaluateActionTest', () => {
    it('lists the p.23 Test Chart', () => {
        assert.deepEqual(TEST_CHART.map(entry => entry.value), [4, 8, 12, 16, 20, 24]);
    });

    it('passes when the total meets the Test', () => {
        assert.deepEqual(evaluateActionTest(12, 12), { test: 12, passes: true, margin: 0, tier: 'Tough' });
        assert.deepEqual(evaluateActionTest(10, '16'), { test: 16, passes: false, margin: -6, tier: 'Heroic' });
    });

    it('names Legendary for 24 and above and no tier below Simple', () => {
        assert.equal(evaluateActionTest(30, 28).tier, 'Legendary');
        assert.equal(evaluateActionTest(3, 2).tier, null);
    });

    it('returns null without a Test', () => {
        assert.equal(evaluateActionTest(10, ''), null);
        assert.equal(evaluateActionTest(10, null), null);
    });
});
