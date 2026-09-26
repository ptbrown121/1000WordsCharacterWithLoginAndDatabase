import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SPELL_DEFAULT_BOXES,
    calculateSpellTagXp,
    calculateSpellTotalXp,
    getColorBuildFlags,
    getDefaultSpellBoxes,
    getSpellCastTests,
    getSpellTagXpList,
    getSpellTileCastTest,
    migrateSpellFormTags,
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
        assert.deepEqual(flags, { shadow: false, shadowBoxes: 0, divergent: false, xp: 0 });
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
        assert.deepEqual(flags, { shadow: true, shadowBoxes: 1, divergent: false, xp: 2 });
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
        assert.deepEqual(flags, { shadow: true, shadowBoxes: 1, divergent: true, xp: 4 });
    });

    it('charges +2 XP per shadow box (p.58), keeping Divergent at a flat +2', () => {
        const flags = getColorBuildFlags({
            school: 'Forge',
            customMode: true,
            boxes: [
                { type: 'shadow', kind: 'Qi', resource: 'health' },
                { type: 'shadow', kind: 'Id', resource: 'energy' }
            ]
        });
        // Two shadow boxes (+4); with no normal colors it is not Divergent.
        assert.deepEqual(flags, { shadow: true, shadowBoxes: 2, divergent: false, xp: 4 });

        const divergent = getColorBuildFlags({
            school: 'Divergent',
            customMode: true,
            boxes: [
                { type: 'shadow', kind: 'Qi', resource: 'health' },
                { type: 'shadow', kind: 'Id', resource: 'energy' }
            ]
        });
        assert.equal(divergent.xp, 6);
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
        assert.deepEqual(flags, { shadow: false, shadowBoxes: 0, divergent: true, xp: 2 });
    });

    it('ignores off-school colors when custom mode is off', () => {
        // Without the custom-colors opt-in the picker is hidden, so stray
        // checkbox state must not charge Divergent.
        const flags = getColorBuildFlags({
            school: 'Forge',
            customMode: false,
            boxes: [{ type: 'color', color: 'Blue' }, { type: 'color', color: 'Red' }]
        });
        assert.deepEqual(flags, { shadow: false, shadowBoxes: 0, divergent: false, xp: 0 });
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

    describe('calculateSpellTotalXp (p.56)', () => {
        it('floors only the 🗱 tally at 0 and always pays for the dice', () => {
            // Amonkenet's aid: -1🗱 on a d6 (3 XP of dice) costs 3.
            assert.equal(calculateSpellTotalXp(-1, 3), 3);
            assert.equal(calculateSpellTotalXp(-5, 1), 1);
            assert.equal(calculateSpellTotalXp(4, 3), 7);
        });
    });

    describe('calculateSpellTagXp (p.57)', () => {
        it('adds 2 for each duplicate copy (Keen +2, Keen +4)', () => {
            const tags = [{ name: 'Keen', xp: 2 }, { name: 'Keen', xp: 2 }, { name: 'Throw', xp: 2 }];
            assert.deepEqual(getSpellTagXpList(tags), [2, 4, 2]);
            assert.equal(calculateSpellTagXp(tags), 8);
            assert.equal(calculateSpellTagXp([...tags, { name: 'Keen', xp: 2 }]), 14);
        });

        it('treats crit picks case-insensitively and ignores the generic price rows', () => {
            assert.equal(calculateSpellTagXp([{ name: 'DOWN', xp: 2 }, { name: 'Down', xp: 2 }]), 6);
            assert.equal(calculateSpellTagXp([
                { name: '2 XP Crit/Tag', xp: 2 },
                { name: '2 XP Crit/Tag', xp: 2 },
                { name: 'World Homeworld', xp: 0 },
                { name: 'World Homeworld', xp: 0 }
            ]), 4);
        });

        it('sums an empty list to 0', () => {
            assert.equal(calculateSpellTagXp([]), 0);
        });
    });

    describe('migrateSpellFormTags', () => {
        it('turns legacy Sacrifice / Escape! modifier counts into tags at the same price', () => {
            const { tags, consumedKeys } = migrateSpellFormTags({
                tagsList: [{ name: 'Keen', xp: 2 }],
                'spell-mod-val-Sap': '1',
                'spell-mod-val-Escape!': '1',
                'spell-mod-val-Tire': '0',
                'spell-mod-val-And/Or': '2'
            });
            assert.deepEqual(tags, [
                { name: 'Keen', xp: 2 },
                { name: 'Escape!', xp: 4 },
                { name: 'Sap', xp: -2 }
            ]);
            assert.equal(calculateSpellTagXp(tags), 4); // 2 + 4 - 2, as before
            assert.ok(consumedKeys.includes('spell-mod-val-Sap'));
            assert.ok(!consumedKeys.includes('spell-mod-val-And/Or'));
        });

        it('does not add a second copy of a Sacrifice the spell already has as a tag', () => {
            const { tags } = migrateSpellFormTags({
                tagsList: [{ name: 'Sap', xp: -2 }],
                'spell-mod-val-Sap': '1',
                'spell-mod-val-Saps': '1'
            });
            assert.deepEqual(tags, [{ name: 'Sap', xp: -2 }]);
        });

        it('collapses a count above 1 to a single tag', () => {
            const { tags } = migrateSpellFormTags({ 'spell-mod-val-Drain': '2' });
            assert.deepEqual(tags, [{ name: 'Drain', xp: -4 }]);
        });

        it('fixes the sign of legacy inflicted-flaw pills', () => {
            const { tags } = migrateSpellFormTags({
                tagsList: [{ name: '-2 XP Flaw', xp: -2 }, { name: '-4 XP Flaw', xp: -4 }, { name: 'Bulky', xp: -2 }]
            });
            assert.deepEqual(tags.map(tag => tag.xp), [2, 4, -2]);
        });

        it('copies the pills rather than aliasing the saved list', () => {
            const saved = { tagsList: [{ name: 'Keen', xp: 2 }] };
            migrateSpellFormTags(saved).tags[0].xp = 99;
            assert.equal(saved.tagsList[0].xp, 2);
            assert.deepEqual(migrateSpellFormTags({}).tags, []);
        });
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

        it('skips Gizmo tiles, which need no spell test (p.68)', () => {
            const gizmo = { ...primalBurst, id: 'g', tags: ['Spell', 'Gizmo'] };
            const detailGizmo = { ...primalBurst, id: 'g2', tags: ['Spell', 'Detail: Gizmo', 'Chain Forge'] };
            assert.deepEqual(getSpellCastTests([gizmo, detailGizmo, forge]), []);
            assert.equal(getSpellTileCastTest(gizmo, [gizmo, forge]), null);
            const broken = { ...gizmo, gearBroken: true };
            assert.equal(getSpellTileCastTest(broken, [broken, forge]), null);
        });
    });

    describe('getSpellTileCastTest', () => {
        const forge = { id: 'forge', name: 'Forge', type: 'Skill', dice: ['d6'], exoticSkill: { system: 'Arcana' } };
        const twist = { id: 'twist', name: 'Twist', type: 'Skill', dice: ['d10'], exoticSkill: { system: 'Arcana' } };
        const primalBurst = { id: 'pb', name: 'primal burst', type: 'Gear', isSpell: true, xpCost: 8, dice: ['d8'], tags: ['Spell', 'Chain Forge'] };

        it('uses the Arcana tile the spell chains to among all tiles', () => {
            const entry = getSpellTileCastTest(primalBurst, [twist, primalBurst, forge]);
            assert.equal(entry?.arcanaName, 'Forge');
            assert.equal(entry?.test, 6);
        });

        it('ignores a buried Arcana tile', () => {
            assert.equal(getSpellTileCastTest(primalBurst, [primalBurst, { ...forge, isBuried: true }])?.test, 8);
        });

        it('returns null for non-spell tiles', () => {
            assert.equal(getSpellTileCastTest(forge, [forge]), null);
        });
    });
});
