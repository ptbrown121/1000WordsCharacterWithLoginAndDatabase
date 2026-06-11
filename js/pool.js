import { STAT_COLORS, VALID_DICE } from './data.js';

export const ADVANCEABLE_STATS = ['BODY', 'POWER', 'SOUL', 'FOCUS', 'MIND', 'SPEED'];
export const NORMAL_COLORS = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple'];
export const SHADOW_KINDS = ['Qi', 'Id'];
export const NORMAL_RESOURCE_KEYS = ['hp', 'en', 'rx'];
export const RESOURCE_LABELS = {
    hp: 'Health',
    en: 'Energy',
    rx: 'Reflex',
    sh: 'Shadow'
};

// ---------------------------------------------------------------------------
// Shared helpers (used by app.js and spellBuilder.js).
// Kept here so the rules engine, UI, and spell wizard agree on a single
// definition. See review item #2.
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe insertion into HTML text or attribute contexts.
 * Handles both: encodes &, <, >, " and '. User-controlled fields (tile.name,
 * tile.tags, tile.description, journal entries, imported JSON, etc.) MUST be
 * passed through this before being interpolated into innerHTML.
 */
export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Parse a comma-separated dice string ("d6, d8") into a list of valid dice
 * tokens and a list of invalid tokens. Empty input returns empty lists.
 */
export function parseDiceInput(str) {
    if (!str || !str.trim()) return { dice: [], invalid: [] };

    const tokens = str
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

    return {
        dice: tokens.filter(die => VALID_DICE.has(die)),
        invalid: tokens.filter(die => !VALID_DICE.has(die))
    };
}

export function parseDiceString(str) {
    return parseDiceInput(str).dice;
}

/**
 * Normalize a tile's `tags` field into a clean string[] regardless of how it
 * is stored. The current storage format is an array of strings, but legacy
 * saves and the existing pool.test.js fixtures store it as a comma-separated
 * string, so this helper accepts both. Returns a fresh array (callers may
 * mutate / map without surprising side effects on the tile).
 *
 * Object-shaped tags (e.g. SpellBuilder's `{name, xp}` items) are flattened
 * to their `name` so downstream rule logic can treat them uniformly.
 */
export function tileTagList(tile) {
    if (!tile) return [];
    const raw = tile.tags;
    if (raw == null || raw === '') return [];

    const items = Array.isArray(raw) ? raw : String(raw).split(',');
    return items
        .map(item => {
            if (item && typeof item === 'object') return String(item.name || '').trim();
            return String(item || '').trim();
        })
        .filter(Boolean);
}

export function isGearTagsBroken(tile) {
    return Boolean(tile?.type === 'Gear' && tile?.gearBroken);
}

export function activeTileTagList(tile) {
    return isGearTagsBroken(tile) ? [] : tileTagList(tile);
}

export function getDiceValidationMessage(label = 'Dice') {
    return `${label} must use only: d3, d4, d6, d8, d10, d12, d14, or d16.`;
}

export function summarizeTagLimitExemptions(tagLimit) {
    const exemptNames = tagLimit.exemptTags.map(tag => tag.name).filter(Boolean);
    if (exemptNames.length === 0) return '';

    const visibleNames = exemptNames.slice(0, 3).join(', ');
    const remaining = exemptNames.length > 3 ? ` +${exemptNames.length - 3} more` : '';
    return ` Exempt: ${visibleNames}${remaining}.`;
}

export function formatTagLimitStatus(tagLimit) {
    const exemptText = summarizeTagLimitExemptions(tagLimit);
    if (tagLimit.valid) {
        return `Tag limit: ${tagLimit.count}/${tagLimit.limit} countable tags.${exemptText}`;
    }

    return `Too many countable tags: ${tagLimit.count}/${tagLimit.limit}. Remove ${tagLimit.overage} or increase dice.${exemptText}`;
}

export function tagLimitErrorMessage(subject, tagLimit) {
    const countableNames = tagLimit.countableTags.map(tag => tag.name).filter(Boolean).join(', ');
    const tagsText = countableNames ? ` Countable tags: ${countableNames}.` : '';
    return `${subject} has ${tagLimit.count} countable tags, but its dice allow ${tagLimit.limit}. Remove ${tagLimit.overage} countable tag${tagLimit.overage === 1 ? '' : 's'} or increase its dice.${tagsText}`;
}

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

export const EXOTIC_SKILL_OPTIONS = {
    none: { label: 'None', baseXp: 0 },
    'arcana-twist': { system: 'Arcana', specialty: 'Twist', label: 'Arcana: Twist', baseXp: 2 },
    'arcana-forge': { system: 'Arcana', specialty: 'Forge', label: 'Arcana: Forge', baseXp: 2 },
    'arcana-augur': { system: 'Arcana', specialty: 'Augur', label: 'Arcana: Augur', baseXp: 2 },
    bestial: { system: 'Stranger', specialty: 'Bestial', label: 'Stranger: Bestial', baseXp: 2 },
    celestial: { system: 'Stranger', specialty: 'Celestial', label: 'Stranger: Celestial', baseXp: 2 },
    cyber: { system: 'Cyber', specialty: 'Cyber', label: 'Cyber', baseXp: 2 }
};

export function normalizeExoticSkill(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const option = EXOTIC_SKILL_OPTIONS[value];
        return option && value !== 'none' ? { id: value, ...option } : null;
    }
    const id = value.id || value.type || '';
    const option = EXOTIC_SKILL_OPTIONS[id];
    if (option && id !== 'none') return { id, ...option };
    return null;
}

export function getExoticSkillBaseXp(value) {
    return normalizeExoticSkill(value)?.baseXp || 0;
}

export function getExoticSkillLabel(value) {
    return normalizeExoticSkill(value)?.label || '';
}

const CONTEXTUAL_TAG_BONUSES = {
    expert: { name: 'Expert', context: 'action check', description: '+▟ to action checks using this tile' },
    keen: { name: 'Keen', context: 'attack', description: '+▟ to attacks using this tile' },
    sharp: { name: 'Sharp', context: 'damage / impact', description: '+▟ to damage or impact' },
    agile: { name: 'Agile', context: 'evasion', description: '+▟ to evasion' },
    hidden: { name: 'Hidden', context: 'vs detection', description: '+▟ against detection' },
    ironclad: { name: 'Ironclad', context: 'soak', description: '+▟ to soak' },
    rugged: { name: 'Rugged', context: 'grit', description: '+▟ to grit' }
};

const RESOURCE_COLORS = {
    hp: ['Red', 'Orange'],
    en: ['Green', 'Yellow'],
    rx: ['Blue', 'Purple']
};

const COLOR_RESOURCE = Object.fromEntries(
    Object.entries(RESOURCE_COLORS)
        .flatMap(([resource, colors]) => colors.map(color => [color, resource]))
);

const RESOURCE_TAGS = {
    tough: 'hp',
    vital: 'en',
    quick: 'rx'
};

