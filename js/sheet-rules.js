// @ts-check
// Pure character-sheet rules (v5.02 pp.11, 14, 29, 35, 50, 61):
//
// - Resource maxes following tile changes (gain, loss, bury, restore).
// - Movement distances (Pace / Walk / Run / Dash) from current state.
// - Sustain spell upkeep tracking.
//
// No DOM access; covered by test/sheet-rules.test.js. Kept out of
// status-rules.js because these helpers read tiles through pool.js, and
// data.js (which pool.js's rules modules import) already imports
// status-rules.js.
import { getEffectiveMax } from './data.js';
import {
    DIE_STEPS,
    MECHANICAL_PREFIXES,
    activeParsedTags,
    calculateBestialTileCount,
    parseTag,
    tileTagList
} from './pool.js';
import { normalizeActiveCrits, normalizeActiveSustains } from './status-rules.js';

export { normalizeActiveSustains };

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** @typedef {'hp'|'en'|'rx'} NormalResourceKey */
/** @type {NormalResourceKey[]} */
export const NORMAL_RESOURCES = ['hp', 'en', 'rx'];

const tileSteps = (tile) => (tile?.dice || []).reduce((sum, die) => sum + (DIE_STEPS[die] || 0), 0);

// ---------------------------------------------------------------------------
// Resource maxes follow tiles (p.11)
// ---------------------------------------------------------------------------

// "Pools are adjusted whenever new tiles are gained. ... If a tile is
// buried, its contributions to pools are lost." (p.11)
//
// The stored `hpMax` / `enMax` / `rxMax` are the tile-derived base; manual
// adjustments live in the separate Perm / Temp bonus fields (getEffectiveMax
// in data.js). Older builds let players type the base max directly, so a
// saved base may deliberately differ from the tiles. To avoid wiping such an
// edit, a tile change shifts each stored base by the change in the
// tile-derived max (after - before) instead of overwriting it. When the
// stored base already matches the tiles (every character that has used
// Auto-Calculate Vitals), this is identical to a full recompute; any
// pre-existing offset is kept and reported by getResourceMaxDrift.
//
// Current pools: a lower max clamps the current value down to the new
// effective max (same as the Auto-Calculate Vitals button). A higher max
// does not refill the pool - the rulebook adjusts the pool's size, and
// recovery comes from Rest or healing.
/**
 * @param {Partial<import('./types.js').CharacterState>} state
 * @param {{hp: number, en: number, rx: number}} before  tile-derived maxes before the change
 * @param {{hp: number, en: number, rx: number}} after   tile-derived maxes after the change
 * @returns {{changed: boolean, patch: Object<string, number>}}
 */
export function shiftResourceMaxesForTileChange(state, before, after) {
    /** @type {Object<string, number>} */
    const patch = {};
    NORMAL_RESOURCES.forEach(key => {
        const delta = toInt(after?.[key]) - toInt(before?.[key]);
        if (delta === 0) return;
        const nextBase = Math.max(0, toInt(state?.[`${key}Max`]) + delta);
        patch[`${key}Max`] = nextBase;
        const nextEffective = getEffectiveMax({ ...state, [`${key}Max`]: nextBase }, key);
        const current = toInt(state?.[key]);
        if (current > nextEffective) patch[key] = Math.max(0, nextEffective);
    });
    return { changed: Object.keys(patch).length > 0, patch };
}

/**
 * Stored base maxes that disagree with the tiles (for the rules review).
 * @param {Partial<import('./types.js').CharacterState>} state
 * @param {{hp: number, en: number, rx: number}} computed  calculateResourceMaxes(state.tiles)
 * @returns {Array<{key: NormalResourceKey, stored: number, computed: number}>}
 */
export function getResourceMaxDrift(state, computed) {
    return NORMAL_RESOURCES
        .map(key => ({ key, stored: toInt(state?.[`${key}Max`]), computed: toInt(computed?.[key]) }))
        .filter(entry => entry.stored !== entry.computed);
}

// ---------------------------------------------------------------------------
// Movement (p.35)
// ---------------------------------------------------------------------------

// "A Pace is a short move covering 3 Y/M." (p.35)
export const PACE_DISTANCE = 3;
// "To Dash, test Athletics or a similar skill vs. Difficulty 6." (p.35)
export const DASH_DIFFICULTY = 6;

function hasMechanicalBase(tile, base) {
    return activeParsedTags(tile).some(parsed => parsed.base === base && MECHANICAL_PREFIXES.has(parsed.prefix));
}

// "The Nimble tag increases Walk by ▟." (p.35; "+▟ to Walk", p.14). Like
// Tough / Vital / Quick, ▟ is the Nimble tile's own die steps, and buried
// tiles contribute nothing (p.11).
export function getNimbleWalkBonus(tiles = []) {
    return (tiles || [])
        .filter(tile => tile && !tile.isBuried && hasMechanicalBase(tile, 'nimble'))
        .reduce((sum, tile) => sum + tileSteps(tile), 0);
}

// Bulky (p.29): "while used, -3 Walk". It is a Flaw, so any prefix counts.
// Whether an item is "in use" is a table call, so the sheet lists the
// candidates and the player ticks the ones in use.
export function getBulkyTiles(tiles = []) {
    return (tiles || []).filter(tile => tile && !tile.isBuried && activeParsedTags(tile).some(parsed => parsed.base === 'bulky'));
}

