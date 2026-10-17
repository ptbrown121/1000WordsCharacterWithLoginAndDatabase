// @ts-check
import { normalizeActiveCrits, normalizeActiveSustains } from './status-rules.js';

// The six stats and their Rosette colors (pp.5-7).
export const STAT_COLORS = {
    'BODY': 'Red',
    'POWER': 'Orange',
    'SOUL': 'Yellow',
    'FOCUS': 'Green',
    'MIND': 'Blue',
    'SPEED': 'Purple'
};

export const COLOR_HEX = {
    'Red': '#ff3333',
    'Orange': '#ff9933',
    'Yellow': '#ffcc00',
    'Green': '#33cc33',
    'Blue': '#3399ff',
    'Purple': '#9933ff',
    'Qi': '#f7f3d0',
    'Id': '#5a4a69'
};

export const VALID_DICE = new Set(['d3', 'd4', 'd6', 'd8', 'd10', 'd12', 'd14', 'd16']);

const EXOTIC_SKILL_DATA = {
    'arcana-twist': { system: 'Arcana', specialty: 'Twist', label: 'Arcana: Twist', baseXp: 2 },
    'arcana-forge': { system: 'Arcana', specialty: 'Forge', label: 'Arcana: Forge', baseXp: 2 },
    'arcana-augur': { system: 'Arcana', specialty: 'Augur', label: 'Arcana: Augur', baseXp: 2 },
    bestial: { system: 'Stranger', specialty: 'Bestial', label: 'Stranger: Bestial', baseXp: 2 },
    celestial: { system: 'Stranger', specialty: 'Celestial', label: 'Stranger: Celestial', baseXp: 2 },
    cyber: { system: 'Cyber', specialty: 'Cyber', label: 'Cyber', baseXp: 2 }
};

function normalizeStoredExoticSkill(value) {
    if (!value) return null;
    const id = typeof value === 'string' ? value : value.id || value.type || '';
    const option = EXOTIC_SKILL_DATA[id];
    return option ? { id, ...option } : null;
}

/**
 * In-place migration: ensure tile.tags is a string[] of trimmed tag strings.
 * Legacy saves stored it as a comma-separated string; SpellBuilder once
 * stored it as a list of {name, xp} objects. This normalizer is idempotent
 * and is called both when loading from localStorage and when importing JSON.
 *
 * Also strips a known-bad tag pattern: spells saved before the
 * "preview-as-tag" bug fix have the auto-generated description sentence
 * (always starting with "Effect:") incorrectly appended to tile.tags. We
 * detect those by `isSpell && tag.startsWith('Effect:')` and drop them.
 * Real player-authored tags do not begin with "Effect:" - the rulebook's
 * tag taxonomy does not include such a tag.
 */
export function normalizeTileTags(tile) {
    if (!tile || typeof tile !== 'object') return;
    const raw = tile.tags;

    if (raw == null || raw === '') {
        tile.tags = [];
        return;
    }

    const items = Array.isArray(raw) ? raw : String(raw).split(',');
    const isSpell = Boolean(tile.isSpell);
    tile.tags = items
        .map(item => {
            if (item && typeof item === 'object') return String(item.name || '').trim();
            return String(item || '').trim();
        })
        .filter(Boolean)
        .filter(tag => !(isSpell && tag.startsWith('Effect:')));
}

function normalizeNumber(value, fallback = 0) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

const NORMAL_COLORS = new Set(['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple']);
const RESOURCE_KEYS = new Set(['hp', 'en', 'rx']);

function normalizeShadowKind(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'qi' || normalized === 'white') return 'Qi';
    if (normalized === 'id' || normalized === 'black') return 'Id';
    return '';
}

function normalizeResourceKey(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['hp', 'health', 'red', 'orange'].includes(normalized)) return 'hp';
    if (['en', 'energy', 'green', 'yellow'].includes(normalized)) return 'en';
    if (['rx', 'reflex', 'blue', 'purple'].includes(normalized)) return 'rx';
    return RESOURCE_KEYS.has(normalized) ? normalized : '';
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
    return NORMAL_COLORS.has(color) ? { type: 'color', color } : null;
}

function boxesFromLegacyColors(colors = []) {
    return colors.map(color => {
        const shadowKind = normalizeShadowKind(color);
        if (shadowKind) return { type: 'shadow', kind: shadowKind, resource: '' };
        return NORMAL_COLORS.has(color) ? { type: 'color', color } : null;
    }).filter(Boolean).slice(0, 2);
}

function colorsFromBoxes(boxes = []) {
    return boxes.map(box => box.type === 'shadow' ? box.kind : box.color);
}