const F_FLAW_TAGS = new Set([
    'bulky', 'fluid', 'heavy', 'inside', 'old', 'primitive', 'rare',
    'recoil', 'reload', 'risky', 'single', 'worn'
]);
const X_FLAW_TAGS = new Set([
    'adware', 'bound', 'feedback', 'glitch', 'hacked', 'hungry', 'malware',
    'numb', 'overload', 'rube', 'solo', 'stigma', 'torn', 'undroid', 'while x'
]);
const ARCANE_FLAW_TAGS = new Set(['drain', 'sap', 'tire', 'witch']);
const ARCANE_DETAIL_TAGS = new Set(['escape!', 'rite', 'sustain']);
const ARCANE_SACRIFICE_COSTS = {
    sap: { resource: 'en', reason: 'Sap' },
    tire: { resource: 'rx', reason: 'Tire' },
    drain: { resource: 'hp', reason: 'Drain' }
};
const ARCANE_SACRIFICE_ALIASES = {
    saps: 'sap',
    drains: 'drain'
};
const FLAW_TAGS = new Set([...F_FLAW_TAGS, ...X_FLAW_TAGS, ...ARCANE_FLAW_TAGS, 'hitch']);
// Cyber Core spend tags (glossary type X) and the Titan family are Exotic:
// "Exotic tags do not count against tag limits for tiles."
const CYBER_CORE_TAGS = new Set([
    'antivenin', 'boost', 'breathless', 'charged', 'enhanced', 'fireproof',
    'machine', 'plated', 'reticle', 'sleepless', 'spacewalk', 'tether',
    'unborn', 'wired', 'zenith'
]);
// Titan ability tags (p.69). Costs are not in the v5.02 glossary; the app
// assumes 2 XP each (matching the Cyber Core spend tags) until clarified.
const TITAN_TAGS = new Set([
    'titan', 'action hero', 'coup de grace', 'ground zero', 'interception',
    'kill shot', 'pull punch', 'shake off', 'sterner stuff', 'turn them',
    'under cover', 'zero in'
]);
const EXOTIC_TAGS = new Set(['bestial', 'celestial', 'cyber', ...CYBER_CORE_TAGS, ...TITAN_TAGS]);

const TAG_XP_CATALOG = new Map(Object.entries({
    agile: 2,
    ambush: 2,
    antivenin: 2,
    bestial: 2,
    blinding: 2,
    boost: 2,
    breathless: 2,
    celestial: 2,
    chain: 4,
    charged: 2,
    cyber: 2,
    enhanced: 2,
    'escape!': 4,
    expert: 2,
    fast: 2,
    fireproof: 2,
    gizmo: 4,
    hidden: 2,
    implant: 2,
    ironclad: 2,
    keen: 2,
    knack: 2,
    little: 2,
    loose: 2,
    machine: 2,
    motorized: 2,
    night: 2,
    nimble: 2,
    piercing: 2,
    plated: 2,
    quick: 2,
    reticle: 2,
    rite: -2,
    rugged: 2,
    sealed: 2,
    sharp: 2,
    sleepless: 2,
    spacewalk: 2,
    sticky: 4,
    sustain: -3,
    sweep: 2,
    tether: 4,
    throw: 2,
    titan: 3,
    'action hero': 2,
    'coup de grace': 2,
    'ground zero': 2,
    interception: 2,
    'kill shot': 2,
    'pull punch': 2,
    'shake off': 2,
    'sterner stuff': 2,
    'turn them': 2,
    'under cover': 2,
    'zero in': 2,
    tough: 2,
    trap: 2,
    unborn: 4,
    vital: 2,
    wired: 2,
    zenith: 4,
    adamant: 2,
    day: 2,
    dawn: 2,
    dusk: 2,
    terminator: 2
}));

const CRIT_SHIELD_XP = new Map(Object.entries({
    afire: 4,
    bleed: 4,
    break: 2,
    down: 2,
    fear: 3,
    goad: 3,
    hold: 3,
    jolt: 2,
    ko: 4,
    pain: 3,
    poison: 4,
    reveal: 3,
    slow: 3,
    vow: 3,
    wound: 4
}));

const FLAW_XP = new Map([
    ...Array.from(F_FLAW_TAGS, tag => [tag, -2]),
    ...Array.from(X_FLAW_TAGS, tag => [tag, -4]),
    ['drain', -4],
    ['sap', -2],
    ['tire', -3],
    ['witch', -6]
]);

const RANGE_DURATION_XP = new Map(Object.entries({
    touch: -2,
    close: -1,
    reach: 0,
    short: 2,
    medium: 3,
    visual: 4,
    long: 5,
    extreme: 7,
    pace: -1,
    walk: 0,
    throw: 1,
    run: 2,
    dash: 3,
    blam: 0,
    bang: 1,
    boom: 2,
    earshot: 3,
    blast: 4,
    cup: 2,
    chest: 3,
    cart: 4,
    room: 5,
    house: 8,
    instant: -1,
    '1 min': 0,
    '1 minute': 0,
    '5 min': 1,
    '5 mins': 1,
    '5 minutes': 1,
    '15 min': 2,
    '15 mins': 2,
    '15 minutes': 2,
    '1 hour': 3,
    '6 hours': 4,
    '1 day': 5,
    '3 days': 6,
    '10 days': 7,
    '1 month': 8,
    rite: -2,
    sustain: -3
}));

// Crowd range tags (Space and Time table, pp.51/79): Crowd column is +3 on
// the row value. Listed steps are 1, 2, 5, 10, 50, 100, 500, 1000; unlisted
// counts price at the next step up.
const CROWD_XP_STEPS = [[1, 1], [2, 2], [5, 3], [10, 4], [50, 5], [100, 6], [500, 7], [1000, 8]];

function getCrowdXp(baseTag) {
    const match = String(baseTag || '').match(/^crowd\s*(\d+)$/);
    if (!match) return null;
    const count = parseInt(match[1], 10);
    const step = CROWD_XP_STEPS.find(([max]) => count <= max);
    return step ? step[1] : 8;
}

// Armor base XP (page 29): material + coverage. Hard armor discounts Detail tags by 1 XP.
export const ARMOR_MATERIALS = new Set(['Soft', 'Hard']);
export const ARMOR_COVERAGE_SOAK = { Open: 0, Full: 1, Closed: 3 };
const ARMOR_MATERIAL_XP = { Soft: 0, Hard: 4 };
const ARMOR_COVERAGE_XP = { Open: 0, Full: 2, Closed: 4 };
const ARMOR_DETAIL_TAGS = new Set([
    'quick', 'tough', 'vital', 'motorized',
    'agile', 'hidden', 'ironclad', 'loose', 'rugged', 'sealed',
    'adamant'
]);

const DIE_STEPS = {
    d3: 0,
    d4: 1,
    d6: 2,
    d8: 3,
    d10: 4,
    d12: 5,
    d14: 6,
    d16: 7
};
const DICE_BY_STEP = Object.fromEntries(
    Object.entries(DIE_STEPS).map(([die, step]) => [step, die])
);
const D6_STEP = DIE_STEPS.d6;

function normalizeMechanicalTag(tag) {
    return String(tag || '')
        .replace(/^(build|detail|shield)\s*:\s*/i, '')
        .trim()
        .toLowerCase();
}

