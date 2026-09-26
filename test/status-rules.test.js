import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    CRIT_DASHBOARD,
    calculatePressCost,
    getCritPoolEffects,
    getStatusConditions,
    getWoundPenalty,
    normalizeActiveCrits
} from '../js/status-rules.js';

describe('CRIT_DASHBOARD', () => {
    it('covers all fifteen crits across fast/sticky/special kinds', () => {
        assert.equal(CRIT_DASHBOARD.length, 15);
        const byKind = (kind) => CRIT_DASHBOARD.filter(crit => crit.kind === kind).map(crit => crit.id);
        assert.deepEqual(byKind('fast'), ['jolt', 'slow', 'down', 'pain']);
        assert.deepEqual(byKind('sticky'), ['bleed', 'wound']);
        assert.equal(byKind('special').length, 9);
    });
});

describe('normalizeActiveCrits', () => {
    it('lowercases ids, drops unknown crits and non-positive counts', () => {
        assert.deepEqual(
            normalizeActiveCrits({ WOUND: 2, jolt: '1', nonsense: 3, bleed: 0, fear: -2 }),
            { wound: 2, jolt: 1 }
        );
    });

    it('returns an empty map for arrays, null, and non-objects', () => {
        assert.deepEqual(normalizeActiveCrits(null), {});
        assert.deepEqual(normalizeActiveCrits(['wound']), {});
        assert.deepEqual(normalizeActiveCrits('wound'), {});
    });
});

describe('getStatusConditions (p.43)', () => {
    const ids = (pools) => getStatusConditions(pools).map(condition => condition.id);

    it('reports no conditions while all pools are positive', () => {
        assert.deepEqual(ids({ hp: 5, en: 3, rx: 1 }), []);
    });

    it('reports single-pool conditions', () => {
        assert.deepEqual(ids({ hp: 5, en: 0, rx: 4 }), ['fatigued']);
        assert.deepEqual(ids({ hp: 5, en: 3, rx: 0 }), ['cornered']);
        assert.deepEqual(ids({ hp: 0, en: 3, rx: 4 }), ['riven']);
    });

    it('reports combined conditions alongside their components', () => {
        assert.deepEqual(ids({ hp: 5, en: 0, rx: 0 }), ['exhausted', 'cornered', 'fatigued']);
        assert.deepEqual(ids({ hp: 0, en: 0, rx: 4 }), ['unconscious', 'riven', 'fatigued']);
        assert.deepEqual(ids({ hp: 0, en: 3, rx: 0 }), ['paralyzed', 'riven', 'cornered']);
    });

    it('reports Death Is Near when all three pools are empty', () => {
        const result = ids({ hp: 0, en: 0, rx: 0 });
        assert.equal(result[0], 'death');
        assert.ok(result.includes('unconscious'));
        assert.ok(result.includes('paralyzed'));
        assert.ok(result.includes('exhausted'));
    });

    it('treats missing and non-numeric values as 0', () => {
        assert.deepEqual(ids({}), ['death', 'unconscious', 'paralyzed', 'exhausted', 'riven', 'cornered', 'fatigued']);
    });
});

describe('getCritPoolEffects', () => {
    it('flags FEAR and GOAD from the active crits (p.40)', () => {
        assert.deepEqual(getCritPoolEffects({}), { fear: false, goad: false });
        assert.deepEqual(getCritPoolEffects({ fear: 1, jolt: 2 }), { fear: true, goad: false });
        assert.deepEqual(getCritPoolEffects({ GOAD: '1', fear: 0 }), { fear: false, goad: true });
        assert.deepEqual(getCritPoolEffects(null), { fear: false, goad: false });
    });
});

describe('getWoundPenalty', () => {
    it('charges -3 per active WOUND and ignores other crits', () => {
        assert.equal(getWoundPenalty({ wound: 2, jolt: 1 }), 6);
        assert.equal(getWoundPenalty({ jolt: 1 }), 0);
        assert.equal(getWoundPenalty(null), 0);
    });
});

describe('calculatePressCost (p.37)', () => {
    it('uses base costs of 1 RX for a Move and 2 RX for an Action', () => {
        assert.equal(calculatePressCost({ kind: 'move' }), 1);
        assert.equal(calculatePressCost({ kind: 'action' }), 2);
    });

    it('adds the press counter to either kind', () => {
        assert.equal(calculatePressCost({ kind: 'move', pressCount: 2 }), 3);
        assert.equal(calculatePressCost({ kind: 'action', pressCount: 1 }), 3);
    });

    it('matches the rulebook example: repeat on the second press costs 2 RX', () => {
        // Qwyn's second claw press: 2 (action) + 1 (counter) - 1 (repeat) = 2.
        assert.equal(calculatePressCost({ kind: 'action', pressCount: 1, repeatPrevious: true }), 2);
    });

    it('applies Fast (-1) and Recoil (+1) to Press Actions only', () => {
        assert.equal(calculatePressCost({ kind: 'action', fastWeapon: true }), 1);
        assert.equal(calculatePressCost({ kind: 'action', recoilWeapon: true }), 3);
        assert.equal(calculatePressCost({ kind: 'move', fastWeapon: true, recoilWeapon: true, repeatPrevious: true }), 1);
    });

    it('floors the cost at 1 RX', () => {
        assert.equal(calculatePressCost({ kind: 'action', repeatPrevious: true, fastWeapon: true }), 1);
    });
});