// Special identity tiles (Homeworld p.63, Titan Identity p.69) carry a
// third color box; all other tiles stay capped at two.
function normalizeSpecialIdentity(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'titan-identity' || normalized === 'titan identity') return 'titan-identity';
    if (normalized === 'homeworld') return 'homeworld';
    return null;
}

export function normalizeTileMetadata(tile) {
    if (!tile || typeof tile !== 'object') return;

    if (tile.isBurnt === undefined) tile.isBurnt = false;
    if (tile.isBuried === undefined) tile.isBuried = false;
    tile.specialIdentity = normalizeSpecialIdentity(tile.specialIdentity);
    const rawBoxes = Array.isArray(tile.boxes) && tile.boxes.length > 0
        ? tile.boxes.map(normalizeTileBox).filter(Boolean)
        : boxesFromLegacyColors(tile.colors || []);
    tile.boxes = rawBoxes.slice(0, tile.specialIdentity ? 3 : 2);
    tile.colors = colorsFromBoxes(tile.boxes);
    tile.exoticSkill = tile.type === 'Skill' ? normalizeStoredExoticSkill(tile.exoticSkill) : null;
    tile.gearBroken = tile.type === 'Gear' ? Boolean(tile.gearBroken || tile.isGearBroken) : false;
    if (tile.gearSubtype === undefined && tile.type === 'Gear') {
        tile.gearSubtype = tile.ammo ? 'Ammo' : tile.weapon ? 'Weapon' : tile.armorType ? 'Armor' : 'Custom';
    }

    if (tile.type === 'Gear' && tile.gearSubtype === 'Ammo') {
        const ammo = tile.ammo || {};
        const maxSupply = Math.max(0, normalizeNumber(ammo.maxSupply ?? ammo.supplyMax, 1));
        const currentSupply = Math.min(maxSupply, Math.max(0, normalizeNumber(ammo.currentSupply, maxSupply)));
        tile.ammo = {
            targetTileId: String(ammo.targetTileId || ''),
            targetName: String(ammo.targetName || ''),
            currentSupply,
            maxSupply,
            replacesTag: String(ammo.replacesTag || 'Reload').trim()
        };
        tile.dice = [];
        if (!Array.isArray(tile.colors)) tile.colors = [];
        if (!Array.isArray(tile.boxes)) tile.boxes = [];
    }

    normalizeTileTags(tile);
}

/**
 * Effective max for a vital resource: base max + permanent bonus + temporary bonus.
 *
 * `key` is the resource prefix used in state: 'hp' | 'en' | 'rx' | 'sh'.
 * For HP/EN/RX, the base is `${key}Max`. SH has no stored max - its base is
 * derived from the tile mosaic at call time, so callers pass it via the
 * optional `baseOverride` argument.
 *
 * Always returns a finite integer, defaulting any missing/non-numeric piece
 * to 0. This is the single source of truth for the (max + perm + temp) sum
 * that previously appeared inline in render.js, vitals.js Rest, and vitals.js
 * Auto-Calculate Vitals.
 */
export function getEffectiveMax(state, key, baseOverride) {
    const toInt = (v) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : 0;
    };
    const base = baseOverride !== undefined ? toInt(baseOverride) : toInt(state?.[`${key}Max`]);
    const perm = toInt(state?.[`${key}Perm`]);
    const temp = toInt(state?.[`${key}Temp`]);
    return base + perm + temp;
}

function inferShowOptionalStats(state) {
    return Boolean((state?.tiles || []).some(tile =>
        (tile.colors || []).some(color => ['Qi', 'Id', 'Black', 'White'].includes(color))
    ));
}

export const DEFAULT_STATE = {
    name: 'Hero Name',
    xpEarned: 75,
    xpSpentAdjustment: 0,
    storyPoints: 0,
    storyPointsSpent: 0,
    storyPointsEarned: 0,
    hp: 0,
    hpMax: 0,
    hpTemp: 0,
    hpPerm: 0,
    en: 0,
    enMax: 0,
    enTemp: 0,
    enPerm: 0,
    rx: 0,
    rxMax: 0,
    rxTemp: 0,
    rxPerm: 0,
    sh: 0,
    shTemp: 0,
    shPerm: 0,
    core: 0,     // current Cyber Core; max derives from Cyber-tagged tiles
    coreTemp: 0,
    corePerm: 0,
    titan: 0,    // current Titan; max derives from Titan tags on tiles
    titanTemp: 0,
    titanPerm: 0,
    titanHV: 0,  // signed Heroism (+) / Villainy (-) score; H cancels V
    currentForm: '',      // active While X form name ('' = no form)
    celestialAspect: '',  // '' | 'aural' | 'astral' (p.63)
    aberration: 0,
    legacyShadowWarning: false,
    gmOverride: false,
    showOptionalStats: false,
    activeCrits: {}, // { critId: count } - see CRIT_DASHBOARD in status-rules.js
    pressCount: 0,   // per-fight Press/Haywire counter (p.37); reset when the fight ends
    activeSustains: [], // tile ids of Sustain spells currently kept up (p.50)
    stats: {
        'BODY': '',
        'POWER': '',
        'SOUL': '',
        'FOCUS': '',
        'MIND': '',
        'SPEED': ''
    },
    tiles: [], // { id, name, colors: [], dice: [], tags: '', xpCost: 0 }
    journal: [] // { id, title, content }
};