export function normalizeShadowKind(kind) {
    const value = String(kind || '').trim().toLowerCase();
    if (value === 'qi' || value === 'white') return 'Qi';
    if (value === 'id' || value === 'black') return 'Id';
    return '';
}

export function normalizeResourceKey(resource) {
    const value = String(resource || '').trim().toLowerCase();
    if (['hp', 'health', 'red', 'orange'].includes(value)) return 'hp';
    if (['en', 'energy', 'green', 'yellow'].includes(value)) return 'en';
    if (['rx', 'reflex', 'blue', 'purple'].includes(value)) return 'rx';
    return '';
}

function normalizeTileBox(box) {
    if (!box || typeof box !== 'object') return null;

    const shadowKind = normalizeShadowKind(box.kind || box.shadowKind || box.type);
    if (shadowKind) {
        return {
            type: 'shadow',
            kind: shadowKind,
            resource: normalizeResourceKey(box.resource || box.normalResource || box.contributesTo)
        };
    }

    const color = String(box.color || box.type || '').trim();
    if (NORMAL_COLORS.includes(color)) return { type: 'color', color };
    return null;
}

export function getTileBoxes(tile) {
    if (!tile) return [];

    if (Array.isArray(tile.boxes) && tile.boxes.length > 0) {
        return tile.boxes.map(normalizeTileBox).filter(Boolean).slice(0, 2);
    }

    return (tile.colors || []).map(color => {
        const shadowKind = normalizeShadowKind(color);
        if (shadowKind) return { type: 'shadow', kind: shadowKind, resource: '' };
        return NORMAL_COLORS.includes(color) ? { type: 'color', color } : null;
    }).filter(Boolean).slice(0, 2);
}

export function serializeTileBoxes(boxes = []) {
    return boxes.map(normalizeTileBox).filter(Boolean).slice(0, 2);
}

export function getTileColorsFromBoxes(boxes = []) {
    return serializeTileBoxes(boxes).map(box => box.type === 'shadow' ? box.kind : box.color);
}

export function getTileNormalCallColors(tile) {
    return [...new Set(getTileBoxes(tile)
        .filter(box => box.type === 'color' && NORMAL_COLORS.includes(box.color))
        .map(box => box.color))];
}

export function getTileShadowBoxes(tile) {
    return getTileBoxes(tile).filter(box => box.type === 'shadow');
}

export function getTileShadowKinds(tile) {
    return [...new Set(getTileShadowBoxes(tile).map(box => box.kind))];
}

export function tileHasShadowKind(tile, kind) {
    return getTileShadowBoxes(tile).some(box => box.kind === kind);
}

export function tileUsesShadow(tile) {
    return getTileShadowBoxes(tile).length > 0;
}

export function tileMatchesCallColor(tile, color) {
    if (!NORMAL_COLORS.includes(color)) return false;
    return getTileBoxes(tile).some(box => {
        if (box.type === 'color') return box.color === color;
        return box.type === 'shadow' && SHADOW_KINDS.includes(box.kind);
    });
}

function getTilesShadowUse(tiles = []) {
    const kinds = new Set();
    tiles.forEach(tile => getTileShadowKinds(tile).forEach(kind => kinds.add(kind)));
    return kinds;
}

export function validateShadowUseForCheck(tiles = []) {
    const kinds = getTilesShadowUse(tiles);
    if (kinds.has('Qi') && kinds.has('Id')) {
        return {
            valid: false,
            kind: 'mixed',
            error: 'A check can include Qi tiles or Id tiles, but not both.'
        };
    }

    return {
        valid: true,
        kind: kinds.has('Qi') ? 'Qi' : kinds.has('Id') ? 'Id' : null,
        error: null
    };
}

export function adjustAberrationForShadowUse(currentAberration, shadowKind) {
    const current = parseInt(currentAberration, 10) || 0;
    if (shadowKind === 'Qi') return current + 1;
    if (shadowKind === 'Id') return current - 1;
    return current;
}

export function getAberrantDieStepNet(effects = {}) {
    return (effects.fallen ? 1 : 0) - (effects.risen ? 1 : 0);
}

export function applyAberrantDieStepEffects(die, effects = {}) {
    const currentStep = DIE_STEPS[die];
    if (currentStep === undefined || currentStep <= D6_STEP) return die;

    const netStep = getAberrantDieStepNet(effects);
    if (netStep === 0) return die;

    const nextStep = Math.max(D6_STEP, Math.min(DIE_STEPS.d16, currentStep + netStep));
    return DICE_BY_STEP[nextStep] || die;
}

export function getShadowTagCounts(tiles = []) {
    const counts = { day: 0, night: 0, dawn: 0, dusk: 0, terminator: 0 };

    tiles.forEach(tile => {
        if (tile?.isBuried) return;
        activeTileTagList(tile).forEach(tag => {
            const baseTag = getMechanicalBaseTag(normalizeTagForXp(tag));
            if (counts[baseTag] !== undefined) counts[baseTag] += 1;
        });
    });

    return counts;
}

export function classifyAberration(aberration = 0, maxShadow = 0, tagCounts = {}) {
    const value = parseInt(aberration, 10) || 0;
    const max = Math.max(0, parseInt(maxShadow, 10) || 0);
    const dusk = Math.max(0, parseInt(tagCounts.dusk, 10) || 0);
    const dawn = Math.max(0, parseInt(tagCounts.dawn, 10) || 0);
    const terminator = Math.max(0, parseInt(tagCounts.terminator, 10) || 0);
    const states = new Set();

    if (Math.abs(value) <= terminator) states.add('Neutral');
    if (value >= 1 - dusk) states.add('Rising');
    if (value <= -1 + dawn) states.add('Falling');
    if (value > max) states.add('Risen Aberrant');
    if (value < -max) states.add('Fallen Aberrant');

    if (value === 0) states.add('Neutral');

    return Array.from(states);
}

export function formatAberration(aberration = 0, maxShadow = 0, tagCounts = {}) {
    const value = parseInt(aberration, 10) || 0;
    const states = classifyAberration(value, maxShadow, tagCounts);
    const rank = Math.abs(value);
    const base = value > 0 ? `Rising ${rank}` : value < 0 ? `Falling ${rank}` : 'Neutral 0';
    const combined = states.length ? states.join(' / ') : 'Unaligned';
    return `${base} (${combined})`;
}

