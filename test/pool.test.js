import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    PoolEngine,
    getExoticSkillBaseXp,
    formatWeaponTemplateDetails,
    getWeaponTemplateById,
    getWeaponTemplateTags,
    getWeaponTemplatesByCategory,
    getHitchValue,
    isHitchedTile,
    getTileNormalCallColors,
    getTileShieldCrits,
    getDefenseShieldSources,
    calculateCoreMax,
    getCoreAbilities,
    calculateTitanMax,
    getTitanAbilities,
    getTileBoxes,
    calculateBestialTileCount,
    calculateCelestialRank,
    getCelestialAspectSummary,
    getTileWhileForms,
    getCharacterForms,
    applyFormToTiles,
    HINDER_TYPES,
    isHinderTile,
    countGizmoTiles,
    countSliverTiles,
    calculateHitchRebateTotal,
    calculateArmorSoak,
    calculateArmorSoakDetails,
    adjustAberrationForShadowUse,
    applyAberrantDieStepEffects,
    classifyAberration,
    getAberrantDieStepNet,
    getAvailableShadowAbilities,
    validateShadowTags
} from '../js/pool.js';

const engine = new PoolEngine();

describe('calculateSteps', () => {
    it('sums die steps (d3=0 .. d16=7)', () => {
        assert.equal(engine.calculateSteps(['d4', 'd6']), 3); // 1 + 2
        assert.equal(engine.calculateSteps(['d3']), 0);
        assert.equal(engine.calculateSteps(['d16']), 7);
        assert.equal(engine.calculateSteps([]), 0);
    });
});

describe('parseDiceString', () => {
    it('keeps only valid die codes and normalizes case/whitespace', () => {
        assert.deepEqual(engine.parseDiceString('d4, D6 , d20, x, d8'), ['d4', 'd6', 'd8']);
        assert.deepEqual(engine.parseDiceString(''), []);
    });
});

describe('classifyTagForLimit (rulebook p.13 / p.2014)', () => {
    const counts = (t) => engine.classifyTagForLimit(t).counts;

    it('counts Build / Detail / Crit / Shield tags', () => {
        for (const t of ['Quick', 'Tough', 'Vital', 'Motorized', 'Agile', 'Hidden',
            'Ironclad', 'Loose', 'Rugged', 'Sealed', 'Adamant', 'Keen', 'Sharp',
            'Expert', 'Escape!', 'Rite', 'Sustain', 'Detail: Fast', 'Crit: JOLT', 'Shield: Deflect']) {
            assert.equal(counts(t), true, `${t} should count`);
        }
    });

    it('counts Build-prefixed tags including Build: Cyber', () => {
        assert.equal(counts('Build: Cyber'), true);
        assert.equal(counts('Build: Tough'), true);
    });

    it('exempts Flaw / Range / Duration / Exotic tags', () => {
        for (const t of ['Old', 'Primitive', 'Rare', 'Risky', 'Worn', 'Bulky', 'Heavy',
            'Hitch 3', 'Sap', 'Tire', 'Drain', 'Witch', 'Range: Short', 'Duration: Instant',
            'Bestial', 'Celestial', 'Cyber', 'World Helper']) {
            assert.equal(counts(t), false, `${t} should be exempt`);
        }
    });

    it('honors the GM (Exempt) override and ignores blanks', () => {
        assert.equal(counts('Sharp (Exempt)'), false);
        assert.equal(counts('   '), false);
    });
});

describe('calculateTagLimit', () => {
    it('passes when countable tags <= die steps', () => {
        const r = engine.calculateTagLimit(['d6'], ['Ironclad', 'Tough']); // 2 steps, 2 countable
        assert.deepEqual({ limit: r.limit, count: r.count, overage: r.overage, valid: r.valid },
            { limit: 2, count: 2, overage: 0, valid: true });
    });

    it('fails when countable tags exceed die steps', () => {
        const r = engine.calculateTagLimit(['d4'], ['Ironclad', 'Quick']); // 1 step, 2 countable
        assert.deepEqual({ limit: r.limit, count: r.count, overage: r.overage, valid: r.valid },
            { limit: 1, count: 2, overage: 1, valid: false });
    });

    it('separates exempt tags from countable ones', () => {
        const r = engine.calculateTagLimit(['d6'], ['Range: Short', 'Old', 'Ironclad']);
        assert.equal(r.count, 1);             // only Ironclad counts
        assert.equal(r.exemptTags.length, 2); // Range + Old
        assert.equal(r.valid, true);
    });
});

describe('calculateOptimalXpCost (cascade)', () => {
    it('matches rulebook base costs for a single die', () => {
        // From the System Concept-Dice chart: cumulative cost to grow
        // a free d3 up to each rank.
        assert.equal(engine.calculateOptimalXpCost(['d3']), 0);
        assert.equal(engine.calculateOptimalXpCost(['d4']), 1);
        assert.equal(engine.calculateOptimalXpCost(['d6']), 3);
        assert.equal(engine.calculateOptimalXpCost(['d8']), 6);
        assert.equal(engine.calculateOptimalXpCost(['d10']), 10);
        assert.equal(engine.calculateOptimalXpCost(['d12']), 15);
        assert.equal(engine.calculateOptimalXpCost(['d14']), 21);
        assert.equal(engine.calculateOptimalXpCost(['d16']), 28);
    });

    it('charges {steps} + {count of other dice} for each additional die', () => {
        // 2x d4: add d4 (1+0=1), add d4 (1+1=2) => 3
        assert.equal(engine.calculateOptimalXpCost(['d4', 'd4']), 3);
        // 3x d4: 1 + 2 + 3 = 6
        assert.equal(engine.calculateOptimalXpCost(['d4', 'd4', 'd4']), 6);
        // 2x d6 (matches the rulebook walkthrough): first d6 costs 3,
        // second d6 costs (1+1)+(2+1) = 5 => total 8
        assert.equal(engine.calculateOptimalXpCost(['d6', 'd6']), 8);
        // 2x d8: 6 + ((1+1)+(2+1)+(3+1)) = 6 + 9 = 15
        assert.equal(engine.calculateOptimalXpCost(['d8', 'd8']), 15);
    });

    it('charges mixed-rank pools with the highest die paying first', () => {
        // d6 + d4 (sorted [d6,d4]): 3 + (1+1) = 5
        assert.equal(engine.calculateOptimalXpCost(['d6', 'd4']), 5);
        assert.equal(engine.calculateOptimalXpCost(['d4', 'd6']), 5); // order-independent
        // d8 + d4: 6 + (1+1) = 8
        assert.equal(engine.calculateOptimalXpCost(['d8', 'd4']), 8);
        // d8 + d6 + d4 (sorted [d8,d6,d4]): 6 + ((1+1)+(2+1)) + (1+2) = 6 + 5 + 3 = 14
        assert.equal(engine.calculateOptimalXpCost(['d4', 'd6', 'd8']), 14);
    });

    it('treats d3 as free and does not count it toward "other dice"', () => {
        // d3 alone is free.
        assert.equal(engine.calculateOptimalXpCost(['d3']), 0);
        // d3 + d6: d3 is skipped entirely, so d6 pays its lone-die cost of 3,
        // not 3+1=4 as if the d3 counted as an "other die".
        assert.equal(engine.calculateOptimalXpCost(['d3', 'd6']), 3);
        assert.equal(engine.calculateOptimalXpCost(['d3', 'd3', 'd6']), 3);
        // d3 + 2x d6: still 8, the d3 is invisible to the cascade.
        assert.equal(engine.calculateOptimalXpCost(['d3', 'd6', 'd6']), 8);
    });
});

