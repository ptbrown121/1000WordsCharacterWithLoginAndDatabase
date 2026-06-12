// @ts-check
// Shared rules primitives extracted from pool.js (platform plan PR 9):
// stat/color/resource constants, dice parsing, die steps, HTML escaping.
import { VALID_DICE } from '../data.js';

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

export function getDiceValidationMessage(label = 'Dice') {
    return `${label} must use only: d3, d4, d6, d8, d10, d12, d14, or d16.`;
}

// Resource pools (p.11): Health gains 1 point per red or orange box,
// Energy per green or yellow, Reflex per blue or purple.
const RESOURCE_COLORS = {
    hp: ['Red', 'Orange'],
    en: ['Green', 'Yellow'],
    rx: ['Blue', 'Purple']
};

export const COLOR_RESOURCE = Object.fromEntries(
    Object.entries(RESOURCE_COLORS)
        .flatMap(([resource, colors]) => colors.map(color => [color, resource]))
);

// Tough / Vital / Quick add the tile's ▟ to a resource pool (pp.29/78).
export const RESOURCE_TAGS = {
    tough: 'hp',
    vital: 'en',
    quick: 'rx'
};

// Die steps (p.4): a d4 is 1 ▟ and each two-face advance adds 1 ▟. The d3
// is the free stat baseline (p.6) and counts 0 ▟.
export const DIE_STEPS = {
    d3: 0,
    d4: 1,
    d6: 2,
    d8: 3,
    d10: 4,
    d12: 5,
    d14: 6,
    d16: 7
};
export const DICE_BY_STEP = Object.fromEntries(
    Object.entries(DIE_STEPS).map(([die, step]) => [step, die])
);
export const D6_STEP = DIE_STEPS.d6;

export function normalizeResourceKey(resource) {
    const value = String(resource || '').trim().toLowerCase();
    if (['hp', 'health', 'red', 'orange'].includes(value)) return 'hp';
    if (['en', 'energy', 'green', 'yellow'].includes(value)) return 'en';
    if (['rx', 'reflex', 'blue', 'purple'].includes(value)) return 'rx';
    return '';
}
