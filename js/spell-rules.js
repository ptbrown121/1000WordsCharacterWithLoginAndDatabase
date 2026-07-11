// @ts-check
// Spell school color rules — pure (no DOM), so they are unit-testable.
// The spell builder's DOM controls live in js/ui/spellColors.js.
import { getTileBoxes, serializeTileBoxes } from './pool.js';

/** @type {ReadonlySet<import('./types.js').NormalColor>} */
export const SPELL_NORMAL_COLORS = new Set(['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple']);
/** @type {ReadonlySet<'Qi'|'Id'>} */
export const SPELL_SHADOW_KINDS = new Set(['Qi', 'Id']);
// Default school colors from the spell chapters: Augur is Blue/Orange
// (p.49), Forge Green/Red (p.50), Twist Yellow/Purple (p.51).
/** @type {Object<string, import('./types.js').TileBox[]>} */
export const SPELL_DEFAULT_BOXES = {
    Twist: [{ type: 'color', color: 'Yellow' }, { type: 'color', color: 'Purple' }],
    Forge: [{ type: 'color', color: 'Green' }, { type: 'color', color: 'Red' }],
    Augur: [{ type: 'color', color: 'Blue' }, { type: 'color', color: 'Orange' }]
};

/** @param {string} school @returns {import('./types.js').TileBox[]} */
export function getDefaultSpellBoxes(school) {
    return /** @type {import('./types.js').TileBox[]} */ (serializeTileBoxes(SPELL_DEFAULT_BOXES[school] || []));
}

// Shadow and Divergent are independent costs: e.g. Forge with Red+Qi is
// Shadow only (+2), while Forge with Blue+Qi is both Shadow and Divergent
// (+4). Off-school colors only count as Divergent when the player opted
// into custom colors (customMode); the Divergent school always is.
/** @param {{school: string, customMode: boolean, boxes: import('./types.js').TileBox[]}} options */
export function getColorBuildFlags({ school, customMode, boxes }) {
    const shadow = boxes.some(box => box.type === 'shadow');
    let divergent = school === 'Divergent';

    if (!divergent && customMode) {
        const defaultColors = new Set((SPELL_DEFAULT_BOXES[school] || [])
            .filter(box => box.type === 'color')
            .map(box => box.color));
        const normalColors = boxes
            .filter(box => box.type === 'color')
            .map(box => box.color);
        divergent = normalColors.some(color => !defaultColors.has(color));
    }

    return {
        shadow,
        divergent,
        xp: (shadow ? 2 : 0) + (divergent ? 2 : 0)
    };
}

/** @param {string} school @param {import('./types.js').Tile} tile */
export function spellBoxesDifferFromDefault(school, tile) {
    if (!SPELL_DEFAULT_BOXES[school]) return true;
    const boxes = getTileBoxes(tile);
    const defaultKeys = getDefaultSpellBoxes(school).map(box => box.type === 'shadow' ? box.kind : box.color).sort();
    const tileKeys = boxes.map(box => box.type === 'shadow' ? box.kind : box.color).sort();
    return defaultKeys.length !== tileKeys.length || defaultKeys.some((key, index) => key !== tileKeys[index]);
}
