import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PoolEngine } from '../js/pool.js';
import {
    DASH_DIFFICULTY,
    PACE_DISTANCE,
    calculateMovement,
    getBulkyTiles,
    getNimbleWalkBonus,
    getResourceMaxDrift,
    getSustainTracker,
    isSustainTile,
    normalizeActiveSustains,
    paySustainUpkeep,
    shiftResourceMaxesForTileChange
} from '../js/sheet-rules.js';

const engine = new PoolEngine();

const tile = (overrides = {}) => ({
    id: overrides.id || 't1',
    name: 'Tile',
    type: 'Skill',
    colors: ['Red', 'Blue'],
    dice: ['d4'],
    tags: [],
    ...overrides
});

describe('shiftResourceMaxesForTileChange', () => {
    it('follows a tile gain when the stored base matches the tiles', () => {
        const before = engine.calculateResourceMaxes([]);
        const tiles = [tile({ colors: ['Red', 'Orange'] })];
        const after = engine.calculateResourceMaxes(tiles);
        const { changed, patch } = shiftResourceMaxesForTileChange({ hp: 0, hpMax: 0, en: 0, enMax: 0, rx: 0, rxMax: 0 }, before, after);
        assert.equal(changed, true);
        assert.deepEqual(patch, { hpMax: 2 });
    });

    it('drops the max and clamps the current pool when a tile is buried', () => {
        const red = tile({ id: 'a', colors: ['Red', 'Red'] });
        const blue = tile({ id: 'b', colors: ['Blue', 'Red'] });
        const before = engine.calculateResourceMaxes([red, blue]);
        const after = engine.calculateResourceMaxes([{ ...red, isBuried: true }, blue]);
        const state = { hp: 3, hpMax: 3, hpPerm: 0, hpTemp: 0, rx: 1, rxMax: 1 };
        const { patch } = shiftResourceMaxesForTileChange(state, before, after);
        assert.deepEqual(patch, { hpMax: 1, hp: 1 });
    });

    it('keeps Perm and Temp bonuses in the clamp', () => {
        const { patch } = shiftResourceMaxesForTileChange(
            { hp: 6, hpMax: 4, hpPerm: 1, hpTemp: 1 },
            { hp: 4, en: 0, rx: 0 },
            { hp: 2, en: 0, rx: 0 }
        );
        // New effective max = 2 + 1 + 1 = 4.
        assert.deepEqual(patch, { hpMax: 2, hp: 4 });
    });

    it('does not refill the current pool when the max rises', () => {
        const { patch } = shiftResourceMaxesForTileChange(
            { en: 1, enMax: 2 },
            { hp: 0, en: 2, rx: 0 },
            { hp: 0, en: 4, rx: 0 }
        );
        assert.deepEqual(patch, { enMax: 4 });
    });

    it('preserves a hand-edited offset from older saves', () => {
        // Stored 10 while tiles gave 6: a +4 legacy edit survives the change.
        const { patch } = shiftResourceMaxesForTileChange(
            { rx: 10, rxMax: 10 },
            { hp: 0, en: 0, rx: 6 },
            { hp: 0, en: 0, rx: 4 }
        );
        assert.deepEqual(patch, { rxMax: 8, rx: 8 });
    });

    it('is a no-op when the tile-derived maxes do not move', () => {
        const maxes = { hp: 2, en: 2, rx: 2 };
        assert.deepEqual(shiftResourceMaxesForTileChange({ hpMax: 9 }, maxes, { ...maxes }), { changed: false, patch: {} });
    });

    it('never stores a negative base', () => {
        const { patch } = shiftResourceMaxesForTileChange(
            { hp: 0, hpMax: 1 },
            { hp: 3, en: 0, rx: 0 },
            { hp: 0, en: 0, rx: 0 }
        );
        assert.equal(patch.hpMax, 0);
    });
});

describe('getResourceMaxDrift', () => {
    it('lists only pools whose stored base differs from the tiles', () => {
        assert.deepEqual(
            getResourceMaxDrift({ hpMax: 5, enMax: '2', rxMax: 0 }, { hp: 4, en: 2, rx: 0 }),
            [{ key: 'hp', stored: 5, computed: 4 }]
        );
    });
});

