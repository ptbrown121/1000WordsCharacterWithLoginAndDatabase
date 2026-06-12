// @ts-check
// Equipment rules: weapon templates, armor and soak, Hinders, and Shield
// defense sources.
import { activeParsedTags, isGearTagsBroken } from './tags.js';
import { DIE_STEPS } from './shared.js';

// Weapon templates from the equipment lists (pp.30-31): category, range,
// linked skill, and starting Detail tags. Far weapons cost +2 XP for the
// first die (the green crosses on the Far table, p.31).
export const WEAPON_TEMPLATES = [
    { id: 'fist', name: 'Fist / Cestus / Duster', category: 'Melee', range: 'Touch', skill: 'Knuckles', startingTags: ['Fast'] },
    { id: 'knife', name: 'Knife', category: 'Melee', range: 'Touch', skill: 'Knuckles', startingTags: ['Little'] },
    { id: 'small-improvised', name: 'Small Improvised', category: 'Melee', range: 'Touch', skill: 'Craft', startingTags: ['Ambush'] },
    { id: 'sap-short-mace', name: 'Sap / Short Mace', category: 'Melee', range: 'Touch', skill: 'Wiles', startingTags: ['Ambush'] },
    { id: 'kick', name: 'Kick', category: 'Melee', range: 'Touch', skill: 'Athletics', startingTags: ['Throw'] },
    { id: 'short-blade', name: 'Short Blade', category: 'Melee', range: 'Close', skill: 'Duel', startingTags: ['Fast'] },
    { id: 'long-blade', name: 'Long Blade', category: 'Melee', range: 'Close', skill: 'Duel', startingTags: ['Sharp'] },
    { id: 'axe-foil', name: 'Axe / Foil', category: 'Melee', range: 'Close', skill: 'Duel', startingTags: ['Piercing'] },
    { id: 'torch', name: 'Torch', category: 'Melee', range: 'Close', skill: 'Craft', startingTags: ['Blinding'] },
    { id: 'flail', name: 'Flail', category: 'Melee', range: 'Close', skill: 'Athletics', startingTags: ['Keen'] },
    { id: 'whip', name: 'Whip', category: 'Melee', range: 'Reach', skill: 'Wiles', startingTags: ['Fluid', 'Trap'] },
    { id: 'sonic-blade', name: 'Sonic Blade', category: 'Melee', range: 'Reach', skill: 'Wiles', startingTags: ['Risky', 'Sharp'] },
    { id: 'foil-katana', name: 'Foil / Katana', category: 'Melee', range: 'Reach', skill: 'Duel', startingTags: ['Fluid', 'Fast'] },
    { id: 'two-hand-blade', name: 'Two-Hand Blade', category: 'Melee', range: 'Reach', skill: 'Duel', startingTags: ['Bulky', 'Throw'] },
    { id: 'long-mace', name: 'Long Mace', category: 'Melee', range: 'Reach', skill: 'Duel', startingTags: ['Heavy', 'Throw'] },
    { id: 'energy-blade', name: 'Energy / Phased Blade', category: 'Melee', range: 'Reach', skill: 'Craft', startingTags: ['Risky', 'Piercing'] },
    { id: 'large-improvised', name: 'Large Improvised', category: 'Melee', range: 'Reach', skill: 'Athletics', startingTags: ['Bulky', 'Sweep'] },
    { id: 'shuriken-dagger', name: 'Shuriken / Dagger', category: 'Near', range: 'Reach', skill: 'Knuckles', startingTags: ['Single', 'Little'] },
    { id: 'small-arms', name: 'Small Arms', category: 'Near', range: 'Reach', skill: 'Firearms', startingTags: ['Reload', 'Fast'] },
    { id: 'shotgun', name: 'Shotgun', category: 'Near', range: 'Reach', skill: 'Duel', startingTags: ['Reload', 'Sweep'] },
    { id: 'blowgun', name: 'Blowgun', category: 'Near', range: 'Reach', skill: 'Wiles', startingTags: ['Reload', 'Little'] },
    { id: 'taser-energy-pistol', name: 'Taser / Energy Pistol', category: 'Near', range: 'Reach', skill: 'Craft', startingTags: [] },
    { id: 'javelin', name: 'Javelin', category: 'Far', range: 'Short', skill: 'Athletics', startingTags: ['Single'], extraXp: 2 },
    { id: 'long-arms', name: 'Long Arms', category: 'Far', range: 'Short', skill: 'Firearms', startingTags: ['Inside'], extraXp: 2 },
    { id: 'short-bow', name: 'Short Bow', category: 'Far', range: 'Short', skill: 'Firearms', startingTags: ['Reload'], extraXp: 2 },
    { id: 'low-bow', name: 'Low Bow', category: 'Far', range: 'Short', skill: 'Firearms', startingTags: ['Inside'], extraXp: 2 },
    { id: 'crossbow', name: 'Crossbow', category: 'Far', range: 'Short', skill: 'Tinker', startingTags: ['Bulky'], extraXp: 2 },
    { id: 'sport-bow', name: 'Sport bow', category: 'Far', range: 'Short', skill: 'Tinker', startingTags: ['Fluid'], extraXp: 2 },
    { id: 'machine-gun', name: 'Machine Gun', category: 'Far', range: 'Short', skill: 'Firearms', startingTags: ['Reload', 'Recoil', 'Sweep'], extraXp: 2 },
    { id: 'beam-rifle', name: 'Beam Rifle', category: 'Far', range: 'Short', skill: 'Craft', startingTags: ['Inside', 'Fluid', 'Sweep'], extraXp: 2 },
    { id: 'chemical', name: 'Chemical', category: 'Burst', range: 'Medium', skill: 'Wiles', startingTags: ['Single', 'Inside', 'Bang'] },
    { id: 'grenade', name: 'Grenade', category: 'Burst', range: 'Medium', skill: 'Guile', startingTags: ['Single', 'Risky', 'Bang'] },
    { id: 'flamethrower', name: 'Flamethrower', category: 'Burst', range: 'Medium', skill: 'Tinker', startingTags: ['Bulky', 'Inside', 'Bang'] }
];