export function cloneDefaultState() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

export function normalizeStateForShadowRules(state) {
    if (!state || typeof state !== 'object') return state;

    if (state.storyPointsEarned === undefined) {
        state.storyPointsEarned = normalizeNumber(state.storyPoints, 0);
    } else {
        state.storyPointsEarned = normalizeNumber(state.storyPointsEarned, 0);
    }
    state.storyPointsSpent = normalizeNumber(state.storyPointsSpent, 0);
    state.storyPoints = state.storyPointsEarned;
    state.xpSpentAdjustment = normalizeNumber(state.xpSpentAdjustment, 0);

    const stats = state.stats || {};
    const hasLegacyStatData = Boolean(stats.Id || stats.Qi);
    state.legacyShadowWarning = Boolean(state.legacyShadowWarning || hasLegacyStatData);
    state.stats = {
        BODY: stats.BODY || '',
        POWER: stats.POWER || '',
        SOUL: stats.SOUL || '',
        FOCUS: stats.FOCUS || '',
        MIND: stats.MIND || '',
        SPEED: stats.SPEED || ''
    };
    state.aberration = normalizeNumber(state.aberration, 0);
    state.activeCrits = normalizeActiveCrits(state.activeCrits);
    state.pressCount = Math.max(0, normalizeNumber(state.pressCount, 0));
    state.activeSustains = normalizeActiveSustains(state.activeSustains);
    if (state.sh === undefined) state.sh = 0;
    if (state.shTemp === undefined) state.shTemp = 0;
    if (state.shPerm === undefined) state.shPerm = 0;
    state.core = Math.max(0, normalizeNumber(state.core, 0));
    state.coreTemp = normalizeNumber(state.coreTemp, 0);
    state.corePerm = normalizeNumber(state.corePerm, 0);
    state.titan = Math.max(0, normalizeNumber(state.titan, 0));
    state.titanTemp = normalizeNumber(state.titanTemp, 0);
    state.titanPerm = normalizeNumber(state.titanPerm, 0);
    state.titanHV = normalizeNumber(state.titanHV, 0);
    state.currentForm = typeof state.currentForm === 'string' ? state.currentForm : '';
    state.celestialAspect = ['aural', 'astral'].includes(state.celestialAspect) ? state.celestialAspect : '';
    if (!Array.isArray(state.tiles)) state.tiles = [];
    state.tiles.forEach(normalizeTileMetadata);
    return state;
}

export function reorderTilesByVisibleMove(allTiles = [], visibleTileIds = [], draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return allTiles;
    const visibleIdSet = new Set(visibleTileIds);
    if (!visibleIdSet.has(draggedId) || !visibleIdSet.has(targetId)) return allTiles;

    const visibleOrder = visibleTileIds.filter(id => allTiles.some(tile => tile.id === id));
    const fromIndex = visibleOrder.indexOf(draggedId);
    const toIndex = visibleOrder.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return allTiles;

    const [dragged] = visibleOrder.splice(fromIndex, 1);
    visibleOrder.splice(toIndex, 0, dragged);

    const tileById = new Map(allTiles.map(tile => [tile.id, tile]));
    const reorderedVisibleTiles = visibleOrder
        .map(id => tileById.get(id))
        .filter(Boolean);
    let visibleIndex = 0;

    return allTiles.map(tile => {
        if (!visibleIdSet.has(tile.id)) return tile;
        return reorderedVisibleTiles[visibleIndex++] || tile;
    });
}

export function mergeStateWithDefaults(state) {
    const merged = state && typeof state === 'object' ? state : {};
    const hadShowOptionalStats = merged.showOptionalStats !== undefined;
    for (const key of Object.keys(DEFAULT_STATE)) {
        if (merged[key] === undefined) {
            merged[key] = JSON.parse(JSON.stringify(DEFAULT_STATE[key]));
        }
    }
    if (!hadShowOptionalStats) merged.showOptionalStats = inferShowOptionalStats(merged);
    return normalizeStateForShadowRules(merged);
}

export function normalizeImportedState(newState) {
    if (!newState || typeof newState !== 'object' || !newState.stats || !newState.tiles) return null;
    return mergeStateWithDefaults(newState);
}
