// @ts-check
// Exotic subsystem helpers: exotic skills, Cyber Core, Stranger (Bestial /
// Celestial / While X forms), gizmos and slivers, and Titan.
import { parsedTileTags, activeParsedTags, tileHasParsedBase } from './tags.js';

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

// Special identity tiles gain a third color box: the Celestial Homeworld
// Story tile (p.63) and the Titan Identity Gear/Story tile (p.69).
export function normalizeSpecialIdentity(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'titan-identity' || normalized === 'titan identity') return 'titan-identity';
    if (normalized === 'homeworld') return 'homeworld';
    return null;
}

// Cyber Core spend abilities (p.64): "Spend 1 Core to..." Each entry is
// unlocked by carrying the matching Build/Detail tag on an active tile.
export const CORE_ABILITIES = {
    antivenin: 'Reduce POISON',
    boost: 'Maximize dice on the chosen stat',
    breathless: 'Survive without air for 6 hours',
    charged: 'Go without fuel for 1 day',
    enhanced: 'Maximize dice on this tile',
    fireproof: 'Reduce AFIRE',
    machine: 'Add Core to Soak',
    plated: 'Reduce WOUND',
    reticle: 'Press without increasing the Press counter',
    sleepless: 'Go without sleep for 1 day',
    spacewalk: 'Survive vacuum for 1 hour',
    wired: 'Reduce BLEED'
};

// A tile is Cyber when it carries the Cyber tag (any prefix form) or is a
// Cyber exotic skill tile ("They start with the Cyber Exotic tag", p.64).
export function tileHasCyberTag(tile) {
    if (tile?.exoticSkill?.system === 'Cyber') return true;
    return tileHasParsedBase(tile, 'cyber');
}

// "Each tile with the Cyber tag contributes 1 point to the Core Resource
// Pool" (p.64). Buried tiles lose their contribution, matching the other
// resource pools; Ammo tiles count (the cyber supercharger example says its
// Cyber tag "counts toward Core").
export function calculateCoreMax(tiles = []) {
    return (tiles || []).filter(tile => tile && !tile.isBuried && tileHasCyberTag(tile)).length;
}

// Core spend abilities available to this character, deduped across tiles,
// with the granting tile names for display.
export function getCoreAbilities(tiles = []) {
    const abilities = new Map();

    (tiles || []).forEach(tile => {
        if (!tile || tile.isBuried) return;
        activeParsedTags(tile).forEach(parsed => {
            const baseTag = parsed.base;
            const effect = CORE_ABILITIES[baseTag];
            if (!effect) return;
            if (!abilities.has(baseTag)) {
                abilities.set(baseTag, {
                    id: baseTag,
                    label: baseTag.charAt(0).toUpperCase() + baseTag.slice(1),
                    effect,
                    sources: []
                });
            }
            const sources = abilities.get(baseTag).sources;
            const name = tile.name || 'Tile';
            if (!sources.includes(name)) sources.push(name);
        });
    });

    return Array.from(abilities.values()).sort((a, b) => a.id.localeCompare(b.id));
}

// Generic "does this tile carry tag X" check on the mechanical base name.
// Broken gear's tags are off; buried state is the caller's concern.
export function tileHasMechanicalTag(tile, baseTag) {
    return tileHasParsedBase(tile, baseTag);
}

// Gizmo / Sliver capacity (p.68): a character can have up to MIND+FOCUS ▟
// gizmos and BODY+POWER ▟ slivers (Knacks and Implants are the sliver tags).
export function countGizmoTiles(tiles = []) {
    return (tiles || []).filter(tile => tile && !tile.isBuried && tileHasMechanicalTag(tile, 'gizmo')).length;
}

export function countSliverTiles(tiles = []) {
    return (tiles || []).filter(tile =>
        tile && !tile.isBuried && (tileHasMechanicalTag(tile, 'knack') || tileHasMechanicalTag(tile, 'implant'))
    ).length;
}

// ---------------------------------------------------------------------------
// Stranger helpers (pp.61-63): Bestial resource points, While X forms, and
// Celestial Aural/Astral ranks.
// ---------------------------------------------------------------------------

export function tileHasBestialTag(tile) {
    if (tile?.exoticSkill?.specialty === 'Bestial') return true;
    return tileHasParsedBase(tile, 'bestial');
}

export function tileHasCelestialTag(tile) {
    if (tile?.exoticSkill?.specialty === 'Celestial') return true;
    return tileHasParsedBase(tile, 'celestial');
}

export function calculateBestialTileCount(tiles = []) {
    return (tiles || []).filter(tile => tile && !tile.isBuried && tileHasBestialTag(tile)).length;
}

// "Count tiles with Celestial for the Aural / Astral rank" (p.63).
export function calculateCelestialRank(tiles = []) {
    return (tiles || []).filter(tile => tile && !tile.isBuried && tileHasCelestialTag(tile)).length;
}

// Aural rank reads the Linear column (projected senses, forward arc);
// Astral rank reads the Time column (time apart from the body). The table
// leaves Linear blank at ranks 1 and 6.
export const CELESTIAL_RANK_TABLE = {
    1: { linear: 'Reach', time: '15 minutes' },
    2: { linear: 'Short', time: '1 hour' },
    3: { linear: 'Medium', time: '6 hours' },
    4: { linear: 'Visual', time: '1 day' },
    5: { linear: 'Long', time: '3 days' },
    6: { linear: 'Long', time: '10 days' },
    7: { linear: 'Extreme', time: '1 month' }
};