export const WEAPON_CATEGORY_ORDER = ['Melee', 'Near', 'Far', 'Burst'];

export function getWeaponTemplateById(id) {
    return WEAPON_TEMPLATES.find(template => template.id === id) || null;
}

export function getWeaponTemplateTags(templateId) {
    return getWeaponTemplateById(templateId)?.startingTags || [];
}

export function getWeaponTemplatesByCategory() {
    return WEAPON_CATEGORY_ORDER.map(category => ({
        category,
        templates: WEAPON_TEMPLATES.filter(template => template.category === category)
    }));
}

export function formatWeaponTemplateDetails(template) {
    if (!template) return '';
    const tags = template.startingTags?.length ? template.startingTags.join(', ') : 'none';
    const extra = template.extraXp ? ` · +${template.extraXp} XP` : '';
    return `${template.category} · ${template.range} · ${template.skill} · Tags: ${tags}${extra}`;
}

// Armor (p.29): base XP = material + coverage, base Soak is Open +0 /
// Full +1 / Closed +3. Hard armor discounts Shield and Detail tags by 1 XP
// (and Flaw tags on Hard armor rebate 1 more, p.79).
export const ARMOR_MATERIALS = new Set(['Soft', 'Hard']);
export const ARMOR_COVERAGE_SOAK = { Open: 0, Full: 1, Closed: 3 };
export const ARMOR_MATERIAL_XP = { Soft: 0, Hard: 4 };
export const ARMOR_COVERAGE_XP = { Open: 0, Full: 2, Closed: 4 };
export const ARMOR_DETAIL_TAGS = new Set([
    'quick', 'tough', 'vital', 'motorized',
    'agile', 'hidden', 'ironclad', 'loose', 'rugged', 'sealed',
    'adamant'
]);

