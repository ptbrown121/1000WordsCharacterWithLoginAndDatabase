import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    AMMO_FUNCTION_TIERS,
    REAGENT_TEMPLATES,
    calculateAmmoBuildTotal,
    calculateAmmoLineCost,
    formatReagentDescription,
    getReagentTemplateById,
    getReagentTemplatesBySource,
    suggestAmmoSplit,
    validateAmmoSplit
} from '../js/ammo-rules.js';

describe('calculateAmmoLineCost (v5.02 p.73)', () => {
    it('prices position + trigger + X', () => {
        // First line -3, On Any 0, X=2 -> -1
        assert.equal(calculateAmmoLineCost({ trigger: 'on-any', x: 2 }, 0), -1);
        // Second line +0, On Each +2, X=3 -> 5
        assert.equal(calculateAmmoLineCost({ trigger: 'on-each', x: 3 }, 1), 5);
        // Third line +3, On roll +4, X=5 -> 12
        assert.equal(calculateAmmoLineCost({ trigger: 'on-roll', x: 5 }, 2), 12);
    });

    it('applies riders: Tag-on-fly +X, Sticky +2X, Restriction -1, Repeat +4', () => {
        assert.equal(calculateAmmoLineCost({ trigger: 'on-any', x: 2, tagOnTheFly: true }, 0), 1);   // -3+0+2+2
        assert.equal(calculateAmmoLineCost({ trigger: 'on-any', x: 2, sticky: true }, 0), 3);        // -3+0+2+4
        assert.equal(calculateAmmoLineCost({ trigger: 'on-any', x: 2, restriction: true }, 0), -2);  // -3+0+2-1
        assert.equal(calculateAmmoLineCost({ trigger: 'on-any', x: 2, repeat: true }, 0), 3);        // -3+0+2+4
    });

    it('returns null for disabled lines and clamps X to 1-5', () => {
        assert.equal(calculateAmmoLineCost({ trigger: '', x: 3 }, 0), null);
        assert.equal(calculateAmmoLineCost({ trigger: 'on-any', x: 9 }, 0), 2);  // X clamped to 5: -3+0+5
        assert.equal(calculateAmmoLineCost({ trigger: 'on-any', x: 0 }, 0), -2); // X clamped to 1
    });
});

describe('calculateAmmoBuildTotal matches the printed cards', () => {
    it('buckshot = 5 (XP 2 + Supply 3)', () => {
        // For each 2, give Sweep. / For each 2, give DOWN.
        const build = calculateAmmoBuildTotal({
            lines: [{ trigger: 'on-each', x: 2 }, { trigger: 'on-each', x: 2 }]
        });
        assert.equal(build.total, 5); // (-3+2+2) + (0+2+2)
    });

    it("belladonna = 8 (XP 4 + Supply 4)", () => {
        // For each 3, deal SLOW. / For each 4, deal POISON.
        const build = calculateAmmoBuildTotal({
            lines: [{ trigger: 'on-each', x: 3 }, { trigger: 'on-each', x: 4 }]
        });
        assert.equal(build.total, 8); // (-3+2+3) + (0+2+4)
    });

    it("angel's lace = 4 (XP 1 + Supply 3) and heartstring = 6 (XP 3 + Supply 3)", () => {
        const angelsLace = calculateAmmoBuildTotal({
            lines: [{ trigger: 'on-each', x: 1 }, { trigger: 'on-each', x: 2 }]
        });
        assert.equal(angelsLace.total, 4); // (-3+2+1) + (0+2+2)
        const heartstring = calculateAmmoBuildTotal({
            lines: [{ trigger: 'on-each', x: 3 }, { trigger: 'on-each', x: 2 }]
        });
        assert.equal(heartstring.total, 6); // (-3+2+3) + (0+2+2)
    });

    it('power cell = 7 (XP 2 + Supply 5): On roll, give Sticky Motorized', () => {
        const build = calculateAmmoBuildTotal({
            lines: [{ trigger: 'on-roll', x: 2, sticky: true }]
        });
        assert.equal(build.total, 7); // -3+4+2+4
    });

    it('adds 4 for more than one tool and skips disabled lines', () => {
        const build = calculateAmmoBuildTotal({
            multiTool: true,
            lines: [{ trigger: 'on-any', x: 2 }, { trigger: '', x: 5 }]
        });
        assert.equal(build.lineCount, 1);
        assert.equal(build.total, 3); // 4 + (-3+0+2)
    });
});

describe('ammo split (🞮 XP / 🞧 Supply)', () => {
    it('suggests a balanced split with both at least 1', () => {
        assert.deepEqual(suggestAmmoSplit(6), { xp: 3, supply: 3 });
        assert.deepEqual(suggestAmmoSplit(5), { xp: 2, supply: 3 });
        assert.deepEqual(suggestAmmoSplit(1), { xp: 1, supply: 1 });
        assert.deepEqual(suggestAmmoSplit(-2), { xp: 1, supply: 1 });
    });

    it('validates that the split sums to the effective total', () => {
        assert.equal(validateAmmoSplit(7, 2, 5).valid, true);
        assert.equal(validateAmmoSplit(7, 2, 5).shape, 'cheap, but probably used once');
        assert.equal(validateAmmoSplit(7, 5, 2).shape, 'pricey but sustainable');
        assert.equal(validateAmmoSplit(6, 3, 3).shape, 'balanced, but may run out sometimes');
        assert.equal(validateAmmoSplit(7, 3, 3).valid, false);
        assert.equal(validateAmmoSplit(7, 0, 7).valid, false);
    });
});

describe('reagent templates (pp.72, 74)', () => {
    it('includes the Apothecary, Geomancer, and field ammo groups', () => {
        const sources = getReagentTemplatesBySource().map(group => group.source);
        assert.deepEqual(sources, ['Field Ammo', 'Apothecary', 'Geomancer']);
        assert.equal(REAGENT_TEMPLATES.length, 27);
    });

    it("matches the crafting example: angel's lace XP 1 + heartstring XP 3 = minimum Test 4", () => {
        const angelsLace = getReagentTemplateById('angels-lace');
        const heartstring = getReagentTemplateById('heartstring');
        assert.equal(angelsLace.xp + heartstring.xp, 4);
        assert.equal(angelsLace.supply, 3); // "For each 1, heal Supply EN" healed 3 EN per 1 rolled
    });

    it('formats reagent descriptions with their use and lines', () => {
        const text = formatReagentDescription(getReagentTemplateById('buckshot'));
        assert.match(text, /^For ranged weapon:/);
        assert.match(text, /For each 2, give Sweep\./);
    });

    it('every template has valid xp/supply minimums and at least one line', () => {
        REAGENT_TEMPLATES.forEach(template => {
            assert.ok(template.xp >= 1, `${template.name} xp`);
            assert.ok(template.supply >= 1, `${template.name} supply`);
            assert.ok(template.lines.length >= 1 && template.lines.length <= 3, `${template.name} lines`);
        });
    });

    it('exposes function tier text for all five X values', () => {
        for (let x = 1; x <= 5; x++) assert.ok(AMMO_FUNCTION_TIERS[x]);
    });
});