describe('estimateTileXp', () => {
    it('adds tag modifiers to the dice cost (floored at 0)', () => {
        assert.equal(engine.estimateTileXp(['d6'], ['Keen']), 5);      // 3 + 2
        assert.equal(engine.estimateTileXp(['d4'], ['Chain Foo']), 5); // 1 + 4
        assert.equal(engine.estimateTileXp(['d4'], ['World Foo']), 4); // World Build tag is 3 XP (v5.02 p.63)
        assert.equal(engine.estimateTileXp(['d4'], ['Old', 'Worn']), 0); // 1 - 2 - 2 -> max(0)
    });

    it('charges duplicate tags 2 XP more than the previous copy', () => {
        assert.equal(engine.estimateTileXp(['d6'], ['Keen', 'Keen']), 9); // d6 3 + Keen 2 + duplicate Keen 4
        assert.equal(engine.estimateTileXp(['d8'], ['Old', 'Old']), 4);   // d8 6 -2 + duplicate Old 0
        assert.equal(engine.estimateTileXp(['d4'], ['World Foo', 'World Foo']), 7); // 1 + 3 + 3, no duplicate surcharge
    });

    it('charges parameterized duplicate tags by mechanical tag name', () => {
        assert.equal(engine.estimateTileXp(['d4'], ['Chain Forge', 'Chain Ward']), 11); // d4 1 + Chain 4 + duplicate Chain 6
        assert.equal(engine.estimateTileXp(['d4'], ['Chain A', 'Chain B', 'Chain C']), 19); // 1 + 4 + 6 + 8
        assert.equal(engine.estimateTileXp(['d4'], ['Motorized: BODY', 'Motorized: SPEED']), 7); // 1 + 2 + 4
        assert.equal(engine.estimateTileXp(['d8'], ['Hitch 1', 'Hitch 6']), 1); // d8 6 -1 + duplicate Hitch (-6 + 2)
    });

    it('subtracts XP for every flaw, including Bulky and Heavy', () => {
        const base = engine.calculateOptimalXpCost(['d8']); // 6
        for (const flaw of ['Old', 'Primitive', 'Rare', 'Risky', 'Worn', 'Bulky', 'Heavy']) {
            assert.equal(engine.estimateTileXp(['d8'], [flaw]), base - 2, `${flaw} should refund 2 XP`);
        }
        assert.equal(engine.estimateTileXp(['d8'], ['Hitch']), base - 3); // Hitch refunds 3
    });

    it('adds armor base cost (material + coverage) — page 29', () => {
        assert.equal(engine.estimateTileXp(['d4'], [], { material: 'Soft', coverage: 'Open' }), 1);   // +0 +0
        assert.equal(engine.estimateTileXp(['d4'], [], { material: 'Soft', coverage: 'Full' }), 3);   // +0 +2
        assert.equal(engine.estimateTileXp(['d4'], [], { material: 'Hard', coverage: 'Open' }), 5);   // +4 +0
        assert.equal(engine.estimateTileXp(['d4'], [], { material: 'Hard', coverage: 'Closed' }), 9); // +4 +4
    });

    it('discounts Detail tags by 1 XP on Hard armor only', () => {
        const tags = ['Ironclad', 'Tough'];
        assert.equal(engine.estimateTileXp(['d6'], tags, { material: 'Soft', coverage: 'Full' }), 9);  // 3 +2 +2 +2
        assert.equal(engine.estimateTileXp(['d6'], tags, { material: 'Hard', coverage: 'Full' }), 11); // 3 +2 +2 -2 +6
    });

    it('treats a Motorized: STAT tag as a Detail tag for the Hard-armor discount', () => {
        // d6=3, Motorized +2 (generic Detail). Soft Full: +2 coverage -> 7. Hard Full: +6 armor, -1 discount -> 10.
        assert.equal(engine.estimateTileXp(['d6'], ['Motorized: BODY'], { material: 'Soft', coverage: 'Full' }), 7);
        assert.equal(engine.estimateTileXp(['d6'], ['Motorized: BODY'], { material: 'Hard', coverage: 'Full' }), 10);
    });

    it('uses range/duration and crit/shield table costs instead of a flat structural default', () => {
        assert.equal(engine.estimateTileXp(['d6'], ['Range: Short', 'Duration: Instant']), 4); // 3 +2 -1
        assert.equal(engine.estimateTileXp(['d4'], ['Crit: FEAR', 'Shield: WOUND']), 8);       // 1 +3 +4
    });

    it('uses the hard-armor flaw rebate assumption and discounts Shield tags', () => {
        assert.equal(engine.estimateTileXp(['d8'], ['Old'], { material: 'Hard', coverage: 'Open' }), 7); // 6 -3 +4
        assert.equal(engine.estimateTileXp(['d4'], ['Shield: WOUND'], { material: 'Hard', coverage: 'Open' }), 8); // 1 +4 +(4-1)
    });

    it('prices the v5.02 Sticky and Titan tags', () => {
        assert.equal(engine.estimateTileXp(['d4'], ['Sticky']), 5); // 1 + 4
        assert.equal(engine.estimateTileXp(['d4'], ['Titan']), 4);  // 1 + 3
    });

    it('prices Crowd ranges from the Space and Time table', () => {
        assert.equal(engine.estimateTileXp(['d4'], ['Crowd 1']), 2);        // 1 + 1
        assert.equal(engine.estimateTileXp(['d4'], ['Crowd 5']), 4);        // 1 + 3
        assert.equal(engine.estimateTileXp(['d4'], ['Range: Crowd 10']), 5); // 1 + 4
        assert.equal(engine.estimateTileXp(['d4'], ['Crowd 1000']), 9);     // 1 + 8
    });

    it('charges Bestial/Celestial 4 XP on non-Skill tiles and 2 XP on Skill tiles', () => {
        assert.equal(engine.estimateTileXp(['d4'], ['Bestial'], null, { tileType: 'Skill' }), 3);   // 1 + 2
        assert.equal(engine.estimateTileXp(['d4'], ['Bestial'], null, { tileType: 'Trait' }), 5);   // 1 + 4
        assert.equal(engine.estimateTileXp(['d4'], ['Celestial'], null, { tileType: 'Story' }), 5); // 1 + 4
        assert.equal(engine.estimateTileXp(['d4'], ['Cyber'], null, { tileType: 'Trait' }), 3);     // Cyber stays 2
    });

    it('treats the same crit as Crit and as Shield as two functions, not duplicates', () => {
        // boxing cesti (p.39): Crit: DOWN + Shield: DOWN on one weapon.
        assert.equal(engine.estimateTileXp(['d6'], ['DOWN', 'Shield: DOWN']), 7);         // 3 + 2 + 2
        assert.equal(engine.estimateTileXp(['d6'], ['DOWN', 'DOWN']), 9);                 // 3 + 2 + 4 duplicate
        assert.equal(engine.estimateTileXp(['d6'], ['Shield: DOWN', 'Shield: DOWN']), 9); // 3 + 2 + 4 duplicate
    });

    it('adds weapon template extra XP for Far weapons', () => {
        assert.equal(engine.estimateTileXp(['d4'], ['Single'], null, { weapon: { templateId: 'javelin' } }), 1); // d4 1 + Single -2 + Far +2
        assert.equal(engine.estimateTileXp(['d4'], ['Fast'], null, { weapon: { templateId: 'small-arms' } }), 3); // no Far surcharge
        assert.equal(engine.estimateTileXp(['d4'], [], null, { weapon: { category: 'Far' } }), 3); // custom Far weapon surcharge
    });

    it('adds exotic skill base XP before the first die', () => {
        assert.equal(getExoticSkillBaseXp('arcana-twist'), 2);
        assert.equal(engine.estimateTileXp(['d4'], [], null, { exoticSkill: { id: 'cyber' } }), 3);
        assert.equal(engine.estimateTileXp(['d6'], ['Expert'], null, { exoticSkill: 'bestial' }), 7);
    });
});

describe('Hitch rebates', () => {
    it('supports Hitch rebate values from 1 to 6 and totals them sheet-wide', () => {
        const tiles = [
            { tags: ['Hitch 1'] },
            { tags: ['Hitch 5'] },
            { tags: ['Keen'] }
        ];
        assert.equal(getHitchValue(tiles[0]), 1);
        assert.equal(getHitchValue(tiles[1]), 5);
        assert.equal(calculateHitchRebateTotal(tiles), 6);
    });

    it('clamps out-of-range Hitch values to the valid 1-6 rebate range', () => {
        assert.equal(getHitchValue({ tags: ['Hitch 0'] }), 1);
        assert.equal(getHitchValue({ tags: ['Hitch 9'] }), 6);
    });
});

describe('armor soak', () => {
    it('counts armor coverage and Ironclad soak from active armor tiles', () => {
        const armor = {
            id: 'plate',
            name: 'Plate',
            dice: ['d6'],
            tags: ['Ironclad'],
            armorType: { material: 'Hard', coverage: 'Closed' }
        };
        const details = calculateArmorSoakDetails([armor]);

        assert.equal(calculateArmorSoak([armor]), 5);
        assert.equal(details.total, 5);
        assert.deepEqual(details.sources.map(source => ({
            tileName: source.tileName,
            baseSoak: source.baseSoak,
            ironcladSoak: source.ironcladSoak,
            total: source.total
        })), [{ tileName: 'Plate', baseSoak: 3, ironcladSoak: 2, total: 5 }]);
    });

    it('ignores buried armor for soak', () => {
        assert.equal(calculateArmorSoak([{
            id: 'buried',
            name: 'Buried Plate',
            dice: ['d8'],
            tags: ['Ironclad'],
            isBuried: true,
            armorType: { material: 'Hard', coverage: 'Closed' }
        }]), 0);
    });

    it('ignores burned armor for soak', () => {
        assert.equal(calculateArmorSoak([{
            id: 'burned',
            name: 'Burned Plate',
            dice: ['d8'],
            tags: ['Ironclad'],
            isBurnt: true,
            armorType: { material: 'Hard', coverage: 'Closed' }
        }]), 0);
    });

    it('ignores armor soak while gear tags are broken', () => {
        const armor = {
            id: 'broken',
            type: 'Gear',
            gearSubtype: 'Armor',
            name: 'Broken Plate',
            dice: ['d8'],
            tags: ['Ironclad'],
            gearBroken: true,
            armorType: { material: 'Hard', coverage: 'Closed' }
        };

        assert.equal(calculateArmorSoak([armor]), 0);
        assert.deepEqual(calculateArmorSoakDetails([armor]), { total: 0, sources: [] });
    });
});

describe('weapon templates', () => {
    it('exposes PDF starting weapon templates with range, skill, and tags', () => {
        const longBlade = getWeaponTemplateById('long-blade');
        assert.deepEqual(
            {
                name: longBlade.name,
                category: longBlade.category,
                range: longBlade.range,
                skill: longBlade.skill,
                tags: longBlade.startingTags
            },
            {
                name: 'Long Blade',
                category: 'Melee',
                range: 'Close',
                skill: 'Duel',
                tags: ['Sharp']
            }
        );
        assert.deepEqual(getWeaponTemplateTags('machine-gun'), ['Reload', 'Recoil', 'Sweep']);
    });

    it('groups weapon templates by range category for the builder UI', () => {
        const groups = getWeaponTemplatesByCategory();
        assert.deepEqual(groups.map(group => group.category), ['Melee', 'Near', 'Far', 'Burst']);
        assert.ok(groups.find(group => group.category === 'Far').templates.some(template => template.id === 'machine-gun'));
    });

    it('formats template preview details including tags and extra XP', () => {
        assert.equal(
            formatWeaponTemplateDetails(getWeaponTemplateById('machine-gun')),
            'Far · Short · Firearms · Tags: Reload, Recoil, Sweep · +2 XP'
        );
    });
});

