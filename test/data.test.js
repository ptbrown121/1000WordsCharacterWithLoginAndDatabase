import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveMax, normalizeStateForShadowRules, normalizeTileTags, reorderTilesByVisibleMove } from '../js/data.js';

describe('getEffectiveMax', () => {
    it('sums base max + perm + temp for HP/EN/RX', () => {
        const state = { hpMax: 10, hpPerm: 2, hpTemp: 3 };
        assert.equal(getEffectiveMax(state, 'hp'), 15);
    });

    it('uses baseOverride when provided (used by SH which has no stored max)', () => {
        const state = { shPerm: 1, shTemp: 2 };
        assert.equal(getEffectiveMax(state, 'sh', 4), 7);
    });

    it('coerces string values from input fields', () => {
        const state = { hpMax: '10', hpPerm: '2', hpTemp: '3' };
        assert.equal(getEffectiveMax(state, 'hp'), 15);
    });

    it('treats missing or NaN parts as 0', () => {
        assert.equal(getEffectiveMax({}, 'hp'), 0);
        assert.equal(getEffectiveMax({ hpMax: 'abc', hpPerm: null, hpTemp: undefined }, 'hp'), 0);
    });

    it('handles a null state without throwing', () => {
        assert.equal(getEffectiveMax(null, 'hp'), 0);
        assert.equal(getEffectiveMax(undefined, 'hp', 5), 5);
    });

    it('preserves explicit 0 baseOverride (does not fall back to state.shMax)', () => {
        const state = { shMax: 99, shPerm: 1, shTemp: 1 };
        assert.equal(getEffectiveMax(state, 'sh', 0), 2);
    });
});



describe('normalizeTileTags', () => {
    it('returns an empty array for missing or empty tags', () => {
        const tile = { tags: null };
        normalizeTileTags(tile);
        assert.deepEqual(tile.tags, []);

        const tile2 = { tags: '' };
        normalizeTileTags(tile2);
        assert.deepEqual(tile2.tags, []);

        const tile3 = {};
        normalizeTileTags(tile3);
        assert.deepEqual(tile3.tags, []);
    });

    it('preserves a clean string[] of player-authored tags', () => {
        const tile = { tags: ['Keen', 'Sharp', 'Chain Bolt'] };
        normalizeTileTags(tile);
        assert.deepEqual(tile.tags, ['Keen', 'Sharp', 'Chain Bolt']);
    });

    it('parses a legacy comma-separated string into an array', () => {
        const tile = { tags: 'Keen, Sharp , Vital' };
        normalizeTileTags(tile);
        assert.deepEqual(tile.tags, ['Keen', 'Sharp', 'Vital']);
    });

    it('flattens object-shaped tags ({name, xp}) to their name', () => {
        const tile = { tags: [{ name: 'Keen', xp: 2 }, { name: 'Sharp', xp: 2 }] };
        normalizeTileTags(tile);
        assert.deepEqual(tile.tags, ['Keen', 'Sharp']);
    });

    it('strips the auto-generated "Effect:" sentence from spell tiles (migration)', () => {
        // Simulates a spell saved before the preview-as-tag bug fix:
        // tagsArr included "Spell", "Chain Pyromancy", and the generated
        // preview sentence ("Effect: Bolt. Range: ...").
        const spell = {
            isSpell: true,
            tags: [
                'Spell',
                'Chain Pyromancy',
                'Effect: Bolt. Range: Medium. Duration: Instant.'
            ]
        };
        normalizeTileTags(spell);
        assert.deepEqual(spell.tags, ['Spell', 'Chain Pyromancy']);
    });

    it('does NOT strip "Effect:" from non-spell tiles (defensive scope)', () => {
        // A non-spell tile that happens to have an unusual tag starting
        // with "Effect:" - we don't want to silently delete real player
        // data. The bug only ever affected isSpell tiles.
        const tile = {
            isSpell: false,
            tags: ['Keen', 'Effect: Custom narrative tag']
        };
        normalizeTileTags(tile);
        assert.deepEqual(tile.tags, ['Keen', 'Effect: Custom narrative tag']);
    });

    it('handles a spell tile that has no buggy tag without modifying it', () => {
        const spell = { isSpell: true, tags: ['Spell', 'Chain Pyromancy', 'Sharp'] };
        normalizeTileTags(spell);
        assert.deepEqual(spell.tags, ['Spell', 'Chain Pyromancy', 'Sharp']);
    });

    it('is idempotent (running twice yields the same result)', () => {
        const spell = {
            isSpell: true,
            tags: ['Spell', 'Effect: foo', 'Sharp']
        };
        normalizeTileTags(spell);
        const once = [...spell.tags];
        normalizeTileTags(spell);
        assert.deepEqual(spell.tags, once);
    });

    it('also strips "Effect:" tags from a legacy comma-string spell tile', () => {
        // Belt-and-suspenders: the migration should run on whatever shape
        // arrives, including the oldest comma-string format.
        const spell = {
            isSpell: true,
            tags: 'Spell, Chain Pyromancy, Effect: Bolt. Range: Medium.'
        };
        normalizeTileTags(spell);
        assert.deepEqual(spell.tags, ['Spell', 'Chain Pyromancy']);
    });
});

