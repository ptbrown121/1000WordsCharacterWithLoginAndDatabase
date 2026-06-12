import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SPELL_DEFAULT_BOXES,
    getColorBuildFlags,
    getDefaultSpellBoxes,
    spellBoxesDifferFromDefault
} from '../js/spell-rules.js';

describe('spell-rules', () => {
    it('serves serialized default boxes for each school', () => {
        assert.deepEqual(getDefaultSpellBoxes('Forge'), [
            { type: 'color', color: 'Green' },
            { type: 'color', color: 'Red' }
        ]);
        Object.keys(SPELL_DEFAULT_BOXES).forEach(school => {
            assert.equal(getDefaultSpellBoxes(school).length, 2, school);
        });
        assert.deepEqual(getDefaultSpellBoxes('Divergent'), []);
    });

    it('prices standard school colors at 0 XP', () => {
        const flags = getColorBuildFlags({
            school: 'Forge',
            customMode: false,
            boxes: getDefaultSpellBoxes('Forge')
        });
        assert.deepEqual(flags, { shadow: false, divergent: false, xp: 0 });
    });

    it('prices a shadow box at +2 XP without divergent (Forge Red+Qi)', () => {
        const flags = getColorBuildFlags({
            school: 'Forge',
            customMode: true,
            boxes: [
                { type: 'color', color: 'Red' },
                { type: 'shadow', kind: 'Qi', resource: 'health' }
            ]
        });
        assert.deepEqual(flags, { shadow: true, divergent: false, xp: 2 });
    });

    it('prices shadow plus off-school color at +4 XP (Forge Blue+Qi)', () => {
        const flags = getColorBuildFlags({
            school: 'Forge',
            customMode: true,
            boxes: [
                { type: 'color', color: 'Blue' },
                { type: 'shadow', kind: 'Qi', resource: 'health' }
            ]
        });
        assert.deepEqual(flags, { shadow: true, divergent: true, xp: 4 });
    });

    it('treats the Divergent school as divergent regardless of colors', () => {
        const flags = getColorBuildFlags({
            school: 'Divergent',
            customMode: true,
            boxes: [
                { type: 'color', color: 'Green' },
                { type: 'color', color: 'Red' }
            ]
        });
        assert.deepEqual(flags, { shadow: false, divergent: true, xp: 2 });
    });

    it('ignores off-school colors when custom mode is off', () => {
        // Without the custom-colors opt-in the picker is hidden, so stray
        // checkbox state must not charge Divergent.
        const flags = getColorBuildFlags({
            school: 'Forge',
            customMode: false,
            boxes: [{ type: 'color', color: 'Blue' }, { type: 'color', color: 'Red' }]
        });
        assert.deepEqual(flags, { shadow: false, divergent: false, xp: 0 });
    });

    it('detects when tile boxes differ from the school defaults', () => {
        const defaultTile = {
            boxes: [
                { type: 'color', color: 'Red' },
                { type: 'color', color: 'Green' }
            ]
        };
        assert.equal(spellBoxesDifferFromDefault('Forge', defaultTile), false);

        const customTile = {
            boxes: [
                { type: 'color', color: 'Blue' },
                { type: 'color', color: 'Green' }
            ]
        };
        assert.equal(spellBoxesDifferFromDefault('Forge', customTile), true);

        // Schools without defaults (Divergent) always count as custom.
        assert.equal(spellBoxesDifferFromDefault('Divergent', defaultTile), true);
    });
});