describe('estimateTileXpDetails', () => {
    it('returns the same xp number as estimateTileXp', () => {
        const cases = [
            { dice: ['d6'], tags: ['Keen'] },
            { dice: ['d4'], tags: ['Chain Foo'] },
            { dice: ['d8'], tags: ['Old', 'Worn'] },
            { dice: ['d6'], tags: ['Ironclad', 'Tough'], armor: { material: 'Hard', coverage: 'Full' } }
        ];
        for (const c of cases) {
            const details = engine.estimateTileXpDetails(c.dice, c.tags, c.armor);
            const number = engine.estimateTileXp(c.dice, c.tags, c.armor);
            assert.equal(details.xp, number, `xp mismatch for ${JSON.stringify(c)}`);
        }
    });

    it('returns an empty unknownTags list when every tag is recognized', () => {
        const r = engine.estimateTileXpDetails(['d6'], ['Keen', 'Sharp', 'Old', 'Chain Foo', 'Hitch 3']);
        assert.deepEqual(r.unknownTags, []);
    });

    it('reports unknown tags so the UI can warn the player about typos', () => {
        // 'Frobnicate' isn't a known mechanical tag; it falls through to the
        // default +2 XP. The detail call should surface it.
        const r = engine.estimateTileXpDetails(['d6'], ['Keen', 'Frobnicate']);
        assert.deepEqual(r.unknownTags, ['Frobnicate']);
        assert.equal(r.xp, 3 + 2 + 2); // d6 base + Keen +2 + Frobnicate default +2
    });

    it('reports multiple unknowns in their original case for the warning', () => {
        const r = engine.estimateTileXpDetails(['d4'], ['MadeUp', 'Whatever']);
        assert.deepEqual(r.unknownTags, ['MadeUp', 'Whatever']);
    });

    it('does NOT flag valid structural tags (Build/Detail/Crit/Shield/Range/Duration/exotics) as unknown', () => {
        // These are valid rulebook tag categories. Their specific XP rules
        // aren't wired into classifyTagForXp yet (they all default to +2),
        // but they ARE recognized as valid so the UI does not warn about
        // them. A follow-up can replace the +2 default with rule-accurate
        // numbers without affecting this guarantee.
        const validStructuralTags = [
            'Build: Cyber', 'Detail: Fast', 'Crit: JOLT', 'Shield: Deflect',
            'Range: Short', 'Duration: Instant', 'Motorized: BODY',
            'Bestial', 'Celestial', 'Cyber'
        ];
        const r = engine.estimateTileXpDetails(['d6'], validStructuralTags);
        assert.deepEqual(r.unknownTags, [],
            'Structural tags should be recognized (no typo warning) even when ' +
            'their XP defaults to +2.');
    });

    it('does not flag exempt-suffixed known tags as unknown', () => {
        // 'Keen (Exempt)' is a known tag with the exempt suffix stripped.
        const r = engine.estimateTileXpDetails(['d6'], ['Keen (Exempt)']);
        assert.deepEqual(r.unknownTags, []);
    });

    it('does not flag empty or whitespace-only tags as unknown', () => {
        // tileTagList already filters these out, but defend in depth.
        const r = engine.estimateTileXpDetails(['d6'], ['', '   ']);
        assert.deepEqual(r.unknownTags, []);
    });
});

describe('calculateResourceMaxes', () => {
    it('adds 1 per matching color slot, plus die-steps for Tough/Vital/Quick', () => {
        const tiles = [
            { colors: ['Red', 'Green'], dice: ['d6'], tags: 'Tough' }, // hp+1, en+1, Tough -> hp += 2 steps
            {
                boxes: [
                    { type: 'color', color: 'Blue' },
                    { type: 'shadow', kind: 'Id', resource: 'rx' }
                ],
                dice: ['d4'],
                tags: ''
            }      // rx+2, sh+1
        ];
        assert.deepEqual(engine.calculateResourceMaxes(tiles), { hp: 3, en: 1, rx: 2, sh: 1 });
    });

    it('calculateShadowMax counts Qi/Id boxes', () => {
        const tiles = [{
            boxes: [
                { type: 'shadow', kind: 'Qi', resource: 'hp' },
                { type: 'shadow', kind: 'Id', resource: 'en' }
            ],
            dice: ['d4'],
            tags: ''
        }];
        assert.equal(engine.calculateShadowMax(tiles), 2);
    });

    it('ignores buried tiles for resource pools but not burnt tiles', () => {
        const tiles = [
            { colors: ['Red', 'Orange'], dice: ['d6'], tags: 'Tough', isBuried: true },
            { colors: ['Green', 'Yellow'], dice: ['d4'], tags: 'Vital', isBurnt: true }
        ];
        assert.deepEqual(engine.calculateResourceMaxes(tiles), { hp: 0, en: 3, rx: 0, sh: 0 });
    });

    it('ignores ammo gear for resource pools', () => {
        const tiles = [
            { type: 'Gear', gearSubtype: 'Ammo', colors: ['Red', 'Orange'], dice: [], tags: [] },
            { colors: ['Blue', 'Purple'], dice: ['d4'], tags: [] }
        ];
        assert.deepEqual(engine.calculateResourceMaxes(tiles), { hp: 0, en: 0, rx: 2, sh: 0 });
    });

    it('turns off gear resource tags while gear tags are broken', () => {
        const tiles = [
            { type: 'Gear', gearSubtype: 'Custom', colors: ['Red'], dice: ['d6'], tags: ['Tough'], gearBroken: true },
            { type: 'Trait', colors: ['Green'], dice: ['d6'], tags: ['Vital'], gearBroken: true }
        ];

        assert.deepEqual(engine.calculateResourceMaxes(tiles), { hp: 1, en: 3, rx: 0, sh: 0 });
    });
});

describe('new Shadow resources and XP', () => {
    it('keeps ordinary non-Shadow resource math unchanged', () => {
        const tiles = [{ colors: ['Red', 'Green'], dice: ['d6'], tags: [] }];
        assert.deepEqual(engine.calculateResourceMaxes(tiles), { hp: 1, en: 1, rx: 0, sh: 0 });
        assert.equal(engine.calculateShadowMax(tiles), 0);
    });

    it('a Qi box assigned to Energy contributes Energy plus Shadow', () => {
        const tiles = [{
            boxes: [
                { type: 'shadow', kind: 'Qi', resource: 'en' },
                { type: 'color', color: 'Red' }
            ],
            dice: ['d4'],
            tags: []
        }];
        assert.deepEqual(engine.calculateResourceMaxes(tiles), { hp: 1, en: 1, rx: 0, sh: 1 });
    });

    it('an Id box assigned to Reflex contributes Reflex plus Shadow', () => {
        const tiles = [{
            boxes: [{ type: 'shadow', kind: 'Id', resource: 'rx' }],
            dice: ['d4'],
            tags: []
        }];
        assert.deepEqual(engine.calculateResourceMaxes(tiles), { hp: 0, en: 0, rx: 1, sh: 1 });
    });

    it('buried Qi/Id boxes contribute neither normal resources nor Shadow', () => {
        const tiles = [{
            boxes: [
                { type: 'shadow', kind: 'Qi', resource: 'en' },
                { type: 'shadow', kind: 'Id', resource: 'rx' }
            ],
            dice: ['d4'],
            tags: [],
            isBuried: true
        }];
        assert.deepEqual(engine.calculateResourceMaxes(tiles), { hp: 0, en: 0, rx: 0, sh: 0 });
    });

    it('charges 2 XP per Qi or Id box and does not include them in stat XP', () => {
        assert.equal(engine.estimateTileXp(['d4'], [], null, {
            boxes: [{ type: 'shadow', kind: 'Qi', resource: 'hp' }]
        }), 3);
        assert.equal(engine.estimateTileXp(['d4'], [], null, {
            boxes: [{ type: 'shadow', kind: 'Id', resource: 'rx' }]
        }), 3);
        assert.equal(engine.calculateStatXp({ BODY: 'd6', Qi: 'd16', Id: 'd16' }), 3);
    });
});

describe('tile call colors', () => {
    it('extracts normal tile box colors for call color seeding', () => {
        assert.deepEqual(getTileNormalCallColors({
            boxes: [
                { type: 'color', color: 'Red' },
                { type: 'color', color: 'Green' }
            ]
        }), ['Red', 'Green']);
    });

    it('ignores Qi and Id boxes when seeding GM call colors', () => {
        assert.deepEqual(getTileNormalCallColors({
            boxes: [
                { type: 'shadow', kind: 'Qi', resource: 'hp' },
                { type: 'color', color: 'Blue' }
            ]
        }), ['Blue']);
    });
});

describe('new Shadow check validation and Aberration', () => {
    const stats = { BODY: 'd6' };
    const qiTile = {
        id: 'qi',
        name: 'Bright Step',
        boxes: [{ type: 'shadow', kind: 'Qi', resource: 'en' }],
        dice: ['d4'],
        tags: []
    };
    const idTile = {
        id: 'id',
        name: 'Dark Step',
        boxes: [{ type: 'shadow', kind: 'Id', resource: 'rx' }],
        dice: ['d4'],
        tags: []
    };

    it('allows Qi-only and Id-only pools', () => {
        assert.equal(engine.compilePool(['Red'], stats, qiTile, [], [qiTile], []).error, null);
        assert.equal(engine.compilePool(['Red'], stats, idTile, [], [idTile], []).error, null);
    });

    it('rejects pools that mix Qi and Id tiles', () => {
        const res = engine.compilePool(['Red'], stats, qiTile, [idTile], [qiTile, idTile], []);
        assert.match(res.error, /Qi tiles or Id tiles, but not both/i);
    });

    it('moves Aberration toward Risen or Fallen by check use', () => {
        assert.equal(adjustAberrationForShadowUse(0, 'Qi'), 1);
        assert.equal(adjustAberrationForShadowUse(1, 'Id'), 0);
        assert.equal(adjustAberrationForShadowUse(0, 'Id'), -1);
    });
});

describe('new Shadow alignment and abilities', () => {
    const ids = (abilities) => abilities.map(ability => ability.id).sort();

    it('classifies baseline Neutral, Rising, Falling, and Aberrant states', () => {
        assert.deepEqual(classifyAberration(0, 3, {}), ['Neutral']);
        assert.ok(classifyAberration(1, 3, {}).includes('Rising'));
        assert.ok(classifyAberration(-1, 3, {}).includes('Falling'));
        assert.ok(classifyAberration(4, 3, {}).includes('Risen Aberrant'));
        assert.ok(classifyAberration(-4, 3, {}).includes('Fallen Aberrant'));
    });

    it('applies Dusk, Dawn, and Terminator boundary modifiers', () => {
        assert.ok(classifyAberration(1, 3, { terminator: 1 }).includes('Neutral'));
        assert.ok(classifyAberration(-1, 3, { terminator: 1 }).includes('Neutral'));
        assert.ok(classifyAberration(-1, 3, { dusk: 2 }).includes('Rising'));
        assert.ok(classifyAberration(0, 3, { dawn: 1 }).includes('Falling'));
        assert.deepEqual(classifyAberration(-1, 3, { dusk: 3 }).sort(), ['Falling', 'Rising'].sort());
    });

    it('returns Neutral 0 abilities from both sides but not stronger side abilities', () => {
        assert.deepEqual(ids(getAvailableShadowAbilities(0, 3, {})), [
            'id-impact',
            'id-press',
            'qi-color',
            'qi-test'
        ].sort());
    });

    it('returns Rising, Falling, and Aberrant ability sets', () => {
        assert.ok(ids(getAvailableShadowAbilities(3, 3, {})).includes('qi-heal'));
        assert.ok(ids(getAvailableShadowAbilities(-3, 3, {})).includes('id-drain'));
        assert.ok(ids(getAvailableShadowAbilities(4, 3, {})).includes('qi-risen-blast'));
        assert.ok(ids(getAvailableShadowAbilities(-4, 3, {})).includes('id-fallen-blast'));
    });
});