/**
 * Movement distances in Y/M from the character's current state.
 *
 * - Walk: "A Walk is a typical Move, equal to current Reflex Y/M." (p.35)
 *   "Remember that current RX also sets Walk." (p.37)
 * - SLOW: "The Slow Crit tag reduces Reflex by 3." (p.35) The sheet tracks
 *   SLOW as a crit counter rather than deducting RX points, so each active
 *   SLOW lowers the Reflex used for Walk by 3 (not the pool itself).
 * - Nimble adds ▟; each Bulky item in use subtracts 3 (pp.14, 29).
 * - Run: "use both your Action and Move for 3x Walk." (p.35)
 * - Dash: "Minimum travel is 3x Walk. Assign a spare die to increase the
 *   distance traveled. e.g., a spare d6 showing a 4 gives 4 extra Walks.
 *   Take a SLOW Crit after Dashing." (p.35)
 * - Bestial: "sets their Pace equal to their Walk." (p.61)
 * - Cornered (0 Reflex): "cannot Walk, Run, or Dash. They're restricted to
 *   a Pace (3 m) each turn." (p.43) Read literally as a 3 m Pace even for
 *   Bestial characters.
 * - HOLD: "target cannot Walk or Run" (p.40). Dash is not listed, so it is
 *   left available and flagged for the GM rather than blocked.
 *
 * @param {{rx?: number|string, tiles?: import('./types.js').Tile[], activeCrits?: Object<string, number>, bulkyInUse?: number}} input
 */
export function calculateMovement({ rx, tiles = [], activeCrits = {}, bulkyInUse = 0 } = {}) {
    const currentRx = Math.max(0, toInt(rx));
    const crits = normalizeActiveCrits(activeCrits);
    const slowCount = crits.slow || 0;
    const held = (crits.hold || 0) > 0;
    const cornered = currentRx <= 0;
    const bestial = calculateBestialTileCount(tiles) > 0;
    const nimbleBonus = getNimbleWalkBonus(tiles);
    const bulkyPenalty = 3 * Math.max(0, toInt(bulkyInUse));
    const slowPenalty = 3 * slowCount;

    const effectiveRx = Math.max(0, currentRx - slowPenalty);
    const walk = cornered ? 0 : Math.max(0, effectiveRx + nimbleBonus - bulkyPenalty);
    const pace = (bestial && !cornered) ? walk : PACE_DISTANCE;

    return {
        pace,
        walk,
        run: 3 * walk,
        dashMinimum: 3 * walk,
        canWalk: !cornered && !held,
        canRun: !cornered && !held,
        canDash: !cornered,
        cornered,
        held,
        bestial,
        nimbleBonus,
        bulkyPenalty,
        slowPenalty
    };
}

// ---------------------------------------------------------------------------
// Sustain upkeep (p.50)
// ---------------------------------------------------------------------------

// "Spells can be maintained by sacrificing resources. After three turns,
// spend a resource point (EN, RX, HP) to fuel the spell." (p.50) The sample
// cards instead say "Sustain (1 Res / minute)" - an open GM question - so
// no cadence is encoded here; the sheet only tracks which spells are up
// and deducts 1 point when the player pays.
export const SUSTAIN_UPKEEP_RESOURCES = ['en', 'rx', 'hp'];

// The Spell Builder stores the Duration select's value in
// spellState['spell-duration'] ('-3' is Sustain), or a Custom entry's name.
// Tiles built by hand or by the AI may carry a "Sustain" / "Duration:
// Sustain" tag instead.
export function isSustainTile(tile) {
    if (!tile) return false;
    const spellState = tile.spellState || {};
    if (tile.isSpell) {
        const duration = String(spellState['spell-duration'] ?? '');
        if (duration === '-3') return true;
        if (duration === 'custom' && /\bsustain/i.test(String(spellState['spell-duration-custom-name'] || ''))) return true;
    }
    return tileTagList(tile).some(tag => parseTag(tag).base === 'sustain');
}

/**
 * Rows for the Sustain tracker: every unburied Sustain tile, with whether
 * the player has marked it active. Active ids for missing or buried tiles
 * are dropped from `activeIds`.
 * @param {import('./types.js').Tile[]} tiles
 * @param {unknown} activeSustains
 */
export function getSustainTracker(tiles = [], activeSustains = []) {
    const active = new Set(normalizeActiveSustains(activeSustains));
    const rows = (tiles || [])
        .filter(tile => tile && !tile.isBuried && isSustainTile(tile))
        .map(tile => ({ id: String(tile.id), name: String(tile.name || 'Unnamed spell'), active: active.has(String(tile.id)) }));
    return { rows, activeIds: rows.filter(row => row.active).map(row => row.id) };
}

/**
 * Pay 1 point of upkeep from EN, RX, or HP. Returns the new pool value, or
 * an error when the pool is empty (GM override may pay from an empty pool,
 * which leaves it at 0, matching the other spend buttons).
 * @param {Partial<import('./types.js').CharacterState>} state
 * @param {string} resource
 * @returns {{ok: true, key: NormalResourceKey, value: number} | {ok: false, reason: string}}
 */
export function paySustainUpkeep(state, resource) {
    const key = /** @type {NormalResourceKey} */ (String(resource || '').toLowerCase());
    if (!SUSTAIN_UPKEEP_RESOURCES.includes(key)) {
        return { ok: false, reason: 'Sustain upkeep is paid with EN, RX, or HP.' };
    }
    const current = Math.max(0, toInt(state?.[key]));
    if (current <= 0 && !state?.gmOverride) {
        return { ok: false, reason: `No ${key.toUpperCase()} left to pay upkeep.` };
    }
    return { ok: true, key, value: Math.max(0, current - 1) };
}