export function getCelestialAspectSummary(rank, aspect) {
    const clamped = Math.min(7, Math.max(0, parseInt(rank, 10) || 0));
    if (clamped <= 0) return '';
    const row = CELESTIAL_RANK_TABLE[clamped];
    if (aspect === 'aural') return `Aural ${clamped}: project senses to ${row.linear} range (forward arc).`;
    if (aspect === 'astral') return `Astral ${clamped}: stay apart from the body up to ${row.time} (even if the body has died).`;
    return `Celestial rank ${clamped}: pick an Aural or Astral aspect.`;
}

// "While X" form tags (p.62): the tile is in play while the character wears
// form X and buried otherwise. Form names keep their original casing for
// display; matching is case-insensitive. Raw tags (not activeTileTagList)
// are used so a BREAK-marked gear tile still binds to its form.
export function getTileWhileForms(tile) {
    return parsedTileTags(tile)
        .filter(parsed => parsed.base === 'while')
        .map(parsed => parsed.args.form || '')
        .filter(Boolean);
}

export function getCharacterForms(tiles = []) {
    const forms = new Map();
    (tiles || []).forEach(tile => getTileWhileForms(tile).forEach(form => {
        const key = form.toLowerCase();
        if (!forms.has(key)) forms.set(key, form);
    }));
    return Array.from(forms.values());
}

/**
 * Bury/unbury every While X tile to match the chosen form. An empty form
 * buries all While tiles (no form active). Tiles without While tags are
 * untouched. Mutates the tiles in place; returns the tiles whose buried
 * state changed so callers can persist and report.
 */
export function applyFormToTiles(tiles = [], formName = '') {
    const target = String(formName || '').trim().toLowerCase();
    const changed = [];

    (tiles || []).forEach(tile => {
        const forms = getTileWhileForms(tile).map(form => form.toLowerCase());
        if (forms.length === 0) return;
        const shouldBury = target === '' || !forms.includes(target);
        if (Boolean(tile.isBuried) !== shouldBury) {
            tile.isBuried = shouldBury;
            changed.push(tile);
        }
    });

    return changed;
}

// Titan ability tags (p.69): "Spend 1 Titan to..." `hv` is the Heroism (+)
// or Villainy (-) score the act earns; null means the player chooses the
// direction (Interception, Turn Them). The v5.02 "shock box"/"Lethal"
// wording was TORG cross-editing; GM ruling 2026-06-12 restated Shake Off,
// Sterner Stuff, and Kill Shot in 1000 WORDS terms (used below).
export const TITAN_ABILITIES = {
    'action hero': { effect: 'Reset your Press counter to 0', hv: 0 },
    boost: { effect: 'Add max Titan to a chosen stat for this check', hv: 0 },
    'coup de grace': { effect: 'Kill a helpless target', hv: -2 },
    'ground zero': { effect: 'Move to any spot in the combat', hv: 0 },
    interception: { effect: 'Take a hit for an ally in Reach (H), or an ally in Reach takes a hit for you (V)', hv: null },
    'kill shot': { effect: 'Each Crit your next attack deals becomes a WOUND', hv: -1 },
    'pull punch': { effect: 'All Crits on your next attack are KO', hv: 1 },
    'shake off': { effect: 'Heal 3x current Titan in resource points', hv: 0 },
    'sterner stuff': { effect: 'Soak a WOUND Crit', hv: 0 },
    'turn them': { effect: 'Make a freebie social attack to deal a VOW - switch sides (H or V)', hv: null },
    'under cover': { effect: 'Rescue a helpless target', hv: 2 },
    'zero in': { effect: 'Assign 1 die to Attack; the attack hits', hv: -2 }
};

export function tileHasTitanTag(tile) {
    return tileHasParsedBase(tile, 'titan');
}

// "Each Titan tag adds 1 point to the Titan resource pool" (p.69) - counted
// per tag instance, so duplicated Titan tags stack.
export function calculateTitanMax(tiles = []) {
    return (tiles || []).reduce((sum, tile) => {
        if (!tile || tile.isBuried) return sum;
        return sum + activeParsedTags(tile)
            .filter(parsed => parsed.base === 'titan')
            .length;
    }, 0);
}

// Titan spend abilities granted by the character's tags, deduped with
// granting tile names, mirroring getCoreAbilities.
export function getTitanAbilities(tiles = []) {
    const abilities = new Map();

    (tiles || []).forEach(tile => {
        if (!tile || tile.isBuried) return;
        activeParsedTags(tile).forEach(parsed => {
            const baseTag = parsed.base;
            const ability = TITAN_ABILITIES[baseTag];
            if (!ability) return;
            if (!abilities.has(baseTag)) {
                abilities.set(baseTag, {
                    id: baseTag,
                    label: baseTag.replace(/(^|\s)\w/g, ch => ch.toUpperCase()),
                    effect: ability.effect,
                    hv: ability.hv,
                    sources: []
                });
            }
            const sources = abilities.get(baseTag).sources;
            const name = tile.name || 'Tile';
            if (!sources.includes(name)) sources.push(name);
        });
    });

    return Array.from(abilities.values()).sort((a, b) => a.id.localeCompare(b.id));
}