describe('Aberrant Blast Zone die effects', () => {
    it('boosts or suppresses only dice above d6', () => {
        assert.equal(applyAberrantDieStepEffects('d4', { fallen: true }), 'd4');
        assert.equal(applyAberrantDieStepEffects('d6', { fallen: true }), 'd6');
        assert.equal(applyAberrantDieStepEffects('d8', { fallen: true }), 'd10');
        assert.equal(applyAberrantDieStepEffects('d16', { fallen: true }), 'd16');

        assert.equal(applyAberrantDieStepEffects('d6', { risen: true }), 'd6');
        assert.equal(applyAberrantDieStepEffects('d8', { risen: true }), 'd6');
        assert.equal(applyAberrantDieStepEffects('d10', { risen: true }), 'd8');
    });

    it('cancels when both Risen and Fallen effects are active', () => {
        assert.equal(getAberrantDieStepNet({ risen: true, fallen: true }), 0);
        assert.equal(applyAberrantDieStepEffects('d10', { risen: true, fallen: true }), 'd10');
    });
});

describe('new Shadow tags', () => {
    it('validates placement requirements', () => {
        assert.match(validateShadowTags({ colors: ['Red'], tags: ['Day'] })[0].message, /Qi/);
        assert.match(validateShadowTags({ colors: ['Red'], tags: ['Night'] })[0].message, /Id/);
        assert.equal(validateShadowTags({ boxes: [{ type: 'shadow', kind: 'Qi', resource: 'hp' }], tags: ['Dusk'] }).length, 0);
        assert.equal(validateShadowTags({ boxes: [{ type: 'shadow', kind: 'Id', resource: 'rx' }], tags: ['Dawn'] }).length, 0);
        assert.equal(validateShadowTags({ boxes: [{ type: 'shadow', kind: 'Qi', resource: 'en' }], tags: ['Terminator'] }).length, 0);
    });

    it('does not offer old Light and Gloam as valid new Shadow behavior', () => {
        assert.match(validateShadowTags({ boxes: [{ type: 'shadow', kind: 'Qi', resource: 'hp' }], tags: ['Light'] })[0].message, /old Shadow/);
        assert.match(validateShadowTags({ boxes: [{ type: 'shadow', kind: 'Id', resource: 'rx' }], tags: ['Gloam'] })[0].message, /old Shadow/);
    });
});

