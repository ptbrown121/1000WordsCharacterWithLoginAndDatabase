// Ammo Builder math and reagent templates (v5.02 pp.72-75).
//
// The rulebook flags Crafting as unfinished ("the more developed rules for
// Crafting aren't ready yet"), so this stays a loose calculator + template
// data rather than strict validation. Cost model, confirmed against the
// printed examples (buckshot 5, belladonna 8, heartstring 6, power cell 7,
// angel's lace 4):
//
//   total = (multi-tool ? +4 : 0) + sum(lines)
//   line  = position (-3 / 0 / +3) + trigger + X + riders
//   split: total is divided between 🞮 (XP cost, the green X) and
//          🞧 (Supply threshold, the purple cross), both minimum 1.
//
// "Sticky +XX" is read as +2×X (matches power cell: -3 +4 +2 +4 = 7).

export const AMMO_LINE_POSITION_XP = [-3, 0, 3];

export const AMMO_TRIGGERS = {
    'on-any': { label: 'On Any X', xp: 0, description: 'If any die in the pool produces X, the line trips.' },
    'on-each': { label: 'On Each X', xp: 2, description: 'For each X rolled in the pool, the line trips.' },
    'on-roll': { label: 'On roll', xp: 4, description: 'When the roll is made, the line trips, but only once.' }
};

// "Pick X - the cost sets the X." Functions available at each X value.
export const AMMO_FUNCTION_TIERS = {
    1: 'Harm/Heal Supply Energy',
    2: 'Harm/Heal Supply Reflex · Deal/Reduce a 2 XP Crit · Give/Take a 2 XP Build/Detail tag',
    3: 'Harm/Heal Supply Health · Deal/Reduce a 3 XP Crit · Give/Take a 3 XP tag · Maximize [stat] dice · Extend Range/Duration 1 step',
    4: 'Deal/Reduce a 4 XP Crit · Give/Take a 4 XP Build/Detail tag',
    5: 'Recover 1 tile'
};

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

export function calculateAmmoLineCost(line = {}, index = 0) {
    const trigger = AMMO_TRIGGERS[line.trigger];
    if (!trigger) return null; // disabled line

    const x = Math.min(5, Math.max(1, toInt(line.x) || 1));
    let cost = (AMMO_LINE_POSITION_XP[index] ?? 3) + trigger.xp + x;
    if (line.tagOnTheFly) cost += x;
    if (line.sticky) cost += 2 * x;
    if (line.restriction) cost -= 1;
    if (line.repeat) cost += 4;
    return cost;
}

export function calculateAmmoBuildTotal({ multiTool = false, lines = [] } = {}) {
    const lineCosts = lines
        .slice(0, 3)
        .map((line, index) => calculateAmmoLineCost(line, index))
        .filter(cost => cost !== null);

    return {
        lineCosts,
        total: (multiTool ? 4 : 0) + lineCosts.reduce((sum, cost) => sum + cost, 0),
        lineCount: lineCosts.length
    };
}

// Split the total between 🞮 (XP) and 🞧 (Supply), both minimum 1, so the
// effective minimum total is 2. The suggested split is the rulebook's
// "balanced" shape (🞮 = 🞧 where possible).
export function suggestAmmoSplit(total) {
    const effective = Math.max(2, toInt(total));
    const xp = Math.max(1, Math.floor(effective / 2));
    return { xp, supply: Math.max(1, effective - xp) };
}

export function validateAmmoSplit(total, xp, supply) {
    const effective = Math.max(2, toInt(total));
    const xpValue = toInt(xp);
    const supplyValue = toInt(supply);
    const valid = xpValue >= 1 && supplyValue >= 1 && xpValue + supplyValue === effective;
    let shape = '';
    if (xpValue > supplyValue) shape = 'pricey but sustainable';
    else if (xpValue === supplyValue) shape = 'balanced, but may run out sometimes';
    else shape = 'cheap, but probably used once';
    return { valid, expected: effective, shape };
}

