// @ts-check
// Pure data-boundary helpers shared by the browser, API route, and live evals.
// The model may suggest a pool, but only this module decides whether that
// suggestion is mechanically legal for the supplied character sheet.

import { getTileBoxes, NORMAL_COLORS, tileTagList } from './pool.js';
import {
    getSharedTileCallColors,
    isAvailablePoolTile
} from './pool-tile-selection.js';
import { isHitchedTile, tileMatchesCallColor } from './pool.js';

export const POOL_ASSISTANT_MAX_COMMAND_LENGTH = 500;
export const POOL_ASSISTANT_MAX_TILES = 100;
export const POOL_ASSISTANT_MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const POOL_ASSISTANT_AUDIO_MIME_TYPES = new Set([
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/webm'
]);

const STAT_DESCRIPTIONS = {
    BODY: 'toughness, size, and build',
    POWER: 'strength and stamina',
    SOUL: 'fellowship and empathy',
    FOCUS: 'drive and concentration',
    MIND: 'perception and knowledge',
    SPEED: 'quickness and alertness'
};

/** @param {unknown} value @param {number} maxLength */
function boundedText(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

/** @param {unknown} value */
function stringList(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter(item => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean);
}

/** @param {import('./types.js').Tile} tile */
export function serializePoolAssistantTile(tile) {
    const boxes = getTileBoxes(tile).map(box => box.type === 'shadow'
        ? { type: 'shadow', kind: box.kind || '', resource: box.resource || '' }
        : { type: 'color', color: box.color || '' });
    return {
        id: boundedText(tile?.id, 100),
        name: boundedText(tile?.name, 100),
        type: boundedText(tile?.type, 30),
        colors: [...new Set((tile?.colors || []).filter(color => NORMAL_COLORS.includes(color)))],
        boxes,
        dice: stringList(tile?.dice).slice(0, 12),
        tags: tileTagList(tile).map(tag => boundedText(tag, 100)).filter(Boolean).slice(0, 20),
        description: boundedText(tile?.description, 300),
        gearSubtype: boundedText(tile?.gearSubtype, 30),
        isBurnt: Boolean(tile?.isBurnt),
        isBuried: Boolean(tile?.isBuried),
        isHitched: isHitchedTile(tile),
        available: isAvailablePoolTile(tile)
    };
}

/**
 * Build the only character information sent to the assistant.
 * @param {Partial<import('./types.js').CharacterState>|null|undefined} state
 */
export function buildPoolAssistantCharacter(state) {
    const tiles = Array.isArray(state?.tiles) ? state.tiles : [];
    if (tiles.length > POOL_ASSISTANT_MAX_TILES) {
        throw new Error(`The pool assistant supports at most ${POOL_ASSISTANT_MAX_TILES} tiles.`);
    }
    const rawStats = state?.stats && typeof state.stats === 'object' ? state.stats : {};
    const stats = Object.fromEntries(Object.keys(STAT_DESCRIPTIONS).map(stat => [
        stat,
        boundedText(rawStats[stat], 100)
    ]));
    return {
        name: boundedText(state?.name, 100),
        stats,
        statDescriptions: { ...STAT_DESCRIPTIONS },
        tiles: tiles.map(serializePoolAssistantTile)
    };
}

/** @param {unknown} value */
export function normalizePoolAssistantSuggestion(value) {
    const source = /** @type {any} */ (value && typeof value === 'object' ? value : {});
    const status = source.status === 'ready' ? 'ready' : 'needs_clarification';
    const confidence = ['high', 'medium', 'low'].includes(source.confidence)
        ? source.confidence
        : 'low';
    if (status !== 'ready') {
        return {
            status,
            callColors: [],
            callTileId: '',
            burnTileIds: [],
            confidence,
            rationale: boundedText(source.rationale, 500),
            warnings: stringList(source.warnings).map(item => item.slice(0, 200)).slice(0, 8)
        };
    }
    return {
        status,
        callColors: [...new Set(stringList(source.callColors))],
        callTileId: boundedText(source.callTileId, 100),
        burnTileIds: [...new Set(stringList(source.burnTileIds))],
        confidence,
        rationale: boundedText(source.rationale, 500),
        warnings: stringList(source.warnings).map(item => item.slice(0, 200)).slice(0, 8)
    };
}

/**
 * @param {ReturnType<typeof normalizePoolAssistantSuggestion>} suggestion
 * @param {import('./types.js').Tile[]} tiles
 */
export function validatePoolAssistantSuggestion(suggestion, tiles) {
    const errors = [];
    if (suggestion.status === 'needs_clarification') {
        return { valid: true, errors, callTile: null, burnTiles: [] };
    }

    if (suggestion.callColors.length !== 2) errors.push('A ready suggestion must contain exactly two distinct Call colors.');
    if (suggestion.callColors.some(color => !NORMAL_COLORS.includes(color))) errors.push('The suggestion contains an unknown Call color.');

    const tileById = new Map((tiles || []).map(tile => [tile.id, tile]));
    const callTile = tileById.get(suggestion.callTileId) || null;
    if (!callTile) {
        errors.push('The suggested Call tile does not exist.');
    } else {
        if (!isAvailablePoolTile(callTile)) errors.push('The suggested Call tile is unavailable.');
        if (!suggestion.callColors.some(color => tileMatchesCallColor(callTile, color))) {
            errors.push('The suggested Call tile does not match either Call color.');
        }
    }

    /** @type {import('./types.js').Tile[]} */
    const burnTiles = [];
    suggestion.burnTileIds.forEach(id => {
        const tile = tileById.get(id);
        if (tile) burnTiles.push(tile);
    });
    if (burnTiles.length !== suggestion.burnTileIds.length) errors.push('At least one suggested Burn tile does not exist.');
    burnTiles.forEach(tile => {
        if (!isAvailablePoolTile(tile)) errors.push(`Burn tile "${tile.name}" is unavailable.`);
        if (isHitchedTile(tile)) errors.push(`Hitched tile "${tile.name}" cannot be burned.`);
        if (tile.id === suggestion.callTileId) errors.push('The Call tile cannot also be a Burn tile.');
    });

    if (callTile && burnTiles.length > 0
        && getSharedTileCallColors(suggestion.callColors, [callTile, ...burnTiles]).length === 0) {
        errors.push('The Call and Burn tiles do not share one selected Call color.');
    }

    return { valid: errors.length === 0, errors, callTile, burnTiles };
}

/**
 * @param {unknown} rawSuggestion
 * @param {import('./types.js').Tile[]} tiles
 */
export function resolvePoolAssistantSelection(rawSuggestion, tiles) {
    const suggestion = normalizePoolAssistantSuggestion(rawSuggestion);
    const validation = validatePoolAssistantSuggestion(suggestion, tiles);
    return { suggestion, ...validation };
}

/** @param {unknown} actual @param {Array<Record<string, unknown>>} accepted */
export function matchesAcceptedPoolAssistantSelection(actual, accepted) {
    return getPoolAssistantSelectionMatch(actual, accepted).exact;
}

/**
 * Report component matches as diagnostics without weakening the exact gate.
 * Each component may match any accepted complete output; `exact` still requires
 * one accepted output to match as a whole.
 * @param {unknown} actual @param {Array<Record<string, unknown>>} accepted
 */
export function getPoolAssistantSelectionMatch(actual, accepted) {
    const normalizedActual = normalizePoolAssistantSuggestion(actual);
    const normalizedAccepted = (accepted || []).map(normalizePoolAssistantSuggestion);
    /** @param {ReturnType<typeof normalizePoolAssistantSuggestion>} suggestion */
    const colors = suggestion => [...suggestion.callColors].sort().join('|');
    /** @param {ReturnType<typeof normalizePoolAssistantSuggestion>} suggestion */
    const burns = suggestion => [...suggestion.burnTileIds].sort().join('|');
    /** @param {ReturnType<typeof normalizePoolAssistantSuggestion>} candidate */
    const same = candidate => normalizedActual.status === candidate.status
        && normalizedActual.callTileId === candidate.callTileId
        && colors(normalizedActual) === colors(candidate)
        && burns(normalizedActual) === burns(candidate);
    return {
        exact: normalizedAccepted.some(same),
        status: normalizedAccepted.some(candidate => normalizedActual.status === candidate.status),
        callColors: normalizedAccepted.some(candidate => colors(normalizedActual) === colors(candidate)),
        callTile: normalizedAccepted.some(candidate => normalizedActual.callTileId === candidate.callTileId),
        burns: normalizedAccepted.some(candidate => burns(normalizedActual) === burns(candidate))
    };
}