describe('normalizeStateForShadowRules', () => {
    it('loads ordinary non-Shadow characters safely with Shadow defaults', () => {
        const state = normalizeStateForShadowRules({
            stats: { BODY: 'd4', POWER: '', SOUL: '', FOCUS: '', MIND: '', SPEED: '' },
            tiles: [{ colors: ['Red', 'Green'], dice: ['d4'], tags: [] }]
        });

        assert.equal(state.aberration, 0);
        assert.equal(state.sh, 0);
        assert.equal(state.legacyShadowWarning, false);
        assert.deepEqual(state.tiles[0].boxes, [
            { type: 'color', color: 'Red' },
            { type: 'color', color: 'Green' }
        ]);
    });

    it('ignores old Qi / Id stat data and sets the legacy warning', () => {
        const state = normalizeStateForShadowRules({
            stats: { BODY: 'd4', Qi: 'd10', Id: 'd8' },
            tiles: []
        });

        assert.deepEqual(Object.keys(state.stats), ['BODY', 'POWER', 'SOUL', 'FOCUS', 'MIND', 'SPEED']);
        assert.equal(state.stats.Qi, undefined);
        assert.equal(state.stats.Id, undefined);
        assert.equal(state.legacyShadowWarning, true);
    });

    it('migrates legacy single Story Points value into earned/spent tracking', () => {
        const state = normalizeStateForShadowRules({
            stats: {},
            tiles: [],
            storyPoints: 4
        });

        assert.equal(state.storyPointsEarned, 4);
        assert.equal(state.storyPointsSpent, 0);
        assert.equal(state.storyPoints, 4);
    });

    it('preserves existing Story Points earned/spent values', () => {
        const state = normalizeStateForShadowRules({
            stats: {},
            tiles: [],
            storyPoints: 99,
            storyPointsEarned: 7,
            storyPointsSpent: 3
        });

        assert.equal(state.storyPointsEarned, 7);
        assert.equal(state.storyPointsSpent, 3);
        assert.equal(state.storyPoints, 7);
    });

    it('defaults XP spent adjustment for older saves', () => {
        const state = normalizeStateForShadowRules({
            stats: {},
            tiles: []
        });

        assert.equal(state.xpSpentAdjustment, 0);
    });

    it('normalizes XP spent adjustment from saved input', () => {
        const state = normalizeStateForShadowRules({
            stats: {},
            tiles: [],
            xpSpentAdjustment: '2'
        });

        assert.equal(state.xpSpentAdjustment, 2);
    });
});

describe('reorderTilesByVisibleMove', () => {
    it('moves a dragged tile within the visible custom order', () => {
        const tiles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

        assert.deepEqual(
            reorderTilesByVisibleMove(tiles, ['a', 'b', 'c', 'd'], 'c', 'a').map(tile => tile.id),
            ['c', 'a', 'b', 'd']
        );
    });

    it('preserves hidden tile slots while reordering the visible subset', () => {
        const tiles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];

        assert.deepEqual(
            reorderTilesByVisibleMove(tiles, ['b', 'd', 'e'], 'e', 'b').map(tile => tile.id),
            ['a', 'e', 'c', 'b', 'd']
        );
    });

    it('returns the original order for invalid moves', () => {
        const tiles = [{ id: 'a' }, { id: 'b' }];

        assert.equal(reorderTilesByVisibleMove(tiles, ['a', 'b'], 'a', 'a'), tiles);
        assert.equal(reorderTilesByVisibleMove(tiles, ['a'], 'b', 'a'), tiles);
    });
});