// Worn armor soak (p.29): base Soak by coverage plus Ironclad's +▟.
export function calculateArmorSoakDetails(tiles = []) {
    const sources = [];
    let total = 0;

    (tiles || []).forEach(tile => {
        const armorType = tile?.armorType;
        if (!armorType || tile.isBuried || tile.isBurnt || isGearTagsBroken(tile)) return;
        if (!ARMOR_MATERIALS.has(armorType.material) || !(armorType.coverage in ARMOR_COVERAGE_SOAK)) return;

        const baseSoak = ARMOR_COVERAGE_SOAK[armorType.coverage];
        const ironcladCount = activeParsedTags(tile)
            .filter(parsed => parsed.base === 'ironclad')
            .length;
        const tileSteps = (tile.dice || []).reduce((sum, die) => sum + (DIE_STEPS[die] || 0), 0);
        const ironcladSoak = ironcladCount * tileSteps;
        const sourceTotal = baseSoak + ironcladSoak;

        total += sourceTotal;
        sources.push({
            tileId: tile.id,
            tileName: tile.name || 'Armor',
            material: armorType.material,
            coverage: armorType.coverage,
            baseSoak,
            ironcladCount,
            ironcladSoak,
            total: sourceTotal
        });
    });

    return { total, sources };
}

export function calculateArmorSoak(tiles = []) {
    return calculateArmorSoakDetails(tiles).total;
}

// Repartee (p.41): Hinders are verbal-attack Gear tiles (nonlethal,
// exhausting opponents, -3 XP rebate). Each assault type maps a skill to the
// pool it injures and its typical Range / Crit. Defending uses the same
// skills, but not the attacker's skill.
export const HINDER_TYPES = [
    { id: 'guile', skill: 'Guile', assault: 'Deception or distraction', injures: 'Reflex', range: 'Earshot', crit: 'HOLD', defense: 'I see what you’re trying to do.' },
    { id: 'menace', skill: 'Menace', assault: 'Intimidation or frightening', injures: 'Reflex', range: 'Visual', crit: 'FEAR', defense: 'Your childish tricks will not work on me.' },
    { id: 'presence', skill: 'Presence', assault: 'Taunting or provocation', injures: 'Energy', range: 'Earshot', crit: 'GOAD', defense: 'I’ve heard this before from worse than you.' },
    { id: 'reason', skill: 'Reason', assault: 'Searching or observation', injures: 'Hidden things', range: 'any', crit: 'REVEAL', defense: 'What is it you gain from this challenge?' },
    { id: 'wiles', skill: 'Wiles', assault: 'Persuasion or enticement', injures: 'Energy', range: 'Visual', crit: 'VOW', defense: 'I’ve got the perfect comeback.' }
];

export function isHinderTile(tile) {
    return tile?.type === 'Gear' && tile?.gearSubtype === 'Hinder';
}

/**
 * Crit names a tile's Shield tags can block. Tags are written either one per
 * tag ("Shield: JOLT") or several after one prefix ("Shield: BREAK KO BLEED",
 * jousting plate mail p.40); both forms are split into individual names.
 * Lowercased; not filtered to the known crit list so GM-approved custom
 * crits can be shielded too.
 */
export function getTileShieldCrits(tile) {
    return activeParsedTags(tile)
        .filter(parsed => parsed.prefix === 'shield')
        .flatMap(parsed => parsed.args.crits || []);
}

/**
 * Gear tiles whose Shield tags can protect the defender (p.39). Buried,
 * burned, and BREAK-marked gear is skipped. `kind` distinguishes armor
 * (applies when the tile is called/worn) from weapons (parry - the weapon
 * must be ready and useable as a defense, GM adjudicated).
 */
export function getDefenseShieldSources(tiles = []) {
    const sources = [];

    (tiles || []).forEach(tile => {
        if (!tile || tile.isBuried || tile.isBurnt || isGearTagsBroken(tile)) return;
        const crits = getTileShieldCrits(tile);
        if (crits.length === 0) return;

        const kind = tile.armorType
            ? 'armor'
            : (tile.weapon || tile.gearSubtype === 'Weapon') ? 'weapon' : 'gear';
        sources.push({ tileId: tile.id, tileName: tile.name || 'Gear', kind, crits });
    });

    return sources;
}