describe('calculateMovement', () => {
    it('sets Walk to current Reflex, Run and Dash minimum to 3x Walk, Pace to 3', () => {
        const move = calculateMovement({ rx: 5 });
        assert.equal(move.walk, 5);
        assert.equal(move.run, 15);
        assert.equal(move.dashMinimum, 15);
        assert.equal(move.pace, PACE_DISTANCE);
        assert.equal(DASH_DIFFICULTY, 6);
        assert.equal(move.canWalk && move.canRun && move.canDash, true);
    });

    it('adds the ▟ of each unburied Nimble tile', () => {
        const tiles = [
            tile({ id: 'n1', dice: ['d6'], tags: ['Nimble'] }),
            tile({ id: 'n2', dice: ['d4'], tags: ['Detail: Nimble'] }),
            tile({ id: 'n3', dice: ['d8'], tags: ['Nimble'], isBuried: true }),
            tile({ id: 'n4', dice: ['d8'], tags: ['Crit: Nimble'] })
        ];
        assert.equal(getNimbleWalkBonus(tiles), 3);
        assert.equal(calculateMovement({ rx: 4, tiles }).walk, 7);
    });

    it('applies SLOW (-3 Reflex each) and Bulky items in use (-3 Walk each)', () => {
        assert.equal(calculateMovement({ rx: 8, activeCrits: { slow: 1 } }).walk, 5);
        assert.equal(calculateMovement({ rx: 8, activeCrits: { slow: 2 } }).walk, 2);
        assert.equal(calculateMovement({ rx: 8, bulkyInUse: 1 }).walk, 5);
        assert.equal(calculateMovement({ rx: 2, bulkyInUse: 1 }).walk, 0);
    });

    it('lists unburied Bulky tiles, whether the tag is a Flaw or plain', () => {
        const tiles = [
            tile({ id: 'b1', type: 'Gear', tags: ['Flaw: Bulky'] }),
            tile({ id: 'b2', type: 'Gear', tags: ['Bulky'] }),
            tile({ id: 'b3', type: 'Gear', tags: ['Bulky'], isBuried: true })
        ];
        assert.deepEqual(getBulkyTiles(tiles).map(t => t.id), ['b1', 'b2']);
    });

    it('sets Pace equal to Walk for Bestial characters', () => {
        const tiles = [tile({ tags: ['Bestial: RX'] })];
        const move = calculateMovement({ rx: 6, tiles });
        assert.equal(move.bestial, true);
        assert.equal(move.pace, 6);
    });

    it('restricts a Cornered (0 RX) character to a 3 m Pace', () => {
        const move = calculateMovement({ rx: 0, tiles: [tile({ tags: ['Bestial: HP', 'Nimble'] })] });
        assert.equal(move.cornered, true);
        assert.equal(move.walk, 0);
        assert.equal(move.pace, 3);
        assert.equal(move.canWalk || move.canRun || move.canDash, false);
    });

    it('HOLD blocks Walk and Run but not Dash', () => {
        const move = calculateMovement({ rx: 4, activeCrits: { hold: 1 } });
        assert.equal(move.canWalk, false);
        assert.equal(move.canRun, false);
        assert.equal(move.canDash, true);
    });
});

describe('Sustain upkeep', () => {
    const sustainSpell = tile({ id: 's1', name: 'Bubbles', isSpell: true, type: 'Gear', spellState: { 'spell-duration': '-3' } });
    const customSustain = tile({ id: 's2', name: 'Wings', isSpell: true, type: 'Gear', spellState: { 'spell-duration': 'custom', 'spell-duration-custom-name': 'Sustain (1 Res / minute)' } });
    const taggedSustain = tile({ id: 's3', name: 'Ghost', tags: ['Duration: Sustain'] });
    const instantSpell = tile({ id: 'i1', name: 'Bolt', isSpell: true, type: 'Gear', spellState: { 'spell-duration': '-1' } });

    it('detects Sustain from the Spell Builder duration or a Sustain tag', () => {
        assert.equal(isSustainTile(sustainSpell), true);
        assert.equal(isSustainTile(customSustain), true);
        assert.equal(isSustainTile(taggedSustain), true);
        assert.equal(isSustainTile(instantSpell), false);
    });

    it('lists unburied Sustain tiles and drops stale active ids', () => {
        const tiles = [sustainSpell, instantSpell, { ...taggedSustain, isBuried: true }];
        const tracker = getSustainTracker(tiles, ['s1', 's3', 'gone']);
        assert.deepEqual(tracker.rows, [{ id: 's1', name: 'Bubbles', active: true }]);
        assert.deepEqual(tracker.activeIds, ['s1']);
    });

    it('normalizes the stored active list', () => {
        assert.deepEqual(normalizeActiveSustains(['a', 'a', '', null, 3]), ['a', '3']);
        assert.deepEqual(normalizeActiveSustains('a'), []);
    });

    it('pays 1 point from EN, RX, or HP', () => {
        assert.deepEqual(paySustainUpkeep({ en: 3 }, 'en'), { ok: true, key: 'en', value: 2 });
        assert.deepEqual(paySustainUpkeep({ hp: '1' }, 'HP'), { ok: true, key: 'hp', value: 0 });
        assert.equal(paySustainUpkeep({ rx: 0 }, 'rx').ok, false);
        assert.equal(paySustainUpkeep({ sh: 3 }, 'sh').ok, false);
        assert.deepEqual(paySustainUpkeep({ rx: 0, gmOverride: true }, 'rx'), { ok: true, key: 'rx', value: 0 });
    });
});