describe('compilePool', () => {
    const stats = { BODY: 'd6', MIND: 'd8' }; // Red, Blue

    it('pulls stat dice for selected call colors', () => {
        const res = engine.compilePool(['Red'], stats, null, [], [], []);
        assert.equal(res.error, null);
        assert.equal(res.dice.length, 1);
        assert.equal(res.adds, 2);
    });

    it('errors when no call color is selected', () => {
        const res = engine.compilePool([], stats, null, [], [], []);
        assert.match(res.error, /at least 1 color/i);
    });

    it('adds a matching call tile’s dice', () => {
        const callTile = { id: '1', name: 'Sword', colors: ['Red', 'Blue'], dice: ['d8'], tags: '' };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile], []);
        assert.equal(res.error, null);
        assert.equal(res.dice.length, 2); // BODY d6 + tile d8
    });

    it('applies Aberrant Blast Zone die-step effects to compiled pools', () => {
        const callTile = { id: '1', name: 'Sword', colors: ['Red'], dice: ['d8'], tags: '' };
        const burnTile = { id: '2', name: 'Bomb', colors: ['Red'], dice: ['d10'], tags: '' };
        const res = engine.compilePool(['Red'], stats, callTile, [burnTile], [callTile, burnTile], ['d12'], {
            aberrantEffects: { fallen: true }
        });
        assert.equal(res.error, null);
        assert.deepEqual(res.dice.map(die => die.die), ['d6', 'd10', 'd12', 'd14']);
        assert.deepEqual(res.dieStepEffects.map(effect => [effect.from, effect.to]), [
            ['d8', 'd10'],
            ['d10', 'd12'],
            ['d12', 'd14']
        ]);

        const suppressed = engine.compilePool(['Red'], stats, callTile, [burnTile], [callTile, burnTile], ['d12'], {
            aberrantEffects: { risen: true }
        });
        assert.equal(suppressed.error, null);
        assert.deepEqual(suppressed.dice.map(die => die.die), ['d6', 'd6', 'd8', 'd10']);
    });

    it('rejects a burnt call tile', () => {
        const callTile = { id: '1', name: 'Sword', colors: ['Red'], dice: ['d8'], tags: '', isBurnt: true };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile], []);
        assert.match(res.error, /burnt/i);
    });

    it('rejects a buried call tile', () => {
        const callTile = { id: '1', name: 'Sword', colors: ['Red'], dice: ['d8'], tags: '', isBuried: true };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile], []);
        assert.match(res.error, /buried/i);
    });

    it('rejects ammo as a call tile', () => {
        const callTile = { id: '1', name: 'Pistol Ammo', type: 'Gear', gearSubtype: 'Ammo', colors: [], dice: [], tags: '' };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile], []);
        assert.match(res.error, /ammo/i);
    });

    it('rejects a call tile that shares no call color', () => {
        const callTile = { id: '1', name: 'Sword', colors: ['Green'], dice: ['d8'], tags: '' };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile], []);
        assert.match(res.error, /does not match/i);
    });

    it('requires a call tile before burn tiles', () => {
        const burn = { id: '2', name: 'Bomb', colors: ['Red'], dice: ['d6'], tags: '' };
        const res = engine.compilePool(['Red'], stats, null, [burn], [burn], []);
        assert.match(res.error, /Call Tile/i);
    });

    it('grants +1 add per burn tile', () => {
        const callTile = { id: '1', name: 'Sword', colors: ['Red'], dice: ['d8'], tags: '' };
        const burn = { id: '2', name: 'Bomb', colors: ['Red'], dice: ['d6'], tags: '' };
        const res = engine.compilePool(['Red'], stats, callTile, [burn], [callTile, burn], []);
        assert.equal(res.error, null);
        assert.equal(res.adds, 3); // base 2 + 1 burn
    });

    it('resolves a Chain tag, pulling the chained tile’s dice and +1 add', () => {
        const helper = { id: 'h', name: 'Helper', colors: ['Red'], dice: ['d10'], tags: '' };
        const callTile = { id: '1', name: 'Sword', colors: ['Red'], dice: ['d8'], tags: 'Chain Helper' };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile, helper], []);
        assert.equal(res.error, null);
        assert.equal(res.dice.length, 3); // BODY d6 + Sword d8 + Helper d10
        assert.equal(res.adds, 3);        // base 2 + chain 1
        assert.equal(res.chainOptions.length, 1);
    });

    it('resolves a World tag as a free chain link', () => {
        const helper = { id: 'h', name: 'Helper', colors: ['Red'], dice: ['d10'], tags: '' };
        const callTile = { id: '1', name: 'Sword', colors: ['Red'], dice: ['d8'], tags: 'World Helper' };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile, helper], []);
        assert.equal(res.error, null);
        assert.equal(res.dice.length, 3);
        assert.equal(res.adds, 3);
        assert.equal(res.chainOptions.length, 1);
        assert.equal(res.chainOptions[0].type, 'world');
    });

    it('requires a chain color choice when a link can follow multiple selected colors', () => {
        const spell = { id: 'spell', name: 'Spell', colors: ['Yellow', 'Purple'], dice: ['d6'], tags: 'Chain Twist' };
        const twist = { id: 'twist', name: 'Twist', colors: ['Yellow', 'Purple'], dice: ['d6'], tags: '' };
        const res = engine.compilePool(['Yellow', 'Purple'], stats, spell, [], [spell, twist], []);

        assert.match(res.error, /Choose one chain color/i);
        assert.equal(res.chainOptions[0].status, 'needs-color');
        assert.deepEqual(res.chainOptions[0].availableColors, ['Yellow', 'Purple']);
    });

    it('keeps recursive chains on the initially selected chain color', () => {
        const spell = { id: 'spell', name: 'Spell', colors: ['Yellow', 'Purple'], dice: ['d6'], tags: 'Chain Twist' };
        const twist = { id: 'twist', name: 'Twist', colors: ['Yellow', 'Purple'], dice: ['d6'], tags: 'Chain Bridge' };
        const bridge = { id: 'bridge', name: 'Bridge', colors: ['Yellow', 'Blue'], dice: ['d6'], tags: 'Chain Outlet' };
        const outlet = { id: 'outlet', name: 'Outlet', colors: ['Blue', 'Green'], dice: ['d6'], tags: '' };

        const res = engine.compilePool(['Yellow', 'Purple', 'Blue', 'Green'], stats, spell, [], [spell, twist, bridge, outlet], [], {
            chainColorSelections: { 'spell:chain:0:twist': 'Yellow' }
        });

        assert.match(res.error, /cannot continue on Yellow/i);
        assert.equal(res.chainOptions[2].status, 'blocked');
        assert.equal(res.chainOptions[2].inheritedColor, 'Yellow');
    });

    it('allows a recursive chain when every link can continue on the chosen color', () => {
        const spell = { id: 'spell', name: 'Spell', colors: ['Yellow', 'Purple'], dice: ['d6'], tags: 'Chain Twist' };
        const twist = { id: 'twist', name: 'Twist', colors: ['Yellow', 'Purple'], dice: ['d6'], tags: 'Chain Bridge' };
        const bridge = { id: 'bridge', name: 'Bridge', colors: ['Yellow', 'Blue'], dice: ['d6'], tags: '' };

        const res = engine.compilePool(['Yellow', 'Purple', 'Blue'], stats, spell, [], [spell, twist, bridge], [], {
            chainColorSelections: { 'spell:chain:0:twist': 'Yellow' }
        });

        assert.equal(res.error, null);
        assert.equal(res.adds, 4);
        assert.deepEqual(res.chainOptions.map(chain => chain.selectedColor), ['Yellow', 'Yellow']);
    });

    it('rejects buried chain and burn tiles', () => {
        const buriedHelper = { id: 'h', name: 'Helper', colors: ['Red'], dice: ['d10'], tags: '', isBuried: true };
        const callTile = { id: '1', name: 'Sword', colors: ['Red'], dice: ['d8'], tags: 'Chain Helper' };
        const chainRes = engine.compilePool(['Red'], stats, callTile, [], [callTile, buriedHelper], []);
        assert.match(chainRes.error, /buried/i);

        const buriedBurn = { id: '2', name: 'Bomb', colors: ['Red'], dice: ['d6'], tags: '', isBuried: true };
        const plainCallTile = { id: '3', name: 'Axe', colors: ['Red'], dice: ['d8'], tags: '' };
        const burnRes = engine.compilePool(['Red'], stats, plainCallTile, [buriedBurn], [plainCallTile, buriedBurn], []);
        assert.match(burnRes.error, /buried/i);
    });

    it('reports Hitch EN cost for called tiles and rejects Hitched burn tiles', () => {
        const hitched = { id: 'h', name: 'Oath', colors: ['Red'], dice: ['d6'], tags: 'Hitch 5' };
        assert.equal(getHitchValue(hitched), 5);
        assert.equal(isHitchedTile(hitched), true);

        const callRes = engine.compilePool(['Red'], stats, hitched, [], [hitched], []);
        assert.equal(callRes.error, null);
        assert.deepEqual(callRes.resourceCosts.map(cost => ({
            resource: cost.resource,
            amount: cost.amount,
            sourceTileName: cost.sourceTileName
        })), [{ resource: 'en', amount: 1, sourceTileName: 'Oath' }]);

        const callTile = { id: '1', name: 'Sword', colors: ['Red'], dice: ['d8'], tags: '' };
        const burnRes = engine.compilePool(['Red'], stats, callTile, [hitched], [callTile, hitched], []);
        assert.match(burnRes.error, /cannot be burned/i);
    });

    it('turns off gear Hitch and Chain tags while gear tags are broken', () => {
        const helper = { id: 'helper', name: 'Helper', colors: ['Red'], dice: ['d10'], tags: '' };
        const brokenGear = {
            id: 'gear',
            type: 'Gear',
            name: 'Cracked Winch',
            colors: ['Red'],
            dice: ['d6'],
            tags: ['Hitch 5', 'Chain Helper'],
            gearBroken: true
        };

        assert.equal(getHitchValue(brokenGear), 5);
        assert.equal(isHitchedTile(brokenGear), false);

        const res = engine.compilePool(['Red'], stats, brokenGear, [], [brokenGear, helper], []);
        assert.equal(res.error, null);
        assert.equal(res.adds, 2);
        assert.equal(res.chainOptions.length, 0);
        assert.deepEqual(res.resourceCosts, []);
        assert.deepEqual(res.dice.map(die => `${die.source}:${die.die}`), [
            'Stat (BODY):d6',
            'Tile (Cracked Winch):d6'
        ]);
    });

    it('allows Hitched tiles as extra called dice without granting burn Adds', () => {
        const callTile = { id: '1', name: 'Sword', colors: ['Red'], dice: ['d8'], tags: '' };
        const hitched = { id: 'h', name: 'Oath', colors: ['Red'], dice: ['d6'], tags: 'Hitch 5' };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile, hitched], [], {
            hitchCallTiles: [hitched]
        });

        assert.equal(res.error, null);
        assert.equal(res.adds, 2);
        assert.ok(res.dice.some(die => die.source === 'Tile (Sword)' && die.die === 'd8'));
        assert.ok(res.dice.some(die => die.source === 'Tile (Oath)' && die.die === 'd6'));
        assert.deepEqual(res.resourceCosts.map(cost => ({
            resource: cost.resource,
            amount: cost.amount,
            sourceTileName: cost.sourceTileName,
            reason: cost.reason
        })), [{ resource: 'en', amount: 1, sourceTileName: 'Oath', reason: 'Hitch' }]);
    });

    it('resolves tags and chains on extra called Hitch tiles', () => {
        const callTile = { id: '1', name: 'Sword', colors: ['Red'], dice: ['d8'], tags: '' };
        const hitched = { id: 'h', name: 'Oath', colors: ['Red'], dice: ['d6'], tags: ['Hitch 5', 'Drain', 'Chain Helper'] };
        const helper = { id: 'helper', name: 'Helper', colors: ['Red'], dice: ['d4'], tags: '' };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile, hitched, helper], [], {
            hitchCallTiles: [hitched]
        });

        assert.equal(res.error, null);
        assert.equal(res.adds, 3);
        assert.deepEqual(res.dice.map(die => `${die.source}:${die.die}`), [
            'Stat (BODY):d6',
            'Tile (Sword):d8',
            'Tile (Oath):d6',
            'Chain (Helper):d4'
        ]);
        assert.deepEqual(res.resourceCosts.map(cost => ({
            resource: cost.resource,
            amount: cost.amount,
            sourceTileName: cost.sourceTileName,
            reason: cost.reason
        })), [
            { resource: 'en', amount: 1, sourceTileName: 'Oath', reason: 'Hitch' },
            { resource: 'hp', amount: 1, sourceTileName: 'Oath', reason: 'Drain' }
        ]);
        assert.ok(res.chainOptions.some(chain => (
            chain.sourceTileName === 'Oath'
            && chain.targetTileName === 'Helper'
            && chain.status === 'active'
        )));
    });

    it('reports Arcane sacrifice flaw resource costs by flaw type', () => {
        const spell = { id: 's', name: 'Blood Spell', colors: ['Red'], dice: ['d6'], tags: ['Spell', 'Sap', 'Tire', 'Drain'] };
        const res = engine.compilePool(['Red'], stats, spell, [], [spell], []);
        assert.equal(res.error, null);
        assert.deepEqual(res.resourceCosts.map(cost => ({
            resource: cost.resource,
            amount: cost.amount,
            reason: cost.reason
        })), [
            { resource: 'en', amount: 1, reason: 'Sap' },
            { resource: 'rx', amount: 1, reason: 'Tire' },
            { resource: 'hp', amount: 1, reason: 'Drain' }
        ]);
    });

    it('stacks Hitch and Drain when both are saved as tags', () => {
        const spell = {
            id: 's',
            name: 'Detonate',
            colors: ['Red', 'Id'],
            boxes: [
                { type: 'color', color: 'Red' },
                { type: 'shadow', kind: 'Id', resource: 'en' }
            ],
            dice: ['d8'],
            tags: ['Spell', 'Chain Forge', 'Hitch 3', 'Drain', 'DOWN'],
            isSpell: true
        };
        const forgeSkill = { id: 'forge', name: 'Forge', colors: ['Red'], dice: ['d6'], tags: [], isSpellcastSkill: true };
        const res = engine.compilePool(['Red'], stats, spell, [], [spell, forgeSkill], []);
        assert.equal(res.error, null);
        assert.deepEqual(res.resourceCosts.map(cost => ({
            resource: cost.resource,
            amount: cost.amount,
            reason: cost.reason
        })), [
            { resource: 'en', amount: 1, reason: 'Hitch' },
            { resource: 'hp', amount: 1, reason: 'Drain' }
        ]);
    });

    it('stacks Hitch with Arcane sacrifice flaws saved as spell modifiers', () => {
        const spell = {
            id: 's',
            name: 'Costly Spell',
            colors: ['Red'],
            dice: ['d6'],
            tags: ['Spell', 'Hitch 3'],
            spellState: {
                'spell-mod-val-Drain': '1'
            }
        };
        const res = engine.compilePool(['Red'], stats, spell, [], [spell], []);
        assert.equal(res.error, null);
        assert.deepEqual(res.resourceCosts.map(cost => ({
            resource: cost.resource,
            amount: cost.amount,
            reason: cost.reason
        })), [
            { resource: 'en', amount: 1, reason: 'Hitch' },
            { resource: 'hp', amount: 1, reason: 'Drain' }
        ]);
    });

    it('recognizes legacy plural Arcane sacrifice modifier labels', () => {
        const spell = {
            id: 's',
            name: 'Legacy Spell',
            colors: ['Red'],
            dice: ['d6'],
            tags: ['Spell'],
            spellState: {
                'spell-mod-val-Saps': '1',
                'spell-mod-val-Drains': '1'
            }
        };
        const res = engine.compilePool(['Red'], stats, spell, [], [spell], []);
        assert.equal(res.error, null);
        assert.deepEqual(res.resourceCosts.map(cost => cost.resource), ['en', 'hp']);
    });

    it('surfaces a contextual tag bonus equal to the tile’s die steps', () => {
        const callTile = { id: '1', name: 'Plate', colors: ['Red'], dice: ['d6'], tags: 'Ironclad' };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile], []);
        assert.equal(res.tagBonuses.length, 1);
        assert.equal(res.tagBonuses[0].steps, 2); // d6 = 2 steps
    });

    it('surfaces a Motorized bonus tied to the chosen stat, equal to die steps', () => {
        const callTile = { id: '1', name: 'Chassis', colors: ['Red'], dice: ['d6'], tags: 'Motorized: BODY' };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile], []);
        assert.equal(res.tagBonuses.length, 1);
        assert.equal(res.tagBonuses[0].steps, 2);                 // d6 = 2 steps
        assert.equal(res.tagBonuses[0].tag, 'Motorized (BODY)');
        assert.match(res.tagBonuses[0].context, /BODY/);
    });
});

describe('calculateOptimalTotal', () => {
    it('keeps the highest <adds> dice and sums them', () => {
        const rolled = [{ die: 'd6', val: 5 }, { die: 'd6', val: 3 }, { die: 'd8', val: 6 }];
        const r = engine.calculateOptimalTotal(rolled, 2);
        assert.equal(r.total, 11); // 6 + 5
        assert.equal(r.kept.length, 2);
    });

    it('flags haywire when more than half the dice roll 1', () => {
        assert.equal(engine.calculateOptimalTotal([{ val: 1 }, { val: 1 }, { val: 5 }], 2).isHaywire, true);
        assert.equal(engine.calculateOptimalTotal([{ val: 1 }, { val: 5 }], 2).isHaywire, false);
    });
});


import {
    escapeHtml,
    parseDiceInput,
    parseDiceString,
    getDiceValidationMessage,
    formatTagLimitStatus,
    tagLimitErrorMessage,
    tileTagList
} from '../js/pool.js';

