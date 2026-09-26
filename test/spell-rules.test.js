import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SPELL_DEFAULT_BOXES,
    getColorBuildFlags,
    getDefaultSpellBoxes,
    getSpellCastTests,
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

    describe('getSpellCastTests (p.48)', () => {
        const forge = { id: 'forge', name: 'Forge', type: 'Skill', dice: ['d6'], exoticSkill: { system: 'Arcana' } };
        const primalBurst = { id: 'pb', name: 'primal burst', type: 'Gear', isSpell: true, xpCost: 8, dice: ['d8'], tags: ['Spell', 'Chain Forge'] };

        it('reduces the spell XP Test by the chained Arcana tile\'s die steps', () => {
            // Rulebook example: 8 XP spell chained to a d6 Forge -> Test 6.
            assert.deepEqual(getSpellCastTests([primalBurst, forge]), [{
                spellId: 'pb',
                spellName: 'primal burst',
                spellXp: 8,
                arcanaName: 'Forge',
                reduction: 2,
                test: 6
            }]);
        });

        it('sums die steps across a multi-die Arcana tile and matches names case-insensitively', () => {
            const bigForge = { ...forge, name: 'FORGE', dice: ['d8', 'd4'] };
            assert.equal(getSpellCastTests([primalBurst, bigForge])[0].test, 4);
        });

        it('uses the full XP when the Arcana tile was not called', () => {
            const [entry] = getSpellCastTests([primalBurst]);
            assert.equal(entry.arcanaName, null);
            assert.equal(entry.reduction, 0);
            assert.equal(entry.test, 8);
        });

        it('accepts legacy spellcast-skill tiles and ignores non-Arcana chains', () => {
            const legacy = { id: 'l', name: 'Forge', type: 'Skill', dice: ['d6'], isSpellcastSkill: true };
            assert.equal(getSpellCastTests([primalBurst, legacy])[0].test, 6);
            const plain = { id: 'p', name: 'Forge', type: 'Skill', dice: ['d6'] };
            assert.equal(getSpellCastTests([primalBurst, plain])[0].test, 8);
        });

        it('floors the Test at 0 (the spell always casts) and parses string XP', () => {
            const cheap = { ...primalBurst, xpCost: '2' };
            const hugeForge = { ...forge, dice: ['d10'] };
            assert.equal(getSpellCastTests([cheap, hugeForge])[0].test, 0);
        });

        it('returns nothing when no spell is called', () => {
            assert.deepEqual(getSpellCastTests([forge]), []);
        });
    });
});