describe('condition tracking normalization (v5.02 PR 4)', () => {
    it('normalizes activeCrits and pressCount on load', () => {
        const state = normalizeStateForShadowRules({
            stats: {},
            tiles: [],
            activeCrits: { WOUND: '2', bogus: 1, jolt: -1 },
            pressCount: '3'
        });
        assert.deepEqual(state.activeCrits, { wound: 2 });
        assert.equal(state.pressCount, 3);
    });

    it('defaults missing condition fields safely', () => {
        const state = normalizeStateForShadowRules({ stats: {}, tiles: [] });
        assert.deepEqual(state.activeCrits, {});
        assert.equal(state.pressCount, 0);
    });

    it('normalizes Core fields and floors current Core at 0', () => {
        const state = normalizeStateForShadowRules({ stats: {}, tiles: [], core: '-2', coreTemp: 'x', corePerm: 1 });
        assert.equal(state.core, 0);
        assert.equal(state.coreTemp, 0);
        assert.equal(state.corePerm, 1);

        const defaults = normalizeStateForShadowRules({ stats: {}, tiles: [] });
        assert.equal(defaults.core, 0);
        assert.equal(defaults.coreTemp, 0);
        assert.equal(defaults.corePerm, 0);
    });
});

describe('special identity tile normalization (v5.02 PR 6)', () => {
    it('keeps three boxes on special identity tiles and trims others to two', () => {
        const threeBoxes = [
            { type: 'color', color: 'Red' },
            { type: 'color', color: 'Blue' },
            { type: 'color', color: 'Yellow' }
        ];
        const state = normalizeStateForShadowRules({
            stats: {},
            tiles: [
                { id: '1', name: 'costume', type: 'Gear', dice: ['d4'], tags: [], specialIdentity: 'titan-identity', boxes: threeBoxes },
                { id: '2', name: 'home', type: 'Story', dice: ['d4'], tags: [], specialIdentity: 'Homeworld', boxes: threeBoxes },
                { id: '3', name: 'plain', type: 'Skill', dice: ['d4'], tags: [], boxes: threeBoxes },
                { id: '4', name: 'bogus', type: 'Skill', dice: ['d4'], tags: [], specialIdentity: 'nonsense', boxes: threeBoxes }
            ]
        });
        assert.equal(state.tiles[0].specialIdentity, 'titan-identity');
        assert.equal(state.tiles[0].boxes.length, 3);
        assert.equal(state.tiles[1].specialIdentity, 'homeworld');
        assert.equal(state.tiles[1].boxes.length, 3);
        assert.equal(state.tiles[2].specialIdentity, null);
        assert.equal(state.tiles[2].boxes.length, 2);
        assert.equal(state.tiles[3].specialIdentity, null);
        assert.equal(state.tiles[3].boxes.length, 2);
    });

    it('normalizes Titan state fields', () => {
        const state = normalizeStateForShadowRules({ stats: {}, tiles: [], titan: '-1', titanHV: '-3' });
        assert.equal(state.titan, 0);
        assert.equal(state.titanHV, -3);

        const defaults = normalizeStateForShadowRules({ stats: {}, tiles: [] });
        assert.equal(defaults.titan, 0);
        assert.equal(defaults.titanTemp, 0);
        assert.equal(defaults.titanPerm, 0);
        assert.equal(defaults.titanHV, 0);
    });
});

describe('Stranger state normalization (v5.02 PR 7)', () => {
    it('normalizes currentForm and celestialAspect', () => {
        const state = normalizeStateForShadowRules({ stats: {}, tiles: [], currentForm: 'Werewolf', celestialAspect: 'aural' });
        assert.equal(state.currentForm, 'Werewolf');
        assert.equal(state.celestialAspect, 'aural');

        const bad = normalizeStateForShadowRules({ stats: {}, tiles: [], currentForm: 7, celestialAspect: 'nonsense' });
        assert.equal(bad.currentForm, '');
        assert.equal(bad.celestialAspect, '');
    });
});
