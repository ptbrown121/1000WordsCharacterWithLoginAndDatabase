// @ts-check
// Spell school color rules — pure (no DOM), so they are unit-testable.
// The spell builder's DOM controls live in js/ui/spellColors.js.
import { DIE_STEPS, activeTileTagList, getTileBoxes, parseTag, serializeTileBoxes } from './pool.js';

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

/** @param {import('./types.js').Tile} tile */
function isArcanaSkillTile(tile) {
    return tile?.type === 'Skill' && (tile.exoticSkill?.system === 'Arcana' || Boolean(tile.isSpellcastSkill));
}

/** @param {import('./types.js').Tile} tile @returns {string[]} lowercased Chain targets */
function chainTargets(tile) {
    return activeTileTagList(tile)
        .map(parseTag)
        .filter(parsed => parsed.prefix === null && parsed.base === 'chain' && parsed.args.target)
        .map(parsed => String(parsed.args.target).trim().toLowerCase());
}

/**
 * @param {import('./types.js').Tile} spell
 * @param {Map<string, import('./types.js').Tile>} arcanaByName lowercased name -> Arcana tile
 */
function buildSpellCastTest(spell, arcanaByName) {
    const spellXp = Math.max(0, parseInt(String(spell.xpCost ?? 0), 10) || 0);
    const arcana = chainTargets(spell).map(target => arcanaByName.get(target)).find(Boolean) || null;
    const reduction = arcana
        ? (arcana.dice || []).reduce((steps, die) => steps + (DIE_STEPS[die] || 0), 0)
        : 0;
    return {
        spellId: spell.id,
        spellName: spell.name || 'Unnamed spell',
        spellXp,
        arcanaName: arcana ? (arcana.name || 'Arcana skill') : null,
        reduction,
        test: Math.max(0, spellXp - reduction)
    };
}

/** @param {import('./types.js').Tile[]} tiles */
function arcanaTilesByName(tiles) {
    return new Map(tiles
        .filter(isArcanaSkillTile)
        .map(tile => [String(tile.name || '').trim().toLowerCase(), tile]));
}

// Casting Test (p.48): "The spell's XP investment is its Test to cast. The
// action check must meet the Test to trigger the spell. The chained tile
// reduces the Test difficulty by its ▟." Only an Arcana skill tile that was
// actually called with the spell (i.e. its chain link was not disabled)
// reduces the Test. A Test at or below 0 means the spell always casts.
/**
 * @param {import('./types.js').Tile[]} calledTiles
 * @returns {Array<{spellId: string, spellName: string, spellXp: number, arcanaName: string|null, reduction: number, test: number}>}
 */
export function getSpellCastTests(calledTiles = []) {
    const arcanaByName = arcanaTilesByName(calledTiles);
    return calledTiles.filter(tile => tile?.isSpell).map(spell => buildSpellCastTest(spell, arcanaByName));
}

// The Test a spell tile shows on its card: the same rule, using whichever
// unburied Arcana tile the spell chains to on the character sheet.
/**
 * @param {import('./types.js').Tile} spell
 * @param {import('./types.js').Tile[]} tiles all of the character's tiles
 */
export function getSpellTileCastTest(spell, tiles = []) {
    if (!spell?.isSpell) return null;
    return buildSpellCastTest(spell, arcanaTilesByName(tiles.filter(tile => !tile.isBuried)));
}