// Reagent and ammo templates from the printed cards. `xp` is the green 🞮
// (tile XP cost); `supply` is the purple 🞧 (the threshold an assigned die
// must meet to retain the tile - it is also the amount that "Supply"-keyed
// effects heal or harm).
export const REAGENT_TEMPLATES = [
    // Field ammo examples (p.72)
    { id: 'hollowpoint', name: 'hollowpoint', source: 'Field Ammo', use: 'ranged weapon', xp: 3, supply: 4, replacesTag: 'Reload', lines: ['On any 2, give Sticky Sharp.', 'On any 3, deal PAIN.'] },
    { id: 'buckshot', name: 'buckshot', source: 'Field Ammo', use: 'ranged weapon', xp: 2, supply: 3, replacesTag: 'Reload', lines: ['For each 2, give Sweep.', 'For each 2, give DOWN.'] },
    { id: 'sheaf-arrows', name: 'sheaf arrows', source: 'Field Ammo', use: 'ranged bow weapon', xp: 4, supply: 4, replacesTag: 'Reload', lines: ['On any 2, bow gains Piercing.', 'For each 3, harm Supply HP.', 'On any 4, deal WOUND.'] },
    { id: 'flame-mote', name: 'flame mote', source: 'Field Ammo', use: 'spell pool', xp: 2, supply: 3, replacesTag: '', lines: ['For each 4, deal AFIRE.', 'On any 2, gain Boom Zone.'] },
    { id: 'flurry-of-fists', name: 'flurry of fists', source: 'Field Ammo', use: 'barehand attack', xp: 2, supply: 1, replacesTag: '', lines: ['On roll, Repeat, but +2 to Supply.'] },
    { id: 'power-cell', name: 'power cell', source: 'Field Ammo', use: 'hard armor', xp: 2, supply: 5, replacesTag: '', lines: ['On roll, give Sticky Motorized on Power.'] },
    { id: 'cyber-supercharger', name: 'cyber supercharger', source: 'Field Ammo', use: 'Cyber', xp: 2, supply: 5, replacesTag: '', lines: ['On each 2, give Sticky heal 1 Core point.'], note: 'Its Cyber tag counts toward Core.' },
    // The Apothecary's Shelf (p.74) - potion crafting reagents
    { id: 'angels-lace', name: 'angel’s lace', source: 'Apothecary', use: 'potion crafting', xp: 1, supply: 3, replacesTag: '', lines: ['For each 1, heal Supply EN.', 'For each 2, heal Supply RX.'] },
    { id: 'belladonna', name: 'belladonna', source: 'Apothecary', use: 'potion crafting', xp: 4, supply: 4, replacesTag: '', lines: ['For each 3, deal SLOW.', 'For each 4, deal POISON.'] },
    { id: 'cinnamon', name: 'cinnamon', source: 'Apothecary', use: 'potion crafting', xp: 3, supply: 5, replacesTag: '', lines: ['On any 5, recover 1 tile.', 'On any 2, give Sticky Quick.'] },
    { id: 'demonhead', name: 'demonhead', source: 'Apothecary', use: 'potion crafting', xp: 2, supply: 3, replacesTag: '', lines: ['For each 3, heal Supply HP.', 'On any 3, deal PAIN.'] },
    { id: 'eagle-eye-rose', name: 'eagle-eye rose', source: 'Apothecary', use: 'potion crafting', xp: 2, supply: 2, replacesTag: '', lines: ['On any 3, give Range step.', 'For each 2, give Sharp.'] },
    { id: 'fine-wine', name: 'fine wine', source: 'Apothecary', use: 'potion crafting', xp: 1, supply: 4, replacesTag: '', lines: ['On any 2, give Sticky Tough.', 'On any 2, reduce PAIN.'] },
    { id: 'gorgons-stool', name: 'gorgons stool', source: 'Apothecary', use: 'potion crafting', xp: 3, supply: 5, replacesTag: '', lines: ['On any 3, deal Sticky Blinding.', 'On any 4, deal HOLD.'] },
    { id: 'heartstring', name: 'heartstring', source: 'Apothecary', use: 'potion crafting', xp: 3, supply: 3, replacesTag: '', lines: ['For each 3, heal Supply HP.', 'For each 2, heal a 2XP Crit.'] },
    { id: 'indigo-creeper', name: 'indigo creeper', source: 'Apothecary', use: 'potion crafting', xp: 2, supply: 3, replacesTag: '', lines: ['On any 2, give Hidden.', 'On any 1, heal Supply EN.', 'On any 2, give Agile.'] },
    { id: 'jewelleaf', name: 'jewelleaf', source: 'Apothecary', use: 'potion crafting', xp: 4, supply: 4, replacesTag: '', lines: ['On any 2, deal JOLT.', 'On any 3, deal SLOW.', 'On any 4, deal HOLD.'] },
    { id: 'kingsweed', name: 'kingsweed', source: 'Apothecary', use: 'potion crafting', xp: 7, supply: 3, replacesTag: '', lines: ['On any 2, give Sticky Ironclad.', 'On roll, give Duration step.'] },
    { id: 'lumenberry', name: 'lumenberry', source: 'Apothecary', use: 'potion crafting', xp: 7, supply: 3, replacesTag: '', lines: ['On any 3, give Sticky Reveal.', 'For each 3, give Duration step on Reveal.'] },
    { id: 'malachite', name: 'malachite', source: 'Apothecary', use: 'potion craft or crystal use', xp: 1, supply: 4, replacesTag: '', lines: ['On any 2, give Sticky Boost on Soul.'] },
    { id: 'nightshade', name: 'nightshade', source: 'Apothecary', use: 'potion crafting', xp: 3, supply: 2, replacesTag: '', lines: ['For each 4, deal POISON.', 'On any 4, deal WOUND.'] },
    { id: 'orcovelox', name: 'orcovelox', source: 'Apothecary', use: 'potion crafting', xp: 2, supply: 5, replacesTag: '', lines: ['On any 2, give Sticky Nimble.', 'On roll, give Duration step on Nimble.'] },
    // The Geomancer's Pouch (p.74) - crystal reagents
    { id: 'quartz', name: 'quartz', source: 'Geomancer', use: 'crystal use', xp: 1, supply: 5, replacesTag: '', lines: ['On any 3, heal Supply HP.', 'On any 2, give Sticky Rugged.'] },
    { id: 'calcite', name: 'calcite', source: 'Geomancer', use: 'crystal use', xp: 1, supply: 7, replacesTag: '', lines: ['On any 1, heal Supply EN.', 'On roll, give Sticky Expert.'] },
    { id: 'hematite', name: 'hematite', source: 'Geomancer', use: 'crystal use', xp: 2, supply: 3, replacesTag: '', lines: ['On any 2, heal Supply RX.', 'On any 2, give Sticky Ironclad.'] },
    { id: 'basalt', name: 'basalt', source: 'Geomancer', use: 'crystal use', xp: 1, supply: 6, replacesTag: '', lines: ['On any 2, give Sticky Rugged.', 'On any 4, reduce KO.'] },
    { id: 'sandstone', name: 'sandstone', source: 'Geomancer', use: 'crystal use', xp: 1, supply: 6, replacesTag: '', lines: ['On any 2, give Sticky Keen.', 'On any 4, reduce FEAR.'] }
];

export function getReagentTemplateById(id) {
    return REAGENT_TEMPLATES.find(template => template.id === id) || null;
}

export function getReagentTemplatesBySource() {
    const sources = [];
    REAGENT_TEMPLATES.forEach(template => {
        let group = sources.find(entry => entry.source === template.source);
        if (!group) {
            group = { source: template.source, templates: [] };
            sources.push(group);
        }
        group.templates.push(template);
    });
    return sources;
}

export function formatReagentDescription(template) {
    if (!template) return '';
    const lines = [`For ${template.use}:`, ...template.lines];
    if (template.note) lines.push(template.note);
    return lines.join('\n');
}