describe('escapeHtml', () => {
    it('escapes <, >, &, ", and \' so injected markup cannot execute', () => {
        const malicious = '<img src=x onerror=alert(1)>';
        assert.equal(
            escapeHtml(malicious),
            '&lt;img src=x onerror=alert(1)&gt;'
        );
        assert.equal(escapeHtml('A & B'), 'A &amp; B');
        assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;');
        assert.equal(escapeHtml("it's"), 'it&#39;s');
    });

    it('handles null and undefined as empty strings', () => {
        assert.equal(escapeHtml(null), '');
        assert.equal(escapeHtml(undefined), '');
    });

    it('coerces numbers to strings', () => {
        assert.equal(escapeHtml(42), '42');
    });
});

describe('parseDiceInput (shared helper)', () => {
    it('separates valid and invalid dice tokens', () => {
        const result = parseDiceInput('d4, d99, D6, garbage');
        assert.deepEqual(result.dice, ['d4', 'd6']);
        assert.deepEqual(result.invalid, ['d99', 'garbage']);
    });

    it('returns empty lists for blank input', () => {
        assert.deepEqual(parseDiceInput(''), { dice: [], invalid: [] });
        assert.deepEqual(parseDiceInput('   '), { dice: [], invalid: [] });
    });
});

describe('parseDiceString', () => {
    it('returns only valid dice', () => {
        assert.deepEqual(parseDiceString('d4, d8, junk'), ['d4', 'd8']);
    });
});

describe('getDiceValidationMessage', () => {
    it('mentions the supported die ranks', () => {
        const msg = getDiceValidationMessage('Tile dice');
        assert.match(msg, /^Tile dice/);
        assert.match(msg, /d3, d4, d6, d8, d10, d12, d14, or d16/);
    });
});

describe('formatTagLimitStatus / tagLimitErrorMessage', () => {
    it('formats a valid tag limit', () => {
        const limit = engine.calculateTagLimit(['d6', 'd8'], ['Keen', 'Sharp']);
        assert.equal(limit.valid, true);
        assert.match(formatTagLimitStatus(limit), /^Tag limit: 2\/5 countable tags\./);
    });

    it('formats an over-limit error and lists countable tags', () => {
        const limit = engine.calculateTagLimit(['d4'], ['Keen', 'Sharp', 'Expert']);
        assert.equal(limit.valid, false);
        const msg = tagLimitErrorMessage('This tile', limit);
        assert.match(msg, /This tile has 3 countable tags, but its dice allow 1/);
        assert.match(msg, /Countable tags: Keen, Sharp, Expert\./);
    });
});


describe('tileTagList', () => {
    it('returns the array as-is for the new storage format', () => {
        assert.deepEqual(tileTagList({ tags: ['Keen', 'Sharp'] }), ['Keen', 'Sharp']);
    });

    it('parses a legacy comma-separated tags string', () => {
        assert.deepEqual(tileTagList({ tags: 'Keen, Sharp , Vital' }), ['Keen', 'Sharp', 'Vital']);
    });

    it('flattens object-shaped tags ({name, xp}) to their name', () => {
        const tile = { tags: [{ name: 'Keen', xp: 2 }, { name: 'Sharp', xp: 2 }] };
        assert.deepEqual(tileTagList(tile), ['Keen', 'Sharp']);
    });

    it('drops empty entries from either format', () => {
        assert.deepEqual(tileTagList({ tags: ['Keen', '', '  '] }), ['Keen']);
        assert.deepEqual(tileTagList({ tags: ',Keen,, ,Sharp,' }), ['Keen', 'Sharp']);
    });

    it('returns an empty array for missing or blank tags', () => {
        assert.deepEqual(tileTagList({}), []);
        assert.deepEqual(tileTagList({ tags: null }), []);
        assert.deepEqual(tileTagList({ tags: '' }), []);
        assert.deepEqual(tileTagList(null), []);
    });
});

describe('v5.02 exotic tag-limit exemptions and templates', () => {
    it('exempts Cyber Core spend tags and the Titan family from the tag limit', () => {
        const result = engine.calculateTagLimit(['d4'], ['Antivenin', 'Titan', 'Kill Shot', 'Keen']);
        assert.equal(result.count, 1); // only Keen counts
        assert.equal(result.valid, true);
    });

    it('treats Crowd tags as Range tags for the tag limit', () => {
        const result = engine.calculateTagLimit(['d4'], ['Crowd 5', 'Keen']);
        assert.equal(result.count, 1);
        assert.equal(result.valid, true);
    });

    it('includes the Kick weapon template (Melee/Touch, Athletics, Throw)', () => {
        const kick = getWeaponTemplateById('kick');
        assert.equal(kick.category, 'Melee');
        assert.equal(kick.range, 'Touch');
        assert.equal(kick.skill, 'Athletics');
        assert.deepEqual(kick.startingTags, ['Throw']);
    });
});

describe('getTileShieldCrits / getDefenseShieldSources', () => {
    it('reads shield crits from prefixed tags, including the multi-crit form', () => {
        const tile = { type: 'Gear', tags: ['Shield: JOLT', 'Shield: BREAK KO BLEED', 'Keen', 'DOWN'] };
        assert.deepEqual(getTileShieldCrits(tile), ['jolt', 'break', 'ko', 'bleed']);
    });

    it('returns no shield crits for BREAK-marked gear', () => {
        const tile = { type: 'Gear', gearBroken: true, tags: ['Shield: JOLT'] };
        assert.deepEqual(getTileShieldCrits(tile), []);
    });

    it('classifies armor vs weapon sources and skips unavailable gear', () => {
        const tiles = [
            { id: 'a', name: 'jacket', type: 'Gear', armorType: { material: 'Soft', coverage: 'Open' }, tags: ['Shield: JOLT'] },
            { id: 'b', name: 'cesti', type: 'Gear', gearSubtype: 'Weapon', tags: ['Shield: DOWN'] },
            { id: 'c', name: 'buried', type: 'Gear', isBuried: true, tags: ['Shield: KO'] },
            { id: 'd', name: 'burnt', type: 'Gear', isBurnt: true, tags: ['Shield: KO'] },
            { id: 'e', name: 'plain', type: 'Gear', tags: ['Keen'] }
        ];
        const sources = getDefenseShieldSources(tiles);
        assert.deepEqual(
            sources.map(source => [source.tileId, source.kind, source.crits]),
            [['a', 'armor', ['jolt']], ['b', 'weapon', ['down']]]
        );
    });
});

describe('compilePool v5.02 additions (Freebie, chain limit, Glitch)', () => {
    const stats = { BODY: 'd6', MIND: 'd8' }; // Red, Blue

    it('adds a Freebie die that duplicates a pool die and charges EN equal to its steps', () => {
        const res = engine.compilePool(['Red'], stats, null, [], [], [], { freebieDie: 'd6' });
        assert.equal(res.error, null);
        assert.deepEqual(res.dice.map(d => [d.source, d.die]), [['Stat (BODY)', 'd6'], ['Freebie', 'd6']]);
        assert.deepEqual(res.resourceCosts, [{
            resource: 'en', amount: 2, sourceTileId: null, sourceTileName: 'Freebie d6', reason: 'Freebie'
        }]);
        assert.equal(res.freebieDie, 'd6');
    });

    it('rejects a Freebie die that does not duplicate a die in the pool', () => {
        const res = engine.compilePool(['Red'], stats, null, [], [], [], { freebieDie: 'd12' });
        assert.match(res.error, /duplicate a die already in the pool/i);
    });

    it('rejects an invalid Freebie die code', () => {
        const res = engine.compilePool(['Red'], stats, null, [], [], [], { freebieDie: 'd20' });
        assert.match(res.error, /freebie die/i);
    });

    it('charges no EN for a d3 Freebie (0 steps)', () => {
        const res = engine.compilePool(['Red'], { BODY: 'd3' }, null, [], [], [], { freebieDie: 'd3' });
        assert.equal(res.error, null);
        assert.deepEqual(res.resourceCosts, []);
    });

    it('labels chained tile dice as Chain sources', () => {
        const callTile = { id: '1', name: 'Kit', colors: ['Red'], dice: ['d6'], tags: ['Chain Tinker'] };
        const target = { id: '2', name: 'Tinker', colors: ['Red'], dice: ['d4'], tags: '' };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile, target], []);
        assert.equal(res.error, null);
        assert.deepEqual(res.dice.map(d => d.source), ['Stat (BODY)', 'Tile (Kit)', 'Chain (Tinker)']);
    });

    it('limits chained tiles to the root tile die steps (p.25)', () => {
        // d4 root = 1 step, so a second chained tile exceeds the limit.
        const callTile = { id: '1', name: 'Kit', colors: ['Red'], dice: ['d4'], tags: ['Chain A', 'Chain B'] };
        const tileA = { id: '2', name: 'A', colors: ['Red'], dice: ['d4'], tags: '' };
        const tileB = { id: '3', name: 'B', colors: ['Red'], dice: ['d4'], tags: '' };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile, tileA, tileB], []);
        assert.match(res.error, /allows at most 1/i);

        // A d6 root (2 steps) supports both chains.
        const widerRoot = { ...callTile, dice: ['d6'] };
        const ok = engine.compilePool(['Red'], stats, widerRoot, [], [widerRoot, tileA, tileB], []);
        assert.equal(ok.error, null);
        assert.equal(ok.adds, 4); // base 2 + two chained Adds
    });

    it('counts nested chains against the root tile limit', () => {
        const callTile = { id: '1', name: 'Kit', colors: ['Red'], dice: ['d4'], tags: ['Chain A'] };
        const tileA = { id: '2', name: 'A', colors: ['Red'], dice: ['d4'], tags: ['Chain B'] };
        const tileB = { id: '3', name: 'B', colors: ['Red'], dice: ['d4'], tags: '' };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile, tileA, tileB], []);
        assert.match(res.error, /allows at most 1/i);
    });

    it('raises the haywire threshold to 2 when a called tile has the Glitch flaw', () => {
        const glitchy = { id: '1', name: 'Optics', colors: ['Red'], dice: ['d6'], tags: ['Glitch'] };
        const clean = { id: '2', name: 'Sword', colors: ['Red'], dice: ['d6'], tags: '' };
        assert.equal(engine.compilePool(['Red'], stats, glitchy, [], [glitchy], []).haywireThreshold, 2);
        assert.equal(engine.compilePool(['Red'], stats, clean, [], [clean], []).haywireThreshold, 1);
    });
});

