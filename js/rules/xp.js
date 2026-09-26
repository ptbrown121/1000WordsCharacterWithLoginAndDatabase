// @ts-check
// XP catalogs and tag pricing data: Build/Detail/Crit/Shield/Flaw costs,
// Range/Duration/Crowd tables, arcane sacrifices, Hitch values.
import { parseTag, DEFAULT_HITCH_VALUE } from '../tag-model.js';
import { parsedTileTags, tileHasParsedBase } from './tags.js';

// Flaw tags from the Flaw glossary (p.79): F-type flaws rebate 2 XP and
// X-type (exotic) flaws rebate 4. The Arcane Sacrifice tags (p.48) rebate
// Sap -2 / Tire -3 / Drain -4 and cost that resource when the spell casts.
export const F_FLAW_TAGS = new Set([
    'bulky', 'fluid', 'heavy', 'inside', 'old', 'primitive', 'rare',
    'recoil', 'reload', 'risky', 'single', 'worn'
]);
const X_FLAW_TAGS = new Set([
    'adware', 'bound', 'feedback', 'glitch', 'hacked', 'hungry', 'malware',
    'numb', 'overload', 'rube', 'solo', 'stigma', 'torn', 'undroid', 'while'
]);
const ARCANE_FLAW_TAGS = new Set(['drain', 'sap', 'tire', 'witch']);
export const ARCANE_DETAIL_TAGS = new Set(['escape!', 'rite', 'sustain']);
export const ARCANE_SACRIFICE_COSTS = {
    sap: { resource: 'en', reason: 'Sap' },
    tire: { resource: 'rx', reason: 'Tire' },
    drain: { resource: 'hp', reason: 'Drain' }
};
const ARCANE_SACRIFICE_ALIASES = {
    saps: 'sap',
    drains: 'drain'
};
export const FLAW_TAGS = new Set([...F_FLAW_TAGS, ...X_FLAW_TAGS, ...ARCANE_FLAW_TAGS, 'hitch']);
// Cyber Core spend tags (glossary type X) and the Titan family are Exotic:
// "Exotic tags do not count against tag limits for tiles." (pp.61-64)
const CYBER_CORE_TAGS = new Set([
    'antivenin', 'boost', 'breathless', 'charged', 'enhanced', 'fireproof',
    'machine', 'plated', 'reticle', 'sleepless', 'spacewalk', 'tether',
    'unborn', 'wired', 'zenith'
]);
// Titan ability tags (p.69). GM confirmed 2026-06-12: all 2 XP. Overpower
// is the renamed Titan Boost (Boost stays Cyber-only).
const TITAN_TAGS = new Set([
    'titan', 'action hero', 'coup de grace', 'ground zero', 'interception',
    'kill shot', 'overpower', 'pull punch', 'shake off', 'sterner stuff',
    'turn them', 'under cover', 'zero in'
]);
export const EXOTIC_TAGS = new Set(['bestial', 'celestial', 'cyber', ...CYBER_CORE_TAGS, ...TITAN_TAGS]);

// Tag XP costs from the Build and Detail tags glossary (p.78); exotic
// subsystem tags follow their chapters (Stranger pp.61-63, Cyber p.64,
// Machines p.68, Titan p.69).
export const TAG_XP_CATALOG = new Map(Object.entries({
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
    sticky: 4, // GM ruling 2026-06-12: Ammo tiles only (rules-review flags it elsewhere)
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
    overpower: 2,
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

// Crit/Shield tag XP from the Crit/Shield tags glossary (p.79). Crit
// behavior is in Doing Harm: common crits p.38, Shield tags p.39,
// uncommon crits p.40.
export const CRIT_SHIELD_XP = new Map(Object.entries({
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

// Flaw rebates from the Flaw glossary (p.79); Witch -6 is on the spell
// Sacrifice table (p.48).
export const FLAW_XP = new Map(/** @type {Array<[string, number]>} */ ([
    ...Array.from(F_FLAW_TAGS, tag => [tag, -2]),
    ...Array.from(X_FLAW_TAGS, tag => [tag, -4]),
    ['drain', -4],
    ['sap', -2],
    ['tire', -3],
    ['witch', -6]
]));

// Range / Move / Zone / Dome / Time costs from the Space and Time table
// (pp.51/79). Rite and Sustain are spell Duration discounts (p.48).
export const RANGE_DURATION_XP = new Map(Object.entries({
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

/** @param {number} count */
export function getCrowdXp(count) {
    const step = CROWD_XP_STEPS.find(([max]) => count <= max);
    return step ? step[1] : 8;
}

// "Throw" is both a Move range (1 XP, p.52) and a 2 XP Detail tag (p.30;
// glossary "Throw D2 foe moved 1M / HP dealt"). Only a Range:-prefixed
// Throw is the range; bare, Detail:, and Crit: Throw price as tags.
export function isThrowDetailTag(parsed) {
    return parsed.base === 'throw' && parsed.prefix !== 'range';
}

export function isCrowdTag(parsed) {
    return parsed.base === 'crowd' && parsed.args.count != null;
}

export function getArcaneSacrificeKey(tag) {
    const baseTag = parseTag(tag).base;
    return ARCANE_SACRIFICE_ALIASES[baseTag] || baseTag;
}

export function getDuplicateKey(tag) {
    const parsed = parseTag(tag);
    const baseTag = parsed.base;
    if (baseTag === 'world') return '';
    // The same crit name as Crit and as Shield is two different functions on
    // one tile (boxing cesti, p.39), not a duplicate. Bare crit names (the
    // tag picker's convention) are Crit-side.
    if (CRIT_SHIELD_XP.has(baseTag)) {
        return parsed.prefix === 'shield' ? `shield:${baseTag}` : `crit:${baseTag}`;
    }
    return baseTag;
}

// The Hitch flaw (p.20; glossary p.79 "F 1-6"): calling a Hitched tile
// costs 1 EN, the GM can force the call, Hitched tiles cannot be burned,
// and buying it off takes the XP plus a Story Point.
export function getHitchValue(tile) {
    const hitchTag = parsedTileTags(tile).find(parsed => parsed.base === 'hitch');
    if (!hitchTag) return 0;
    return hitchTag.args.value ?? DEFAULT_HITCH_VALUE;
}

export function isHitchedTile(tile) {
    return tileHasParsedBase(tile, 'hitch');
}

export function calculateHitchRebateTotal(tiles = []) {
    return tiles.reduce((sum, tile) => sum + getHitchValue(tile), 0);
}