export const SHADOW_ABILITIES = [
    { id: 'qi-test', side: 'Qi', tier: 'Neutral/Rising', label: 'Spend 1 Shadow to add max Shadow to a test.' },
    { id: 'qi-color', side: 'Qi', tier: 'Neutral/Rising', label: 'Spend 1 Shadow to add a color to a tile for one check.' },
    { id: 'qi-heal', side: 'Qi', tier: 'Rising', label: 'Spend 1 Shadow to touch-heal any target, restoring max Shadow to 1 resource.' },
    { id: 'qi-soak', side: 'Qi', tier: 'Rising', label: 'Spend 1 Shadow to give any target their Aberration rank as Soak for one round.' },
    { id: 'qi-add-reach', side: 'Qi', tier: 'Rising', label: 'Spend 1 Shadow to give an Add to all targets within Reach range.' },
    { id: 'qi-risen-blast', side: 'Qi', tier: 'Risen Aberrant', label: 'Risen Blast Zone: on your test, all targets heal 1 standard resource each; dice above d6 are suppressed 1 step.' },
    { id: 'id-impact', side: 'Id', tier: 'Neutral/Falling', label: 'Spend 1 Shadow to add max Shadow to impact.' },
    { id: 'id-press', side: 'Id', tier: 'Neutral/Falling', label: 'Spend 1 Shadow to pay for a Press.' },
    { id: 'id-drain', side: 'Id', tier: 'Falling', label: 'Spend 1 Shadow to touch-drain any target, leaching Aberration rank from Health.' },
    { id: 'id-reroll', side: 'Id', tier: 'Falling', label: 'Spend 1 Shadow to let any target reroll all dice on a check.' },
    { id: 'id-haywire', side: 'Id', tier: 'Falling', label: 'Spend 1 Shadow to force all targets within Reach range to Haywire.' },
    { id: 'id-fallen-blast', side: 'Id', tier: 'Fallen Aberrant', label: 'Fallen Blast Zone: on your test, all targets lose 1 standard resource each; dice above d6 are boosted 1 step.' }
];

export function getAvailableShadowAbilities(aberration = 0, maxShadow = 0, tagCounts = {}) {
    const states = classifyAberration(aberration, maxShadow, tagCounts);
    const has = (state) => states.includes(state);

    return SHADOW_ABILITIES.filter(ability => {
        if (ability.side === 'Qi' && ability.tier === 'Neutral/Rising') return has('Neutral') || has('Rising');
        if (ability.side === 'Qi' && ability.tier === 'Rising') return has('Rising');
        if (ability.side === 'Qi' && ability.tier === 'Risen Aberrant') return has('Risen Aberrant');
        if (ability.side === 'Id' && ability.tier === 'Neutral/Falling') return has('Neutral') || has('Falling');
        if (ability.side === 'Id' && ability.tier === 'Falling') return has('Falling');
        if (ability.side === 'Id' && ability.tier === 'Fallen Aberrant') return has('Fallen Aberrant');
        return false;
    });
}

export function getAberrationRank(aberration = 0) {
    return Math.abs(parseInt(aberration, 10) || 0);
}

export function validateShadowTags(tile) {
    const issues = [];
    const hasQi = tileHasShadowKind(tile, 'Qi');
    const hasId = tileHasShadowKind(tile, 'Id');
    const hasAnyShadow = hasQi || hasId;

    tileTagList(tile).forEach(tag => {
        const baseTag = getMechanicalBaseTag(normalizeTagForXp(tag));
        if (baseTag === 'day' && !hasQi) {
            issues.push({ tag, message: 'Day requires a Qi box.' });
        } else if (baseTag === 'night' && !hasId) {
            issues.push({ tag, message: 'Night requires an Id box.' });
        } else if (['dusk', 'dawn', 'terminator'].includes(baseTag) && !hasAnyShadow) {
            issues.push({ tag, message: `${baseTag[0].toUpperCase()}${baseTag.slice(1)} requires a Qi or Id box.` });
        } else if (['light', 'gloam'].includes(baseTag)) {
            issues.push({ tag, message: `${tag} is from the old Shadow rules and is no longer offered for new builds.` });
        }
    });

    getTileShadowBoxes(tile).forEach((box, index) => {
        if (!box.resource) {
            issues.push({
                tag: box.kind,
                message: `${box.kind} box ${index + 1} must choose Health, Energy, or Reflex.`
            });
        }
    });

    return issues;
}

function getTagName(tag) {
    if (tag && typeof tag === 'object') return tag.name || '';
    return String(tag || '');
}

function stripExemptSuffix(tag) {
    return String(tag || '')
        .replace(/\s*\(exempt\)\s*$/i, '')
        .trim();
}

