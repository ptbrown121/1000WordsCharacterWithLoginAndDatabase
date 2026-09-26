import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PoolEngine } from '../js/pool.js';
import { buildRulesReviewItems } from '../js/rules-review.js';

const engine = new PoolEngine();

describe('buildRulesReviewItems', () => {
    it('flags XP mismatches using exotic skill metadata', () => {
        const state = {
            xpEarned: 100,
            stats: {},
            tiles: [{
                id: 'a',
                type: 'Skill',
                name: 'Twist',
                colors: ['Yellow', 'Purple'],
                dice: ['d4'],
                tags: [],
                xpCost: 1,
                exoticSkill: { id: 'arcana-twist', system: 'Arcana', specialty: 'Twist', label: 'Arcana: Twist', baseXp: 2 }
            }]
        };

        const items = buildRulesReviewItems(state, engine);
        assert.ok(items.some(item => item.category === 'XP' && item.message.includes('current estimate 3')));
        assert.ok(items.some(item => item.category === 'Exotic' && item.message.includes('Arcana: Twist')));
    });

    it('accounts for Qi and Id box XP in sheet-level XP checks', () => {
        const state = {
            xpEarned: 100,
            stats: {},
            tiles: [{
                id: 'shadow-skill',
                type: 'Skill',
                name: 'Shadow Logic',
                colors: ['Red', 'Id'],
                boxes: [
                    { type: 'color', color: 'Red' },
                    { type: 'shadow', kind: 'Id', resource: 'en' }
                ],
                dice: ['d4'],
                tags: [],
                xpCost: 3
            }]
        };

        const items = buildRulesReviewItems(state, engine);
        assert.equal(items.some(item =>
            item.category === 'XP'
            && item.message.includes('Shadow Logic')
        ), false);
    });

    it('flags Arcana spell capacity overages and missing Arcana chains', () => {
        const state = {
            xpEarned: 100,
            stats: {},
            tiles: [
                {
                    id: 'skill',
                    type: 'Skill',
                    name: 'Forge',
                    colors: ['Green', 'Red'],
                    dice: ['d4'],
                    tags: [],
                    xpCost: 3,
                    exoticSkill: { id: 'arcana-forge', system: 'Arcana', specialty: 'Forge', label: 'Arcana: Forge', baseXp: 2 }
                },
                { id: 's1', type: 'Gear', name: 'Spark', isSpell: true, dice: ['d4'], tags: ['Spell', 'Chain Forge'], xpCost: 1 },
                { id: 's2', type: 'Gear', name: 'Ward', isSpell: true, dice: ['d4'], tags: ['Spell', 'Chain Forge'], xpCost: 1 },
                { id: 's3', type: 'Gear', name: 'Loose Spell', isSpell: true, dice: ['d4'], tags: ['Spell'], xpCost: 1 }
            ]
        };

        const items = buildRulesReviewItems(state, engine);
        assert.ok(items.some(item => item.category === 'Arcana' && item.message.includes('2/1 chained spells')));
        assert.ok(items.some(item => item.category === 'Arcana' && item.message.includes('Loose Spell')));
    });

    it('treats World links as Arcana spell chains', () => {
        const state = {
            xpEarned: 100,
            stats: {},
            tiles: [
                {
                    id: 'skill',
                    type: 'Skill',
                    name: 'Forge',
                    colors: ['Green', 'Red'],
                    dice: ['d6'],
                    tags: [],
                    xpCost: 3,
                    exoticSkill: { id: 'arcana-forge', system: 'Arcana', specialty: 'Forge', label: 'Arcana: Forge', baseXp: 2 }
                },
                { id: 's1', type: 'Gear', name: 'Spark', isSpell: true, dice: ['d4'], tags: ['Spell', 'World Forge'], xpCost: 1 }
            ]
        };

        const items = buildRulesReviewItems(state, engine);
        assert.equal(items.some(item => item.category === 'Arcana'), false);
    });

    it('flags sheets with more than 6 XP of Hitch rebates', () => {
        const state = {
            xpEarned: 100,
            stats: {},
            tiles: [
                { id: 'h1', name: 'Oath One', dice: ['d4'], tags: ['Hitch 4'], xpCost: 0 },
                { id: 'h2', name: 'Oath Two', dice: ['d4'], tags: ['Hitch 3'], xpCost: 0 }
            ]
        };

        const items = buildRulesReviewItems(state, engine);
        assert.ok(items.some(item =>
            item.severity === 'high'
            && item.category === 'Hitch'
            && item.message.includes('7/6')
        ));
    });
});

