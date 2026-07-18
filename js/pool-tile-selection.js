// @ts-check
// Pure helpers for the compact Call/Burn tile picker. Keeping the filtering
// here makes the mobile UI follow the same color-intersection rule as the
// pool engine without tying tests to the DOM.

import { isHitchedTile, tileMatchesCallColor } from './pool.js';

/** @param {import('./types.js').Tile|null|undefined} tile */
export function isAvailablePoolTile(tile) {
    return Boolean(tile && !tile.isBuried && !tile.isBurnt && tile.gearSubtype !== 'Ammo');
}

/**
 * Return the selected Call colors shared by every supplied tile.
 * @param {string[]} callColors
 * @param {Array<import('./types.js').Tile|null|undefined>} tiles
 */
export function getSharedTileCallColors(callColors, tiles) {
    const uniqueColors = [...new Set((callColors || []).filter(Boolean))];
    if (tiles.length === 0 || tiles.some(tile => !tile)) return [];
    return uniqueColors.filter(color => tiles.every(tile => tileMatchesCallColor(tile, color)));
}

/**
 * @param {import('./types.js').Tile[]} tiles
 * @param {string[]} callColors
 */
export function getCallTileChoices(tiles, callColors) {
    const uniqueColors = [...new Set((callColors || []).filter(Boolean))];
    return (tiles || []).filter(tile =>
        isAvailablePoolTile(tile)
        && uniqueColors.some(color => tileMatchesCallColor(tile, color))
    );
}

/**
 * Burn choices must share at least one selected Call color with the Call tile
 * and every burn already selected. Selected burns remain visible so they can
 * always be removed, even if older UI state has become invalid.
 * @param {import('./types.js').Tile[]} tiles
 * @param {string[]} callColors
 * @param {import('./types.js').Tile|null} callTile
 * @param {import('./types.js').Tile[]} burnTiles
 */
export function getBurnTileChoices(tiles, callColors, callTile, burnTiles) {
    if (!callTile) return [];
    const selectedIds = new Set((burnTiles || []).map(tile => tile.id));
    const sharedColors = getSharedTileCallColors(callColors, [callTile, ...(burnTiles || [])]);

    return (tiles || []).filter(tile => {
        if (!isAvailablePoolTile(tile) || isHitchedTile(tile) || tile.id === callTile.id) return false;
        if (selectedIds.has(tile.id)) return true;
        return sharedColors.some(color => tileMatchesCallColor(tile, color));
    });
}

/**
 * Preserve as many existing burns as possible after the Call tile changes,
 * in their original selection order.
 * @param {string[]} callColors
 * @param {import('./types.js').Tile} callTile
 * @param {import('./types.js').Tile[]} burnTiles
 */
export function getCompatibleBurnTiles(callColors, callTile, burnTiles) {
    /** @type {import('./types.js').Tile[]} */
    const compatible = [];
    for (const tile of burnTiles || []) {
        if (!isAvailablePoolTile(tile)
            || isHitchedTile(tile)
            || tile.id === callTile.id
            || getSharedTileCallColors(callColors, [callTile, ...compatible, tile]).length === 0) {
            continue;
        }
        compatible.push(tile);
    }
    return compatible;
}
