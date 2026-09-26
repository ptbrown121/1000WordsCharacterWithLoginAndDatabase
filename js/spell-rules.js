// @ts-check
// Spell school color rules — pure (no DOM), so they are unit-testable.
// The spell builder's DOM controls live in js/ui/spellColors.js.
import {
    DIE_STEPS,
    activeTileTagList,
    getDuplicateKey,
    getTileBoxes,
    parseTag,
    parsedTileTags,
    serializeTileBoxes
} from './pool.js';

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
// (+4). "For 2 XP, any tile can be built with a Qi or Id box" (p.58), so
// Shadow is +2 per shadow box, as on ordinary tiles. Off-school colors only
// count as Divergent when the player opted into custom colors (customMode);
// the Divergent school always is.
/** @param {{school: string, customMode: boolean, boxes: import('./types.js').TileBox[]}} options */
export function getColorBuildFlags({ school, customMode, boxes }) {
    const shadowBoxes = boxes.filter(box => box.type === 'shadow').length;
    const shadow = shadowBoxes > 0;
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
        shadowBoxes,
        divergent,
        xp: shadowBoxes * 2 + (divergent ? 2 : 0)
    };
}

// Spell Builder tally (p.56): "Tally your 🗱. That's XP to buy it, before
// the d4. Use 0 XP if 🗱 is negative." Only the 🗱 tally is floored; the
// dice are always paid for (Amonkenet's aid is -1🗱 on a d6 and costs 3).
/** @param {number} tallyXp the 🗱 sum @param {number} diceXp */
export function calculateSpellTotalXp(tallyXp, diceXp) {
    return Math.max(0, tallyXp) + diceXp;
}

// The Step 2 picker's generic price rows ("2 XP Crit/Tag", "-2 XP Flaw",
// ...) stand in for different tags, so two of them are not duplicates.
const SPELL_GENERIC_TAG_ROWS = new Set([
    '2 xp crit/tag', '3 xp crit', '4 xp crit/tag', 'exotic tag', '-2 xp flaw', '-4 xp flaw'
]);

// Damage Types (p.56): inflicting a flaw costs 🗱 like a tag does -
// "-2 XP Flaw (e.g., Bulky) 2🗱 / -4 XP Flaw 4🗱". Earlier builds priced
// these picker rows as rebates (-2/-4); saved pills are corrected on load.
const SPELL_INFLICTED_FLAW_XP = new Map([['-2 xp flaw', 2], ['-4 xp flaw', 4]]);

/** @param {{name: string, xp: number}} tag */
function spellTagDuplicateKey(tag) {
    const parsed = parseTag(tag.name);
    if (SPELL_GENERIC_TAG_ROWS.has(parsed.name.toLowerCase())) return '';
    return getDuplicateKey(tag.name);
}

// Each Step 2 tag pill's 🗱. "Duplicating a tag adds 2 for each copy"
// (p.57: Keen +2, then Keen +4), the same surcharge ordinary tiles pay.
/** @param {Array<{name: string, xp: number}>} tags @returns {number[]} */
export function getSpellTagXpList(tags = []) {
    const seen = new Map();
    return tags.map(tag => {
        const key = spellTagDuplicateKey(tag);
        const previousCopies = key ? (seen.get(key) || 0) : 0;
        if (key) seen.set(key, previousCopies + 1);
        return (parseInt(String(tag.xp), 10) || 0) + previousCopies * 2;
    });
}

/** @param {Array<{name: string, xp: number}>} tags */
export function calculateSpellTagXp(tags = []) {
    return getSpellTagXpList(tags).reduce((sum, xp) => sum + xp, 0);
}

// Step 4 modifier counters that were removed because the same effect is a
// Step 2 tag (Escape! p.48, the Sacrifice tags pp.48/56). The tag is the
// single entry point: it shows on the card and it is what cast-time
// resource charging reads. The 🗱 matches the removed counter's price.
export const SPELL_LEGACY_MODIFIER_TAGS = Object.freeze({
    'Escape!': { name: 'Escape!', xp: 4 },
    Sap: { name: 'Sap', xp: -2 },
    Saps: { name: 'Sap', xp: -2 },
    Tire: { name: 'Tire', xp: -3 },
    Drain: { name: 'Drain', xp: -4 },
    Drains: { name: 'Drain', xp: -4 },
    Witch: { name: 'Witch', xp: -6 }
});

// Loads a saved spell's Step 2 tag pills for the builder: fixes the old
// inflicted-flaw rebate sign, and turns a legacy Sap/Tire/Drain/Witch/Escape!
// modifier count into one tag pill. A count above 1 collapses to one tag
// (cast-time charging only ever charged the resource once), and a spell
// that already carries the tag gets no second copy (it used to take the
// discount twice). Returns the tags plus the legacy spellState keys read.
/**
 * @param {Object<string, any>} spellState
 * @returns {{tags: Array<{name: string, xp: number}>, consumedKeys: string[]}}
 */
export function migrateSpellFormTags(spellState = {}) {
    const tags = (Array.isArray(spellState.tagsList) ? spellState.tagsList : [])
        .filter(tag => tag && typeof tag.name === 'string')
        .map(tag => {
            const inflicted = SPELL_INFLICTED_FLAW_XP.get(parseTag(tag.name).name.toLowerCase());
            return inflicted !== undefined && Number(tag.xp) < 0
                ? { ...tag, xp: inflicted }
                : { ...tag };
        });

    const consumedKeys = [];
    Object.entries(SPELL_LEGACY_MODIFIER_TAGS).forEach(([label, replacement]) => {
        const key = `spell-mod-val-${label}`;
        if (!(key in spellState)) return;
        consumedKeys.push(key);
        if ((parseInt(spellState[key], 10) || 0) <= 0) return;
        const baseKey = getDuplicateKey(replacement.name);
        if (tags.some(tag => getDuplicateKey(tag.name) === baseKey)) return;
        tags.push({ ...replacement });
    });

    return { tags, consumedKeys };
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

// Gizmo (p.68): "This Detail tag converts a Spell into an independent
// tool ... it does not need Arcane skills or spell tests." The raw tag list
// is read so a Broken gizmo still does not grow a casting Test.
/** @param {import('./types.js').Tile} tile */
function hasCastingTest(tile) {
    return Boolean(tile?.isSpell) && !parsedTileTags(tile).some(parsed => parsed.base === 'gizmo');
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
    return calledTiles.filter(hasCastingTest).map(spell => buildSpellCastTest(spell, arcanaByName));
}

// The Test a spell tile shows on its card: the same rule, using whichever
// unburied Arcana tile the spell chains to on the character sheet.
/**
 * @param {import('./types.js').Tile} spell
 * @param {import('./types.js').Tile[]} tiles all of the character's tiles
 */
export function getSpellTileCastTest(spell, tiles = []) {
    if (!hasCastingTest(spell)) return null;
    return buildSpellCastTest(spell, arcanaTilesByName(tiles.filter(tile => !tile.isBuried)));
}