function normalizeTagForLimit(tag) {
    return String(tag || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function normalizeTagForXp(tag) {
    return normalizeTagForLimit(stripExemptSuffix(tag));
}

function stripMechanicalPrefix(normalizedTag) {
    return normalizeTagForLimit(normalizedTag.replace(/^(build|detail|crit|shield|flaw|range|duration)\s*:\s*/i, ''));
}

function getMechanicalBaseTag(normalizedTag) {
    const withoutPrefix = stripMechanicalPrefix(normalizedTag);
    if (withoutPrefix.startsWith('chain ')) return 'chain';
    if (withoutPrefix.startsWith('world ')) return 'world';
    if (withoutPrefix.startsWith('hitch')) return 'hitch';
    if (withoutPrefix.startsWith('motorized')) return 'motorized';
    if (withoutPrefix.startsWith('while ')) return 'while x';
    return withoutPrefix;
}

function getArcaneSacrificeKey(tag) {
    const baseTag = getMechanicalBaseTag(normalizeTagForXp(tag));
    return ARCANE_SACRIFICE_ALIASES[baseTag] || baseTag;
}

function getDuplicateKey(tag) {
    const normalized = normalizeTagForXp(getTagName(tag));
    const baseTag = getMechanicalBaseTag(normalized);
    if (baseTag === 'world') return '';
    // The same crit name as Crit and as Shield is two different functions on
    // one tile (boxing cesti, p.39), not a duplicate. Bare crit names (the
    // tag picker's convention) are Crit-side.
    if (CRIT_SHIELD_XP.has(baseTag)) {
        return /^shield\s*:/i.test(normalized) ? `shield:${baseTag}` : `crit:${baseTag}`;
    }
    return baseTag || normalized;
}

export function getHitchValue(tile) {
    const hitchTag = tileTagList(tile).find(tag => getMechanicalBaseTag(normalizeTagForXp(tag)) === 'hitch');
    if (!hitchTag) return 0;
    const match = String(hitchTag).match(/hitch\s*(\d+)/i);
    return match ? Math.min(6, Math.max(1, parseInt(match[1], 10) || 1)) : 3;
}

export function isHitchedTile(tile) {
    if (isGearTagsBroken(tile)) return false;
    return activeTileTagList(tile).some(tag => getMechanicalBaseTag(normalizeTagForXp(tag)) === 'hitch');
}

export function calculateHitchRebateTotal(tiles = []) {
    return tiles.reduce((sum, tile) => sum + getHitchValue(tile), 0);
}

export function calculateArmorSoakDetails(tiles = []) {
    const sources = [];
    let total = 0;

    (tiles || []).forEach(tile => {
        const armorType = tile?.armorType;
        if (!armorType || tile.isBuried || tile.isBurnt || isGearTagsBroken(tile)) return;
        if (!ARMOR_MATERIALS.has(armorType.material) || !(armorType.coverage in ARMOR_COVERAGE_SOAK)) return;

        const baseSoak = ARMOR_COVERAGE_SOAK[armorType.coverage];
        const ironcladCount = activeTileTagList(tile)
            .filter(tag => getMechanicalBaseTag(normalizeTagForXp(tag)) === 'ironclad')
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

/**
 * Crit names a tile's Shield tags can block. Tags are written either one per
 * tag ("Shield: JOLT") or several after one prefix ("Shield: BREAK KO BLEED",
 * jousting plate mail p.40); both forms are split into individual names.
 * Lowercased; not filtered to the known crit list so GM-approved custom
 * crits can be shielded too.
 */
export function getTileShieldCrits(tile) {
    return activeTileTagList(tile)
        .map(stripExemptSuffix)
        .filter(tag => /^shield\s*:/i.test(tag))
        .flatMap(tag => tag.replace(/^shield\s*:\s*/i, '').toLowerCase().split(/[\s,]+/))
        .filter(Boolean);
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

function getArcaneSacrificeCostTags(tile) {
    if (isGearTagsBroken(tile)) return [];
    const tags = activeTileTagList(tile);
    Object.entries(tile?.spellState || {}).forEach(([key, value]) => {
        if (!key.startsWith('spell-mod-val-')) return;
        if ((parseInt(value, 10) || 0) <= 0) return;
        tags.push(key.replace('spell-mod-val-', ''));
    });
    return tags;
}

export class PoolEngine {
    constructor() {
        this.baseKeeps = 2;
    }

    calculateSteps(diceArray) {
        return diceArray.reduce((steps, die) => steps + (DIE_STEPS[die] || 0), 0);
    }

    classifyTagForLimit(tag) {
        const name = getTagName(tag);
        const normalized = normalizeTagForLimit(name);
        const withoutPrefix = stripMechanicalPrefix(normalized);
        const baseTag = getMechanicalBaseTag(normalized);
        const hasBuildPrefix = /^build\s*:/i.test(normalized);

        if (!normalized) {
            return { name, counts: false, reason: 'blank' };
        }

        if (hasBuildPrefix) {
            return { name, counts: true, reason: 'Build tags count' };
        }

        if (ARCANE_DETAIL_TAGS.has(baseTag)) {
            return { name, counts: true, reason: 'Arcane Detail tags count' };
        }

        if (baseTag === 'world') {
            return { name, counts: false, reason: 'World tags do not count' };
        }

        if (/^(range|duration)\s*:/i.test(normalized) || RANGE_DURATION_XP.has(baseTag) || getCrowdXp(baseTag) !== null) {
            return { name, counts: false, reason: 'Range/Duration tags do not count' };
        }

        if (withoutPrefix.includes('flaw') || FLAW_TAGS.has(baseTag)) {
            return { name, counts: false, reason: 'Flaw tags do not count' };
        }

        if (withoutPrefix.includes('(exempt)') || withoutPrefix.includes('exempt')) {
            return { name, counts: false, reason: 'GM Exception' };
        }

        if (withoutPrefix.includes('exotic') || EXOTIC_TAGS.has(baseTag)) {
            return { name, counts: false, reason: 'Exotic tags do not count' };
        }

        return { name, counts: true, reason: 'Counts against tag limit' };
    }

    calculateTagLimit(diceArray, tagsArray = []) {
        const limit = this.calculateSteps(diceArray);
        const details = tagsArray.map(tag => this.classifyTagForLimit(tag));
        const countableTags = details.filter(tag => tag.counts);
        const exemptTags = details.filter(tag => !tag.counts && tag.reason !== 'blank');
        const count = countableTags.length;

        return {
            limit,
            count,
            overage: Math.max(0, count - limit),
            valid: count <= limit,
            countableTags,
            exemptTags,
            details
        };
    }

    parseDiceString(str) {
        if (!str) return [];
        return str
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(die => VALID_DICE.has(die));
    }

    /**
     * XP cascade (rulebook "System Concept-Dice" chart). Each character starts
     * with a free d3 in every stat. Past d3, each advance costs:
     *
     *     XP = {steps on the advanced die} + {count of other dice already on
     *          this stat or tile}
     *
     * Worked example (2x d6):
     *   - Add 1st d4:           1 + 0 = 1
     *   - Promote d4 -> d6:     2 + 0 = 2   (subtotal 3 for the first d6)
     *   - Add 2nd d4:           1 + 1 = 2
     *   - Promote that d4 -> d6: 2 + 1 = 3   (subtotal 5 for the second d6)
     *   - Total: 8
     *
     * d3s are skipped (free) and do NOT contribute to {count of other dice}.
     * The optimal path always promotes the highest-rank die first; we sort
     * descending so the cheaper dice pay the higher "other dice" surcharge.
     *
     * Used for both stat XP (ui/stats.js updateXpTracker) and tile XP
     * (estimateTileXp). One formula, one source of truth.
     */
    calculateOptimalXpCost(diceArray) {
        const sortedDice = [...diceArray].sort((a,b) => (DIE_STEPS[b] || 0) - (DIE_STEPS[a] || 0));

        let totalXp = 0;
        let existingDiceCount = 0;

        for (const die of sortedDice) {
            const targetSteps = DIE_STEPS[die] || 0;
            if (targetSteps === 0) continue;

            // Add a d4
            totalXp += 1 + existingDiceCount;

            // Upgrade it to its target rank
            for (let s = 2; s <= targetSteps; s++) {
                totalXp += s + existingDiceCount;
            }

            existingDiceCount++;
        }
        return totalXp;
    }

    /**
     * Categorize a tag string for XP scoring. Returns:
     *   - `xp`: the XP modifier this tag contributes (positive or negative)
     *   - `recognized`: true when the tag matched a known category, false when
     *     it fell through to the default. Callers that surface unknown tags
     *     to the user (e.g. modals.js Auto-Estimate button) use this flag to
     *     warn that a typo cost the player the default +2 XP.
     *
     * "Recognized but defaulted" tags - structural prefixes like `Build:`,
     * `Detail:`, `Crit:`, `Shield:`, `Range:`, `Duration:`, plus exotic tags -
     * are valid rulebook categories whose specific XP costs aren't fully
     * tabulated here. They still get the default +2 XP, but they are NOT
     * flagged as unknown so the UI doesn't bother the player about them.
     */
    classifyTagForXp(tag) {
        const t = normalizeTagForXp(tag);
        const baseTag = getMechanicalBaseTag(t);

        if (!t) return { xp: 0, recognized: true, category: 'blank' };
        // World Build tag (p.63): "A tile with the 3 XP World Build tag chains
        // your Homeworld tile."
        if (baseTag === 'world') return { xp: 3, recognized: true, category: 'world' };
        if (baseTag === 'hitch') {
            const match = t.match(/hitch\s*(\d+)/i);
            const value = match ? Math.min(6, Math.max(1, parseInt(match[1], 10) || 1)) : 3;
            return { xp: -value, recognized: true, category: 'flaw', hardArmorFlawEligible: false };
        }
        if (FLAW_XP.has(baseTag)) {
            return {
                xp: FLAW_XP.get(baseTag),
                recognized: true,
                category: 'flaw',
                hardArmorFlawEligible: F_FLAW_TAGS.has(baseTag)
            };
        }
        if (RANGE_DURATION_XP.has(baseTag)) {
            return { xp: RANGE_DURATION_XP.get(baseTag), recognized: true, category: 'rangeDuration' };
        }
        const crowdXp = getCrowdXp(baseTag);
        if (crowdXp !== null) {
            return { xp: crowdXp, recognized: true, category: 'rangeDuration' };
        }
        if (/^(range|duration)\s*:/i.test(t)) {
            return { xp: 2, recognized: true, category: 'rangeDuration' };
        }
        if (/^(crit|shield)\s*:/i.test(t) || CRIT_SHIELD_XP.has(baseTag)) {
            return {
                xp: CRIT_SHIELD_XP.get(baseTag) ?? 2,
                recognized: true,
                category: /^shield\s*:/i.test(t) ? 'shield' : 'crit',
                hardArmorDiscountable: /^shield\s*:/i.test(t)
            };
        }
        if (TAG_XP_CATALOG.has(baseTag)) {
            return {
                xp: TAG_XP_CATALOG.get(baseTag),
                recognized: true,
                category: EXOTIC_TAGS.has(baseTag) ? 'exotic' : 'tag',
                hardArmorDiscountable: ARMOR_DETAIL_TAGS.has(baseTag) || /^detail\s*:/i.test(t)
            };
        }
        if (/^(build|detail)\s*:/i.test(t)) {
            return {
                xp: 2,
                recognized: true,
                category: /^build\s*:/i.test(t) ? 'build' : 'detail',
                hardArmorDiscountable: /^detail\s*:/i.test(t)
            };
        }

        return { xp: 2, recognized: false, category: 'unknown' };
    }

    /**
     * Detailed tile XP estimate. Same total as estimateTileXp(), but also
     * returns the list of unrecognized tags so the UI can warn the player
     * that a typo silently cost them XP. Use this in interactive contexts
     * (e.g. the "Auto-Estimate" button); use estimateTileXp when you only
     * need the number.
     *
     * @returns {{ xp: number, unknownTags: string[] }}
     */
    estimateTileXpDetails(diceArray, tagsArray, armorType = null, options = {}) {
        let xp = this.calculateOptimalXpCost(diceArray);
        const isHardArmor = Boolean(armorType) && armorType.material === 'Hard';
        const unknownTags = [];
        const seenTags = new Map();

        tagsArray.forEach(tag => {
            const t = normalizeTagForXp(tag);
            const tagRule = this.classifyTagForXp(tag);
            let tagXp = tagRule.xp;

            // Bestial / Celestial are 2 XP on Skill tiles but 4 XP when added
            // to a Trait, Story, or Gear tile (glossary "X 2/4", pp.61-63).
            const baseTag = getMechanicalBaseTag(t);
            if (options.tileType && options.tileType !== 'Skill' && (baseTag === 'bestial' || baseTag === 'celestial')) {
                tagXp += 2;
            }

            const duplicateKey = getDuplicateKey(tag);
            const previousCopies = seenTags.get(duplicateKey) || 0;
            seenTags.set(duplicateKey, previousCopies + 1);
            if (duplicateKey) tagXp += previousCopies * 2;

            if (isHardArmor && tagRule.hardArmorFlawEligible) {
                tagXp -= 1;
            }
            if (isHardArmor && tagRule.hardArmorDiscountable && tagXp > 0) {
                tagXp -= 1;
            }

            xp += tagXp;
            if (!tagRule.recognized && t.trim()) unknownTags.push(String(tag));
        });

        // Armor base cost: material + coverage.
        if (armorType) {
            xp += (ARMOR_MATERIAL_XP[armorType.material] || 0) + (ARMOR_COVERAGE_XP[armorType.coverage] || 0);
        }

        const weapon = options.weapon || null;
        const weaponTemplate = weapon?.templateId
            ? getWeaponTemplateById(options.weapon.templateId)
            : null;
        if (weaponTemplate?.extraXp) {
            xp += weaponTemplate.extraXp;
        } else if (normalizeTagForXp(weapon?.category) === 'far') {
            xp += 2;
        }

        xp += getExoticSkillBaseXp(options.exoticSkill);
        xp += serializeTileBoxes(options.boxes || [])
            .filter(box => box.type === 'shadow')
            .length * 2;

        return { xp: Math.max(0, xp), unknownTags };
    }

    estimateTileXp(diceArray, tagsArray, armorType = null, options = {}) {
        return this.estimateTileXpDetails(diceArray, tagsArray, armorType, options).xp;
    }

    calculateResourceMaxes(tiles = []) {
        const maxes = { hp: 0, en: 0, rx: 0, sh: 0 };

        tiles.forEach(tile => {
            if (tile.isBuried) return;
            if (tile.gearSubtype === 'Ammo') return;
            getTileBoxes(tile).forEach(box => {
                if (box.type === 'color') {
                    const resource = COLOR_RESOURCE[box.color];
                    if (resource) maxes[resource] += 1;
                } else if (box.type === 'shadow') {
                    if (NORMAL_RESOURCE_KEYS.includes(box.resource)) maxes[box.resource] += 1;
                    maxes.sh += 1;
                }
            });

            const tileSteps = this.calculateSteps(tile.dice || []);
            const tags = activeTileTagList(tile).map(normalizeMechanicalTag);
            tags.forEach(tag => {
                const resource = RESOURCE_TAGS[tag];
                if (resource) maxes[resource] += tileSteps;
            });
        });

        return maxes;
    }

    calculateShadowMax(statsOrTiles, maybeTiles) {
        const tiles = Array.isArray(statsOrTiles) ? statsOrTiles : (maybeTiles || []);
        return this.calculateResourceMaxes(tiles).sh;
    }

    calculateStatXp(stats = {}) {
        return ADVANCEABLE_STATS.reduce((sum, stat) => {
            return sum + this.calculateOptimalXpCost(this.parseDiceString(stats[stat] || ''));
        }, 0);
    }

    getUnavailableReason(tile) {
        if (tile?.isBuried) return 'buried';
        if (tile?.isBurnt) return 'burnt';
        if (tile?.gearSubtype === 'Ammo') return 'ammo';
        return null;
    }

    /**
     * Compiles the dice pool based on selected colors and tiles.
     * @param {Array<string>} callColors 
     * @param {Object} stats 
     * @param {Object} callTile 
     * @param {Array<Object>} burnTiles 
     * @param {Array<Object>} allTiles 
     * @param {Array<string>} extraDice
     * @param {Object} options
     * @returns {Object} { dice: Array, adds: number, flatBonus: number, tagBonuses: Array, chainOptions: Array, error: string }
     */
    compilePool(callColors, stats, callTile, burnTiles, allTiles, extraDice = [], options = {}) {
        let pool = [];
        let adds = 2; // Base keep is 2;
        let flatBonus = 0;
        let tagBonuses = [];
        let chainOptions = [];
        let resourceCosts = [];
        let calledTileIds = [];
        let error = null;
        const activeCallColors = [...new Set(callColors.filter(Boolean))];
        const disabledChainIds = options.disabledChainIds || new Set();
        const chainColorSelections = options.chainColorSelections || {};
        const aberrantEffects = options.aberrantEffects || {};
        const hitchCallTiles = options.hitchCallTiles || [];
        const usedTiles = [];
        const dieStepEffects = [];
        const buildResult = (overrides = {}) => ({
            dice: pool,
            adds,
            flatBonus,
            tagBonuses,
            chainOptions,
            resourceCosts,
            calledTileIds,
            shadowUse: null,
            dieStepEffects,
            haywireThreshold: 1,
            freebieDie: null,
            error: null,
            ...overrides
        });
        const isChainDisabled = (chainId) => {
            if (disabledChainIds instanceof Set) return disabledChainIds.has(chainId);
            if (Array.isArray(disabledChainIds)) return disabledChainIds.includes(chainId);
            return false;
        };
        const getSelectedChainColor = (chainId) => {
            if (chainColorSelections instanceof Map) return chainColorSelections.get(chainId) || '';
            return chainColorSelections[chainId] || '';
        };

        if (activeCallColors.length === 0) {
            return buildResult({ error: "Select at least 1 color for the Call." });
        }

        const getSharedCallColors = (...tiles) => {
            if (tiles.some(tile => !tile)) return [];

            return activeCallColors.filter(color =>
                tiles.every(tile => tileMatchesCallColor(tile, color))
            );
        };

        // 1. Add Stat Dice matching the Call Colors
        activeCallColors.forEach(color => {
            if (!color) return;
            // Find stats matching this color
            for (const [stat, statColor] of Object.entries(STAT_COLORS)) {
                if (statColor === color) {
                    const diceString = stats[stat];
                    if (diceString) {
                        const parsed = this.parseDiceString(diceString);
                        parsed.forEach(die => {
                            pool.push({ source: `Stat (${stat})`, die });
                        });
                    }
                }
            }
        });

        // Recursive resolution for call tiles and chains
        const resolveTile = (tile, isCallTile, visitedIds, chainColor = '', chainTracker = null) => {
            if (!tile || visitedIds.has(tile.id)) return;
            visitedIds.add(tile.id);

            // Chain length limit (p.25): "The chain cannot call more tiles
            // than the ▟ of the Chained tile." The tracker is rooted at the
            // called tile bearing the Chain tag; every tile pulled in through
            // chain links counts against the root's die steps.
            if (isCallTile) {
                chainTracker = {
                    rootName: tile.name,
                    limit: this.calculateSteps(tile.dice || []),
                    count: 0
                };
            } else if (chainTracker) {
                chainTracker.count += 1;
                if (chainTracker.count > chainTracker.limit) {
                    error = `Chain from '${chainTracker.rootName}' calls ${chainTracker.count} tiles, but its ${chainTracker.limit}▟ allows at most ${chainTracker.limit}.`;
                    return;
                }
            }

            const unavailableReason = this.getUnavailableReason(tile);
            if (unavailableReason) {
                error = `Tile '${tile.name}' is ${unavailableReason} and cannot be called.`;
                return;
            }
            
            // Color check
            const matchesCall = activeCallColors.some(c => tileMatchesCallColor(tile, c));
            if (!matchesCall) {
                if (isCallTile) {
                    error = `Call Tile '${tile.name}' does not match any Call Colors.`;
                } else {
                    error = `Chained Tile '${tile.name}' does not match any Call Colors.`;
                }
                return;
            }

            calledTileIds.push(tile.id);
            usedTiles.push(tile);
            if (isHitchedTile(tile)) {
                resourceCosts.push({
                    resource: 'en',
                    amount: 1,
                    sourceTileId: tile.id,
                    sourceTileName: tile.name,
                    reason: 'Hitch'
                });
            }
            getArcaneSacrificeCostTags(tile).forEach(tag => {
                const sacrificeKey = getArcaneSacrificeKey(tag);
                const sacrificeCost = ARCANE_SACRIFICE_COSTS[sacrificeKey];
                if (!sacrificeCost) return;
                resourceCosts.push({
                    resource: sacrificeCost.resource,
                    amount: 1,
                    sourceTileId: tile.id,
                    sourceTileName: tile.name,
                    reason: sacrificeCost.reason
                });
            });

            // Add tile dice. Chained tiles are labeled separately so the
            // resolution panel can price maxed chain dice (1 resource each).
            tile.dice.forEach(d => pool.push({ source: `${isCallTile ? 'Tile' : 'Chain'} (${tile.name})`, die: d }));

            // Extra add if chained
            if (!isCallTile) adds += 1;

            // Parse tags
            const tags = activeTileTagList(tile).map(t => t.toLowerCase());
            
            // Contextual tag bonuses are surfaced for user selection.
            tags.forEach((tag, index) => {
                const normalizedTag = normalizeMechanicalTag(tag);
                let bonusRule = CONTEXTUAL_TAG_BONUSES[normalizedTag];

                // Motorized: "+steps on [stat]". The chosen stat is stored as "Motorized: STAT".
                if (!bonusRule && normalizedTag.startsWith('motorized')) {
                    const statMatch = String(tag).match(/motorized\s*:?\s*([^()]*)/i);
                    const stat = statMatch && statMatch[1] ? statMatch[1].trim().toUpperCase() : '';
                    bonusRule = {
                        name: stat ? `Motorized (${stat})` : 'Motorized',
                        context: stat ? `${stat} check` : 'stat check',
                        description: `+▟ on ${stat || 'a chosen stat'} checks using this tile`
                    };
                }

                if (!bonusRule) return;

                const steps = this.calculateSteps(tile.dice);
                if (steps <= 0) return;

                tagBonuses.push({
                    id: `${tile.id}:${normalizedTag}:${index}`,
                    tag: bonusRule.name,
                    sourceTileId: tile.id,
                    sourceTileName: tile.name,
                    steps,
                    context: bonusRule.context,
                    description: bonusRule.description
                });
            });

            // Chain tags
            for (let index = 0; index < tags.length; index++) {
                const tag = tags[index];
                const isChainTag = tag.startsWith('chain ');
                const isWorldTag = tag.startsWith('world ');
                if (isChainTag || isWorldTag) {
                    const linkKind = isWorldTag ? 'world' : 'chain';
                    const linkLabel = isWorldTag ? 'World' : 'Chain';
                    const targetName = tag.replace(/^(chain|world)\s+/, '').trim();
                    const chainId = `${tile.id}:${linkKind}:${index}:${targetName.toLowerCase()}`;
                    const targetTile = allTiles.find(t => (t.name || '').toLowerCase() === targetName);
                    const disabled = isChainDisabled(chainId);
                    const sharedColors = targetTile ? getSharedCallColors(tile, targetTile) : [];
                    const selectedColor = getSelectedChainColor(chainId);
                    const chainOption = {
                        id: chainId,
                        type: linkKind,
                        sourceTileId: tile.id,
                        sourceTileName: tile.name,
                        targetTileId: targetTile?.id || null,
                        targetTileName: targetTile?.name || targetName,
                        targetFound: Boolean(targetTile),
                        availableColors: sharedColors,
                        selectedColor: chainColor || selectedColor || (sharedColors.length === 1 ? sharedColors[0] : ''),
                        inheritedColor: chainColor,
                        requiresColorChoice: !chainColor && sharedColors.length > 1,
                        enabled: !disabled,
                        status: disabled ? 'suppressed' : 'active'
                    };
                    chainOptions.push(chainOption);

                    if (disabled) continue;

                    if (!targetTile) {
                        chainOption.status = 'missing';
                        error = `${linkLabel} target '${targetName}' was not found.`;
                        return;
                    }

                    const chainUnavailableReason = this.getUnavailableReason(targetTile);
                    if (chainUnavailableReason) {
                        chainOption.status = 'blocked';
                        error = `${linkLabel} target '${targetTile.name}' is ${chainUnavailableReason} and cannot be called.`;
                        return;
                    }

                    if (sharedColors.length === 0) {
                        chainOption.status = 'blocked';
                        error = `${linkLabel} from '${tile.name}' to '${targetTile.name}' must share one selected Call color.`;
                        return;
                    }

                    if (chainColor && !sharedColors.includes(chainColor)) {
                        chainOption.status = 'blocked';
                        error = `${linkLabel} from '${tile.name}' to '${targetTile.name}' cannot continue on ${chainColor}.`;
                        return;
                    }

                    let nextChainColor = chainColor;
                    if (!nextChainColor) {
                        if (sharedColors.length === 1) {
                            nextChainColor = sharedColors[0];
                            chainOption.selectedColor = nextChainColor;
                        } else if (selectedColor && sharedColors.includes(selectedColor)) {
                            nextChainColor = selectedColor;
                            chainOption.selectedColor = nextChainColor;
                        } else {
                            chainOption.status = 'needs-color';
                            error = `${linkLabel} from '${tile.name}' to '${targetTile.name}' can chain on ${sharedColors.join(' or ')}. Choose one chain color.`;
                            return;
                        }
                    }

                    resolveTile(targetTile, false, visitedIds, nextChainColor, chainTracker);
                    if (error) return;
                }
            }
        };

        // 2. Validate and Add Call Tile (with chains)
        if (callTile) {
            resolveTile(callTile, true, new Set());
            if (error) return buildResult({ error });
        }

        // 3. Validate and Add additional called Hitch tiles. These are called,
        // not burned: they cost Hitch EN and add dice, but grant no +1 Add.
        if (hitchCallTiles && hitchCallTiles.length > 0) {
            if (!callTile) {
                return buildResult({ error: "Select a Call Tile before adding Hitched called tiles." });
            }

            const invalidHitchTile = hitchCallTiles.find(tile => !isHitchedTile(tile));
            if (invalidHitchTile) {
                return buildResult({ error: `Tile '${invalidHitchTile.name}' is not Hitched and must be burned for an extra Add.` });
            }

            for (const hitchTile of hitchCallTiles) {
                resolveTile(hitchTile, true, new Set());
                if (error) return buildResult({ error });
            }
        }

        // 4. Validate and Add Burn Tiles (Burn tiles do NOT trigger tags)
        if (burnTiles && burnTiles.length > 0) {
            if (!callTile) {
                return buildResult({ error: "Select a Call Tile before adding Burn tiles." });
            }

            const unavailableBurnTile = burnTiles.find(tile => this.getUnavailableReason(tile));
            if (unavailableBurnTile) {
                const reason = this.getUnavailableReason(unavailableBurnTile);
                return buildResult({ error: `Burn tile '${unavailableBurnTile.name}' is ${reason} and cannot be used.` });
            }

            const hitchedBurnTile = burnTiles.find(tile => isHitchedTile(tile));
            if (hitchedBurnTile) {
                return buildResult({ error: `Hitched tile '${hitchedBurnTile.name}' cannot be burned.` });
            }

            const sharedBurnColors = getSharedCallColors(callTile, ...burnTiles);

            if (sharedBurnColors.length === 0) {
                return buildResult({ error: "Burn tiles must share one selected Call color with the Call Tile." });
            }

            burnTiles.forEach(bt => {
                bt.dice.forEach(d => pool.push({ source: `Burn (${bt.name})`, die: d }));
                usedTiles.push(bt);
                adds += 1;
            });
        }

        const shadowUse = validateShadowUseForCheck(usedTiles);
        if (!shadowUse.valid) return buildResult({ error: shadowUse.error, shadowUse: shadowUse.kind });

        // 5. Validate and Add Extra Dice
        if (extraDice && extraDice.length > 0) {
            extraDice.forEach(d => pool.push({ source: `Extra`, die: d }));
        }

        // 6. Freebie die (p.25): once per test, spend Energy equal to the
        // die's ▟ to add a die that duplicates one already in the pool.
        const freebieDie = options.freebieDie || null;
        if (freebieDie) {
            if (!VALID_DICE.has(freebieDie)) {
                return buildResult({ error: getDiceValidationMessage('Freebie die') });
            }
            if (!pool.some(entry => entry.die === freebieDie)) {
                return buildResult({ error: `Freebie die must duplicate a die already in the pool; there is no ${freebieDie} to copy.` });
            }
            pool.push({ source: 'Freebie', die: freebieDie });
            const freebieCost = DIE_STEPS[freebieDie] || 0;
            if (freebieCost > 0) {
                resourceCosts.push({
                    resource: 'en',
                    amount: freebieCost,
                    sourceTileId: null,
                    sourceTileName: `Freebie ${freebieDie}`,
                    reason: 'Freebie'
                });
            }
        }

        // Glitch flaw (p.65): haywire counts 1s and 2s when any tile in the
        // pool carries it.
        const haywireThreshold = usedTiles.some(tile =>
            activeTileTagList(tile).some(tag => getMechanicalBaseTag(normalizeTagForXp(tag)) === 'glitch')
        ) ? 2 : 1;

        const netDieStep = getAberrantDieStepNet(aberrantEffects);
        if (netDieStep !== 0) {
            pool = pool.map(dieEntry => {
                const adjustedDie = applyAberrantDieStepEffects(dieEntry.die, aberrantEffects);
                if (adjustedDie !== dieEntry.die) {
                    dieStepEffects.push({
                        source: dieEntry.source,
                        from: dieEntry.die,
                        to: adjustedDie,
                        direction: netDieStep > 0 ? 'boosted' : 'suppressed'
                    });
                }
                return { ...dieEntry, die: adjustedDie };
            });
        }

        return buildResult({ shadowUse: shadowUse.kind, haywireThreshold, freebieDie });
    }

    rollDie(dieString) {
        // dieString e.g., 'd6'
        const max = parseInt(dieString.replace('d', ''), 10);
        if (isNaN(max)) return 0;
        return Math.floor(Math.random() * max) + 1;
    }

    rollPool(diceArray) {
        return diceArray.map(dObj => ({
            source: dObj.source,
            die: dObj.die,
            val: this.rollDie(dObj.die)
        }));
    }

    calculateOptimalTotal(rolledArray, adds, { haywireThreshold = 1 } = {}) {
        // Sort descending by value
        const sorted = [...rolledArray].sort((a, b) => b.val - a.val);
        const kept = sorted.slice(0, adds);
        const total = kept.reduce((sum, item) => sum + item.val, 0);

        // Haywire detection: more than half of the dice roll 1s. The Glitch
        // Cyber flaw raises the threshold so 1s AND 2s count (p.65).
        const onesCount = rolledArray.filter(d => d.val <= haywireThreshold).length;
        const isHaywire = onesCount > (rolledArray.length / 2);

        return { total, kept, all: sorted, isHaywire, haywireThreshold, originalRolls: rolledArray };
    }
}