describe('calculateOptimalTotal haywire threshold', () => {
    const roll = (die, val) => ({ source: 'x', die, val });

    it('defaults to counting only 1s', () => {
        const result = engine.calculateOptimalTotal([roll('d6', 2), roll('d6', 2), roll('d6', 5)], 2);
        assert.equal(result.isHaywire, false);
        assert.equal(result.haywireThreshold, 1);
    });

    it('counts 1s and 2s at threshold 2 (Glitch)', () => {
        const result = engine.calculateOptimalTotal([roll('d6', 2), roll('d6', 2), roll('d6', 5)], 2, { haywireThreshold: 2 });
        assert.equal(result.isHaywire, true);
        assert.equal(result.haywireThreshold, 2);
    });
});

describe('Cyber Core pool (v5.02 p.64)', () => {
    it('counts unburied Cyber-tagged tiles, including exotic Cyber skills and Ammo', () => {
        const tiles = [
            { id: '1', name: 'sense', type: 'Skill', exoticSkill: { id: 'cyber', system: 'Cyber', specialty: 'Cyber', label: 'Cyber', baseXp: 2 }, dice: ['d4'], tags: '' },
            { id: '2', name: 'chassis', type: 'Gear', dice: ['d6'], tags: ['Cyber', 'Ironclad'] },
            { id: '3', name: 'arm', type: 'Gear', dice: ['d4'], tags: ['Build: Cyber'] },
            { id: '4', name: 'supercharger', type: 'Gear', gearSubtype: 'Ammo', dice: [], tags: ['Cyber'] },
            { id: '5', name: 'buried leg', type: 'Gear', isBuried: true, dice: ['d4'], tags: ['Cyber'] },
            { id: '6', name: 'plain sword', type: 'Gear', dice: ['d6'], tags: ['Keen'] }
        ];
        assert.equal(calculateCoreMax(tiles), 4);
        assert.equal(calculateCoreMax([]), 0);
    });

    it('drops the contribution of BREAK-marked Cyber gear but keeps Cyber skill tiles', () => {
        const broken = { id: '1', name: 'arm', type: 'Gear', gearBroken: true, dice: ['d4'], tags: ['Cyber'] };
        const skill = { id: '2', name: 'sense', type: 'Skill', exoticSkill: { id: 'cyber', system: 'Cyber', specialty: 'Cyber', label: 'Cyber', baseXp: 2 }, dice: ['d4'], tags: '' };
        assert.equal(calculateCoreMax([broken, skill]), 1);
    });

    it('collects deduped Core spend abilities with their source tiles', () => {
        const tiles = [
            { id: '1', name: 'chassis', type: 'Gear', dice: ['d6'], tags: ['Wired', 'Ironclad'] },
            { id: '2', name: 'optics', type: 'Gear', dice: ['d4'], tags: ['Reticle', 'Wired'] },
            { id: '3', name: 'buried', type: 'Gear', isBuried: true, dice: ['d4'], tags: ['Machine'] }
        ];
        const abilities = getCoreAbilities(tiles);
        assert.deepEqual(abilities.map(a => a.id), ['reticle', 'wired']);
        const wired = abilities.find(a => a.id === 'wired');
        assert.equal(wired.effect, 'Reduce BLEED');
        assert.deepEqual(wired.sources, ['chassis', 'optics']);
    });
});

describe('Titan subsystem (v5.02 p.69)', () => {
    it('counts Titan tag instances on unburied tiles, stacking duplicates', () => {
        const tiles = [
            { id: '1', name: 'cape', type: 'Gear', dice: ['d6'], tags: ['Titan', 'Titan'] },
            { id: '2', name: 'fists', type: 'Gear', dice: ['d4'], tags: ['Titan', 'Keen'] },
            { id: '3', name: 'buried', type: 'Gear', isBuried: true, dice: ['d4'], tags: ['Titan'] },
            { id: '4', name: 'plain', type: 'Skill', dice: ['d6'], tags: '' }
        ];
        assert.equal(calculateTitanMax(tiles), 3);
        assert.equal(calculateTitanMax([]), 0);
    });

    it('collects Titan abilities with H/V markers and sources', () => {
        const tiles = [
            { id: '1', name: 'cape', type: 'Gear', dice: ['d6'], tags: ['Zero In', 'Pull Punch'] },
            { id: '2', name: 'mask', type: 'Gear', dice: ['d4'], tags: ['Interception'] }
        ];
        const abilities = getTitanAbilities(tiles);
        assert.deepEqual(abilities.map(a => a.id), ['interception', 'pull punch', 'zero in']);
        assert.equal(abilities.find(a => a.id === 'zero in').hv, -2);
        assert.equal(abilities.find(a => a.id === 'pull punch').hv, 1);
        assert.equal(abilities.find(a => a.id === 'interception').hv, null);
        assert.deepEqual(abilities.find(a => a.id === 'zero in').sources, ['cape']);
    });

    it('rerolls dice below their own die steps once, keeping the new value', () => {
        const rolled = [
            { source: 'a', die: 'd6', val: 1 },  // below 2 steps -> reroll
            { source: 'b', die: 'd8', val: 2 },  // below 3 steps -> reroll
            { source: 'c', die: 'd8', val: 3 },  // at 3 steps -> keep
            { source: 'd', die: 'd4', val: 1 }   // d4 is 1 step; 1 >= 1 -> keep
        ];
        const { rolls, rerolls } = engine.applyTitanRerolls(rolled, () => 5);
        assert.deepEqual(rolls.map(r => r.val), [5, 5, 3, 1]);
        assert.deepEqual(rerolls.map(r => [r.die, r.from, r.to]), [['d6', 1, 5], ['d8', 2, 5]]);
    });

    it('flags titanActive in compilePool when a used tile has the Titan tag', () => {
        const stats = { BODY: 'd6' };
        const titanTile = { id: '1', name: 'cape', colors: ['Red'], dice: ['d6'], tags: ['Titan'] };
        const plainTile = { id: '2', name: 'sword', colors: ['Red'], dice: ['d6'], tags: '' };
        assert.equal(engine.compilePool(['Red'], stats, titanTile, [], [titanTile], []).titanActive, true);
        assert.equal(engine.compilePool(['Red'], stats, plainTile, [], [plainTile], []).titanActive, false);
    });
});

describe('special identity tiles (Homeworld p.63, Titan Identity p.69)', () => {
    it('allows a third box only on special identity tiles', () => {
        const boxes = [
            { type: 'color', color: 'Red' },
            { type: 'color', color: 'Blue' },
            { type: 'color', color: 'Yellow' }
        ];
        assert.equal(getTileBoxes({ boxes }).length, 2);
        assert.equal(getTileBoxes({ boxes, specialIdentity: 'titan-identity' }).length, 3);
        assert.equal(getTileBoxes({ boxes, specialIdentity: 'homeworld' }).length, 3);
    });

    it('exempts Build/Shield/Detail tags from the tag limit on Titan Identity tiles', () => {
        const tags = ['Tough', 'Shield: JOLT', 'Expert', 'DOWN'];
        const normal = engine.calculateTagLimit(['d4'], tags);
        assert.equal(normal.count, 4);
        const identity = engine.calculateTagLimit(['d4'], tags, { specialIdentity: 'titan-identity' });
        assert.equal(identity.count, 1); // only the DOWN crit counts
        assert.equal(identity.valid, true);
    });

    it('discounts Build/Shield/Detail tags by 1 XP on Titan Identity tiles, not Crits', () => {
        // d6 (3) + Tough (2-1) + Shield: JOLT (2-1) + DOWN crit (2) = 7
        assert.equal(
            engine.estimateTileXp(['d6'], ['Tough', 'Shield: JOLT', 'DOWN'], null, { specialIdentity: 'titan-identity' }),
            7
        );
        // Without the identity: 3 + 2 + 2 + 2 = 9
        assert.equal(engine.estimateTileXp(['d6'], ['Tough', 'Shield: JOLT', 'DOWN']), 9);
    });

    it('counts a third resource box toward pools', () => {
        const tile = {
            id: '1', name: 'costume', type: 'Gear', dice: ['d4'], tags: '',
            specialIdentity: 'titan-identity',
            boxes: [
                { type: 'color', color: 'Red' },
                { type: 'color', color: 'Red' },
                { type: 'color', color: 'Green' }
            ]
        };
        const maxes = engine.calculateResourceMaxes([tile]);
        assert.equal(maxes.hp, 2);
        assert.equal(maxes.en, 1);
    });
});

describe('Stranger: Bestial resources and pricing (v5.02 p.61)', () => {
    it('adds +1 to the chosen resource per typed Bestial tag', () => {
        const tiles = [
            { id: '1', name: 'tail', type: 'Trait', dice: ['d4'], tags: ['Bestial: HP'], colors: ['Red', 'Orange'] },
            { id: '2', name: 'claws', type: 'Gear', dice: ['d4'], tags: ['Bestial: RX'], colors: ['Red', 'Purple'] },
            { id: '3', name: 'untyped', type: 'Trait', dice: ['d4'], tags: ['Bestial'], colors: ['Green', 'Green'] },
            { id: '4', name: 'buried', type: 'Trait', isBuried: true, dice: ['d4'], tags: ['Bestial: EN'], colors: ['Green', 'Green'] }
        ];
        const maxes = engine.calculateResourceMaxes(tiles);
        // Boxes: hp 3 (Red, Orange, Red), rx 1 (Purple), en 2 (Green x2)
        // + Bestial: HP (+1 hp) + Bestial: RX (+1 rx); untyped and buried add nothing.
        assert.equal(maxes.hp, 4);
        assert.equal(maxes.rx, 2);
        assert.equal(maxes.en, 2);
    });

    it('prices typed Bestial tags like plain Bestial (2 on Skill, 4 elsewhere) and exempts them from the limit', () => {
        assert.equal(engine.estimateTileXp(['d4'], ['Bestial: HP'], null, { tileType: 'Skill' }), 3);  // 1 + 2
        assert.equal(engine.estimateTileXp(['d4'], ['Bestial: HP'], null, { tileType: 'Trait' }), 5);  // 1 + 4
        const limit = engine.calculateTagLimit(['d4'], ['Bestial: HP', 'Keen']);
        assert.equal(limit.count, 1); // only Keen
    });

    it('makes the exotic skill tile\'s own first exotic tag free (covered by base XP)', () => {
        const bestialSkill = { id: 'bestial', system: 'Stranger', specialty: 'Bestial', label: 'Stranger: Bestial', baseXp: 2 };
        // d4 (1) + base 2 + first Bestial tag free = 3 (matches Violet's "sense Cyber 3 XP" pattern).
        assert.equal(engine.estimateTileXp(['d4'], ['Bestial: HP'], null, { tileType: 'Skill', exoticSkill: bestialSkill }), 3);
        // A second copy still pays (2 base + 2 duplicate).
        assert.equal(engine.estimateTileXp(['d4'], ['Bestial: HP', 'Bestial: EN'], null, { tileType: 'Skill', exoticSkill: bestialSkill }), 7);
        // Unrelated exotic skill does not give the tag away.
        const cyberSkill = { id: 'cyber', system: 'Cyber', specialty: 'Cyber', label: 'Cyber', baseXp: 2 };
        assert.equal(engine.estimateTileXp(['d4'], ['Bestial: HP'], null, { tileType: 'Skill', exoticSkill: cyberSkill }), 5);
    });

    it('counts Bestial tiles including exotic Bestial skills', () => {
        const tiles = [
            { id: '1', name: 'flight', type: 'Skill', exoticSkill: { id: 'bestial', system: 'Stranger', specialty: 'Bestial', label: 'Stranger: Bestial', baseXp: 2 }, dice: ['d4'], tags: '' },
            { id: '2', name: 'tail', type: 'Trait', dice: ['d4'], tags: ['Bestial: HP'] },
            { id: '3', name: 'plain', type: 'Trait', dice: ['d4'], tags: '' }
        ];
        assert.equal(calculateBestialTileCount(tiles), 2);
    });
});