describe('gizmo and sliver caps (v5.02 p.68)', () => {
    it('flags gizmo count over MIND+FOCUS steps', () => {
        const state = {
            xpEarned: 100,
            stats: { MIND: 'd4', FOCUS: '' }, // cap 1
            tiles: [
                { id: 'g1', type: 'Gear', name: 'wristband', dice: ['d4'], tags: ['Gizmo'], xpCost: 3 },
                { id: 'g2', type: 'Gear', name: 'beacon', dice: ['d4'], tags: ['Gizmo'], xpCost: 3 }
            ]
        };
        const items = buildRulesReviewItems(state, engine);
        assert.ok(items.some(item => item.category === 'Gizmo' && /2\/1 gizmos/.test(item.message)));
    });

    it('flags sliver count over BODY+POWER steps and shadow boxes on gizmos', () => {
        const state = {
            xpEarned: 100,
            stats: { BODY: '', POWER: '' }, // cap 0
            tiles: [
                { id: 's1', type: 'Gear', name: 'fire breath', dice: ['d4'], tags: ['Knack'], xpCost: 3 },
                {
                    id: 'g1', type: 'Gear', name: 'shadow gizmo', dice: ['d4'], tags: ['Gizmo'], xpCost: 5,
                    boxes: [{ type: 'shadow', kind: 'Qi', resource: 'hp' }, { type: 'color', color: 'Red' }]
                }
            ]
        };
        const items = buildRulesReviewItems(state, engine);
        assert.ok(items.some(item => item.category === 'Sliver' && /1\/0 slivers/.test(item.message)));
        assert.ok(items.some(item => item.category === 'Gizmo' && /cannot use Qi or Id/.test(item.message)));
    });

    it('does not flag counts at or under the caps', () => {
        const state = {
            xpEarned: 100,
            stats: { MIND: 'd6', FOCUS: 'd4', BODY: 'd4', POWER: '' }, // gizmo cap 3, sliver cap 1
            tiles: [
                { id: 'g1', type: 'Gear', name: 'wristband', dice: ['d4'], tags: ['Gizmo'], xpCost: 3 },
                { id: 's1', type: 'Gear', name: 'implant', dice: ['d4'], tags: ['Implant'], xpCost: 3 }
            ]
        };
        const items = buildRulesReviewItems(state, engine);
        assert.ok(!items.some(item => ['Gizmo', 'Sliver'].includes(item.category)));
    });
});

describe('PR 12 review additions (chains, Hinders)', () => {
    it('flags more Chain tags than the tile has die steps', () => {
        const state = {
            xpEarned: 100,
            storyPointsEarned: 5,
            stats: {},
            tiles: [{ id: 'c1', type: 'Gear', name: 'overlinked kit', dice: ['d4'], tags: ['Chain A', 'Chain B'], xpCost: 9 }]
        };
        const items = buildRulesReviewItems(state, engine);
        assert.ok(items.some(item => item.category === 'Chain' && /2 Chain tags exceed its 1▟/.test(item.message)));
    });

    it('advises when bought Chain tags exceed Story Points earned, excluding spells', () => {
        const state = {
            xpEarned: 100,
            storyPointsEarned: 1,
            stats: {},
            tiles: [
                { id: 'c1', type: 'Gear', name: 'kit', dice: ['d8'], tags: ['Chain A', 'Chain B'], xpCost: 14 },
                { id: 's1', type: 'Gear', name: 'spell', isSpell: true, dice: ['d4'], tags: ['Spell', 'Chain Augur'], xpCost: 1 }
            ]
        };
        const items = buildRulesReviewItems(state, engine);
        assert.ok(items.some(item => /2 bought Chain tags vs 1 Story Points earned/.test(item.message)));

        const enough = buildRulesReviewItems({ ...state, storyPointsEarned: 2 }, engine);
        assert.ok(!enough.some(item => /bought Chain tags vs/.test(item.message)));
    });

    it('nudges Hinders that lack a Range or a crit', () => {
        const state = {
            xpEarned: 100,
            storyPointsEarned: 0,
            stats: {},
            tiles: [{ id: 'h1', type: 'Gear', gearSubtype: 'Hinder', name: 'bare quip', dice: ['d6'], tags: [], xpCost: 0 }]
        };
        const items = buildRulesReviewItems(state, engine);
        assert.ok(items.some(item => item.category === 'Hinder' && /Range tag/.test(item.message)));
        assert.ok(items.some(item => item.category === 'Hinder' && /Special crit/.test(item.message)));

        const complete = buildRulesReviewItems({
            ...state,
            tiles: [{ id: 'h1', type: 'Gear', gearSubtype: 'Hinder', name: 'cutting one-liner', dice: ['d6'], tags: ['Range: Earshot', 'GOAD'], xpCost: 6 }]
        }, engine);
        assert.ok(!complete.some(item => item.category === 'Hinder'));
    });
});

describe('GM rulings (2026-06-12)', () => {
    it('flags the Sticky tag on non-Ammo tiles only', () => {
        const state = {
            xpEarned: 100,
            storyPointsEarned: 0,
            stats: {},
            tiles: [{ id: 'g1', type: 'Gear', name: 'tar bomb', dice: ['d4'], tags: ['Sticky'], xpCost: 5 }]
        };
        const items = buildRulesReviewItems(state, engine);
        assert.ok(items.some(item => item.category === 'Tags' && /Sticky tag is Ammo-only/.test(item.message)));

        const ammo = buildRulesReviewItems({
            ...state,
            tiles: [{ id: 'a1', type: 'Gear', gearSubtype: 'Ammo', name: 'tar rounds', dice: [], tags: ['Sticky'], xpCost: 5 }]
        }, engine);
        assert.ok(!ammo.some(item => /Sticky tag is Ammo-only/.test(item.message)));
    });
});

describe('starting dice checks (p.8)', () => {
    const reviewTile = dice => buildRulesReviewItems({
        xpEarned: 100,
        stats: {},
        tiles: [{ id: 't', type: 'Skill', name: 'Brawn', colors: ['Red', 'Orange'], dice, tags: [], xpCost: engine.estimateTileXp(dice, []) }]
    }, engine);

    it('flags a tile over 3▟ in total, not just a single die over 3▟', () => {
        assert.ok(reviewTile(['d6', 'd6']).some(item => item.message.includes('above the 3▟ starting cap')));
        assert.ok(!reviewTile(['d4', 'd6']).some(item => item.message.includes('starting cap')));
    });

    it('flags a d3 on a tile', () => {
        assert.ok(reviewTile(['d3', 'd4']).some(item => item.message.includes('tiles start at d4')));
        assert.ok(!reviewTile(['d4']).some(item => item.message.includes('tiles start at d4')));
    });
});