describe('Stranger: While X forms (v5.02 p.62)', () => {
    const wolfTile = { id: '1', name: 'feral maw', type: 'Gear', dice: ['d4'], tags: ['While Werewolf'], isBuried: true };
    const humanTile = { id: '2', name: 'day job', type: 'Story', dice: ['d4'], tags: ['Flaw: While Human'], isBuried: false };
    const plainTile = { id: '3', name: 'sword', type: 'Gear', dice: ['d6'], tags: ['Keen'], isBuried: false };

    it('extracts form names preserving display case', () => {
        assert.deepEqual(getTileWhileForms(wolfTile), ['Werewolf']);
        assert.deepEqual(getTileWhileForms(humanTile), ['Human']);
        assert.deepEqual(getTileWhileForms(plainTile), []);
        assert.deepEqual(getCharacterForms([wolfTile, humanTile, plainTile]), ['Werewolf', 'Human']);
    });

    it('buries and unburies While tiles to match the chosen form', () => {
        const tiles = [
            { ...wolfTile, isBuried: true },
            { ...humanTile, isBuried: false },
            { ...plainTile, isBuried: false }
        ];
        const changed = applyFormToTiles(tiles, 'werewolf');
        assert.deepEqual(changed.map(t => t.id).sort(), ['1', '2']);
        assert.equal(tiles[0].isBuried, false); // wolf tile active
        assert.equal(tiles[1].isBuried, true);  // human tile buried
        assert.equal(tiles[2].isBuried, false); // untouched

        applyFormToTiles(tiles, '');
        assert.equal(tiles[0].isBuried, true);
        assert.equal(tiles[1].isBuried, true);
        assert.equal(tiles[2].isBuried, false);
    });
});

describe('Stranger: Celestial rank (v5.02 p.63)', () => {
    it('counts unburied Celestial tiles for the rank', () => {
        const tiles = [
            { id: '1', name: 'dreaming', type: 'Skill', exoticSkill: { id: 'celestial', system: 'Stranger', specialty: 'Celestial', label: 'Stranger: Celestial', baseXp: 2 }, dice: ['d6'], tags: '' },
            { id: '2', name: 'alien ooze', type: 'Story', dice: ['d8'], tags: ['Celestial'] },
            { id: '3', name: 'buried', type: 'Story', isBuried: true, dice: ['d4'], tags: ['Celestial'] }
        ];
        assert.equal(calculateCelestialRank(tiles), 2);
    });

    it('summarizes the aspect from the rank table', () => {
        assert.match(getCelestialAspectSummary(3, 'aural'), /Aural 3.*Medium/);
        assert.match(getCelestialAspectSummary(3, 'astral'), /Astral 3.*6 hours/);
        assert.match(getCelestialAspectSummary(9, 'astral'), /Astral 7.*1 month/); // clamped to 7
        assert.match(getCelestialAspectSummary(2, ''), /pick an Aural or Astral/i);
        assert.equal(getCelestialAspectSummary(0, 'aural'), '');
    });
});

describe('Hinders (v5.02 p.41)', () => {
    it('applies the -3 XP Hinder rebate (Violet\'s cutting one-liner = 6 XP)', () => {
        // d6 (3) + Crit GOAD (3) + Range: Earshot (3) - 3 rebate = 6.
        assert.equal(
            engine.estimateTileXp(['d6'], ['GOAD', 'Range: Earshot'], null, { gearSubtype: 'Hinder', tileType: 'Gear' }),
            6
        );
        // Without the subtype the same tile costs 9.
        assert.equal(engine.estimateTileXp(['d6'], ['GOAD', 'Range: Earshot']), 9);
    });

    it('exposes the five assault types with skills, injuries, and crits', () => {
        assert.equal(HINDER_TYPES.length, 5);
        const guile = HINDER_TYPES.find(type => type.id === 'guile');
        assert.equal(guile.injures, 'Reflex');
        assert.equal(guile.crit, 'HOLD');
        const wiles = HINDER_TYPES.find(type => type.id === 'wiles');
        assert.equal(wiles.injures, 'Energy');
        assert.equal(wiles.crit, 'VOW');
    });

    it('identifies Hinder gear tiles', () => {
        assert.equal(isHinderTile({ type: 'Gear', gearSubtype: 'Hinder' }), true);
        assert.equal(isHinderTile({ type: 'Gear', gearSubtype: 'Weapon' }), false);
        assert.equal(isHinderTile({ type: 'Story', gearSubtype: 'Hinder' }), false);
    });
});

describe('Gizmos and Slivers (v5.02 p.68)', () => {
    it('discounts an unchained Gizmo to 2 XP', () => {
        assert.equal(engine.estimateTileXp(['d6'], ['Gizmo']), 5);               // 3 + 4 - 2
        assert.equal(engine.estimateTileXp(['d6'], ['Gizmo', 'Chain Tinker']), 11); // 3 + 4 + 4
    });

    it('counts gizmo and sliver tiles, skipping buried ones', () => {
        const tiles = [
            { id: '1', name: 'wristband', type: 'Gear', dice: ['d6'], tags: ['Gizmo'] },
            { id: '2', name: 'buried gizmo', type: 'Gear', isBuried: true, dice: ['d4'], tags: ['Gizmo'] },
            { id: '3', name: 'accelerator', type: 'Gear', dice: ['d6'], tags: ['Implant'] },
            { id: '4', name: 'fire breath', type: 'Gear', dice: ['d4'], tags: ['Knack'] },
            { id: '5', name: 'plain', type: 'Gear', dice: ['d6'], tags: ['Keen'] }
        ];
        assert.equal(countGizmoTiles(tiles), 1);
        assert.equal(countSliverTiles(tiles), 2);
    });
});

describe('spell tag-limit handling (v5.02 pp.49, 55-57)', () => {
    it('never counts the Spell marker tag', () => {
        assert.equal(engine.classifyTagForLimit('Spell').counts, false);
    });

    it('exempts the granted Chain tag on spell tiles only', () => {
        // captivate (p.50): d4 spell with Chain Augur + Crit HOLD must be legal.
        const spellLimit = engine.calculateTagLimit(['d4'], ['Spell', 'Chain Augur', 'HOLD'], { isSpell: true });
        assert.equal(spellLimit.count, 1); // only HOLD
        assert.equal(spellLimit.valid, true);

        // On a non-spell tile the Chain tag still counts.
        const gearLimit = engine.calculateTagLimit(['d4'], ['Chain Augur', 'HOLD']);
        assert.equal(gearLimit.count, 2);
        assert.equal(gearLimit.valid, false);
    });

    it('prices the Spell marker at 0 XP', () => {
        assert.equal(engine.estimateTileXp(['d4'], ['Spell']), 1); // just the d4
    });
});

describe('parsed-tag adoption: a GM (Exempt) suffix no longer disables tag mechanics', () => {
    // Before the tag-model refactor, the exempt suffix was stripped for XP
    // and tag limits but broke exact-match lookups in the pool compiler and
    // resource maxes. The suffix only exempts a tag from the limit (p.33);
    // its mechanics stay on. These lock the now-consistent behavior.
    const stats = { BODY: 'd6' }; // Red

    it('keeps the Keen contextual bonus', () => {
        const tile = { id: '1', name: 'Sword', colors: ['Red'], dice: ['d6'], tags: ['Keen (Exempt)'] };
        const res = engine.compilePool(['Red'], stats, tile, [], [tile], []);
        assert.equal(res.error, null);
        assert.deepEqual(res.tagBonuses.map(bonus => bonus.tag), ['Keen']);
    });

    it('keeps Tough resource points', () => {
        const tile = { id: '1', name: 'Vest', dice: ['d6'], tags: ['Tough (Exempt)'] };
        assert.equal(engine.calculateResourceMaxes([tile]).hp, 2); // d6 = 2 steps
    });

    it('keeps Chain links callable', () => {
        const callTile = { id: '1', name: 'Sword', colors: ['Red'], dice: ['d8'], tags: ['Chain Helper (Exempt)'] };
        const helper = { id: '2', name: 'Helper', colors: ['Red'], dice: ['d4'] };
        const res = engine.compilePool(['Red'], stats, callTile, [], [callTile, helper], []);
        assert.equal(res.error, null);
        assert.equal(res.chainOptions.length, 1);
        assert.equal(res.chainOptions[0].targetFound, true);
    });

    it('still prices and limit-exempts the suffixed tag as before', () => {
        assert.equal(engine.estimateTileXp(['d6'], ['Keen (Exempt)']), 5); // 3 + 2, unchanged
        assert.equal(engine.classifyTagForLimit('Keen (Exempt)').counts, false);
    });
});
