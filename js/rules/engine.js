// @ts-check
// The PoolEngine: tag limits, XP estimates, pool compilation, rolling,
// and totals. Catalogs and per-subsystem helpers live in the sibling
// modules; this file is the orchestrator.
import { STAT_COLORS, VALID_DICE } from '../data.js';
import { parseTag, DEFAULT_HITCH_VALUE } from '../tag-model.js';
import { activeParsedTags, activeTileTagList, isGearTagsBroken, MECHANICAL_PREFIXES, tileHasParsedBase } from './tags.js';
import {
    ADVANCEABLE_STATS,
    COLOR_RESOURCE,
    DIE_STEPS,
    NORMAL_RESOURCE_KEYS,
    RESOURCE_TAGS,
    getDiceValidationMessage
} from './shared.js';
import {
    ARCANE_DETAIL_TAGS,
    ARCANE_SACRIFICE_COSTS,
    CALL_COST_FLAWS,
    CALL_COST_PREFIXES,
    CRIT_SHIELD_XP,
    EXOTIC_TAGS,
    FLAW_TAGS,
    FLAW_XP,
    RANGE_DURATION_XP,
    TAG_XP_CATALOG,
    getArcaneSacrificeKey,
    getCrowdXp,
    getDuplicateKey,
    isCrowdTag,
    isHitchedTile,
    isThrowDetailTag,
    WITCH_SACRIFICE_KEY
} from './xp.js';
import { ARMOR_COVERAGE_XP, ARMOR_DETAIL_TAGS, ARMOR_MATERIAL_XP, getWeaponTemplateById } from './equipment.js';
import {
    applyAberrantDieStepEffects,
    getAberrantDieStepNet,
    getTileBoxes,
    serializeTileBoxes,
    tileMatchesCallColor,
    validateShadowUseForCheck
} from './shadow.js';
import { getExoticSkillBaseXp, normalizeSpecialIdentity, tileHasTitanTag } from './exotic.js';

// "+▟" Detail tags and what they improve, from the Build and Detail tags
// glossary (p.78) and the equipment Detail tag tables (pp.29-31).
const CONTEXTUAL_TAG_BONUSES = {
    expert: { name: 'Expert', context: 'action check', description: '+▟ to action checks using this tile' },
    keen: { name: 'Keen', context: 'attack', description: '+▟ to attacks using this tile' },
    sharp: { name: 'Sharp', context: 'damage / impact', description: '+▟ to damage or impact' },
    agile: { name: 'Agile', context: 'evasion', description: '+▟ to evasion' },
    hidden: { name: 'Hidden', context: 'vs detection', description: '+▟ against detection' },
    ironclad: { name: 'Ironclad', context: 'soak', description: '+▟ to soak' },
    rugged: { name: 'Rugged', context: 'grit', description: '+▟ to grit' }
};

// Cyber Build/Detail tags that only work on tiles of listed colors (p.64,
// printed as color swatches: "Unborn (Green Yellow Orange tiles)", "Zenith
// (Orange Red Purple tiles)"). Read literally, the tag's effect applies to
// the tile carrying it when that tile has one of the listed colors; Qi/Id
// boxes match any color, as they do for a Call.
const CYBER_TAG_COLORS = {
    unborn: ['Green', 'Yellow', 'Orange'],
    zenith: ['Orange', 'Red', 'Purple']
};

/**
 * True when the tile carries the color-gated Cyber tag (Unborn / Zenith)
 * and has one of that tag's listed colors (p.64).
 * @param {any} tile
 * @param {'unborn'|'zenith'} baseTag
 */
export function tileHasActiveColorGatedTag(tile, baseTag) {
    const hasTag = activeParsedTags(tile)
        .some(parsed => parsed.base === baseTag && MECHANICAL_PREFIXES.has(parsed.prefix));
    if (!hasTag) return false;
    return CYBER_TAG_COLORS[baseTag].some(color => tileMatchesCallColor(tile, color));
}

// FEAR (p.40): "target's pools lose a die". The text does not say which
// die, so the pool loses its lowest die (by ▟) - the die the character
// would give up anyway. A Freebie die is only dropped when every die is a
// Freebie, since it was paid for. Among equals, the last one goes.
/** @param {Array<{source: string, die: string}>} pool */
function getFearDropIndex(pool) {
    let dropIndex = -1;
    pool.forEach((entry, index) => {
        if (dropIndex < 0) {
            dropIndex = index;
            return;
        }
        const current = pool[dropIndex];
        const entryIsFreebie = entry.source === 'Freebie';
        const currentIsFreebie = current.source === 'Freebie';
        if (entryIsFreebie !== currentIsFreebie) {
            if (currentIsFreebie) dropIndex = index;
            return;
        }
        if ((DIE_STEPS[entry.die] ?? 0) <= (DIE_STEPS[current.die] ?? 0)) dropIndex = index;
    });
    return dropIndex;
}

function getArcaneSacrificeCostTags(tile) {
    if (isGearTagsBroken(tile)) return [];
    const tags = activeTileTagList(tile);
    Object.entries(tile?.spellState || {}).forEach(([key, value]) => {
        if (!key.startsWith('spell-mod-val-')) return;
        if ((parseInt(value, 10) || 0) <= 0) return;
        tags.push(key.replace('spell-mod-val-', ''));
    });
    return tags;
}

export class PoolEngine {
    constructor() {
        this.baseKeeps = 2;
    }

    calculateSteps(diceArray) {
        return diceArray.reduce((steps, die) => steps + (DIE_STEPS[die] || 0), 0);
    }

    classifyTagForLimit(tag) {
        const parsed = parseTag(tag);
        const name = parsed.raw;
        const baseTag = parsed.base;
        const bodyLower = parsed.body.toLowerCase();

        if (!parsed.name && !parsed.exempt) {
            return { name, counts: false, reason: 'blank' };
        }

        if (parsed.prefix === 'build') {
            return { name, counts: true, reason: 'Build tags count' };
        }

        if (ARCANE_DETAIL_TAGS.has(baseTag)) {
            return { name, counts: true, reason: 'Arcane Detail tags count' };
        }

        if (baseTag === 'world') {
            return { name, counts: false, reason: 'World tags do not count' };
        }

        if (baseTag === 'spell') {
            return { name, counts: false, reason: 'Spell marker does not count' };
        }

        if (parsed.prefix === 'range' || parsed.prefix === 'duration'
            || (RANGE_DURATION_XP.has(baseTag) && !isThrowDetailTag(parsed)) || isCrowdTag(parsed)) {
            return { name, counts: false, reason: 'Range/Duration tags do not count' };
        }

        if (bodyLower.includes('flaw') || FLAW_TAGS.has(baseTag)) {
            return { name, counts: false, reason: 'Flaw tags do not count' };
        }

        if (parsed.exempt || bodyLower.includes('exempt')) {
            return { name, counts: false, reason: 'GM Exception' };
        }

        if (bodyLower.includes('exotic') || EXOTIC_TAGS.has(baseTag)) {
            return { name, counts: false, reason: 'Exotic tags do not count' };
        }

        return { name, counts: true, reason: 'Counts against tag limit' };
    }

    calculateTagLimit(diceArray, tagsArray = [], { specialIdentity = null, isSpell = false } = {}) {
        // "a tile can only have 1 tag per ▟. Flaw, Range, or Duration tags
        // don't count." (p.33) - classifyTagForLimit handles the exemptions.
        const limit = this.calculateSteps(diceArray);
        // Titan Identity tiles "can gain any number of Build, Shield, or
        // Detail tags" (p.69) - only Crit tags still count for them.
        const isTitanIdentity = normalizeSpecialIdentity(specialIdentity) === 'titan-identity';
        const isCritSide = (tag) => {
            const parsed = parseTag(tag);
            if (parsed.prefix === 'shield') return false;
            return parsed.prefix === 'crit' || CRIT_SHIELD_XP.has(parsed.base);
        };
        const details = tagsArray.map(tag => {
            const detail = this.classifyTagForLimit(tag);
            if (isTitanIdentity && detail.counts && !isCritSide(tag)) {
                return { ...detail, counts: false, reason: 'Titan Identity: Build/Shield/Detail tags do not count' };
            }
            // "Each spell tile gains the Chain tag" (p.49) - granted, not
            // bought, so it does not count against the spell's tag limit
            // (sample spells like captivate are d4 with Chain + a Crit).
            if (isSpell && detail.counts && parseTag(tag).base === 'chain') {
                return { ...detail, counts: false, reason: 'A spell’s Chain tag is granted and does not count' };
            }
            return detail;
        });
        const countableTags = details.filter(tag => tag.counts);
        const exemptTags = details.filter(tag => !tag.counts && tag.reason !== 'blank');
        const count = countableTags.length;

        return {
            limit,
            count,
            overage: Math.max(0, count - limit),
            valid: count <= limit,
            countableTags,
            exemptTags,
            details
        };
    }

    parseDiceString(str) {
        if (!str) return [];
        return str
            .split(',')
            .map(s => s.trim().toLowerCase())
            .filter(die => VALID_DICE.has(die));
    }

    /**
     * The dice a stat rolls. "Your character starts with a d3 in each stat"
     * (p.6), and the first advance turns that d3 into a d4 ("It is now a
     * d4"), so a blank stat rolls a d3 and a d3 left beside bought dice is
     * dropped.
     * @param {string} str
     */
    getStatDice(str) {
        const dice = this.parseDiceString(str);
        const bought = dice.filter(die => die !== 'd3');
        return bought.length > 0 ? bought : ['d3'];
    }

    /**
     * XP cascade ("System Concept-Dice" chart, p.6). Each character starts
     * with a free d3 in every stat. Past d3, each advance costs:
     *
     *     XP = {steps on the advanced die} + {count of other dice already on
     *          this stat or tile}
     *
     * Worked example (2x d6):
     *   - Add 1st d4:           1 + 0 = 1
     *   - Promote d4 -> d6:     2 + 0 = 2   (subtotal 3 for the first d6)
     *   - Add 2nd d4:           1 + 1 = 2
     *   - Promote that d4 -> d6: 2 + 1 = 3   (subtotal 5 for the second d6)
     *   - Total: 8
     *
     * d3s are skipped (free) and do NOT contribute to {count of other dice}.
     * The optimal path always promotes the highest-rank die first; we sort
     * descending so the cheaper dice pay the higher "other dice" surcharge.
     *
     * Used for both stat XP (ui/stats.js updateXpTracker) and tile XP
     * (estimateTileXp). One formula, one source of truth.
     */
    calculateOptimalXpCost(diceArray) {
        const sortedDice = [...diceArray].sort((a,b) => (DIE_STEPS[b] || 0) - (DIE_STEPS[a] || 0));

        let totalXp = 0;
        let existingDiceCount = 0;

        for (const die of sortedDice) {
            const targetSteps = DIE_STEPS[die] || 0;
            if (targetSteps === 0) continue;

            // Add a d4
            totalXp += 1 + existingDiceCount;

            // Upgrade it to its target rank
            for (let s = 2; s <= targetSteps; s++) {
                totalXp += s + existingDiceCount;
            }

            existingDiceCount++;
        }
        return totalXp;
    }

    /**
     * Categorize a tag string for XP scoring. Returns:
     *   - `xp`: the XP modifier this tag contributes (positive or negative)
     *   - `recognized`: true when the tag matched a known category, false when
     *     it fell through to the default. Callers that surface unknown tags
     *     to the user (e.g. modals.js Auto-Estimate button) use this flag to
     *     warn that a typo cost the player the default +2 XP.
     *
     * "Recognized but defaulted" tags - structural prefixes like `Build:`,
     * `Detail:`, `Crit:`, `Shield:`, `Range:`, `Duration:`, plus exotic tags -
     * are valid rulebook categories whose specific XP costs aren't fully
     * tabulated here. They still get the default +2 XP, but they are NOT
     * flagged as unknown so the UI doesn't bother the player about them.
     */
    classifyTagForXp(tag) {
        const parsed = parseTag(tag);
        const baseTag = parsed.base;

        if (!parsed.name) return { xp: 0, recognized: true, category: 'blank' };
        // World Build tag (p.63): "A tile with the 3 XP World Build tag chains
        // your Homeworld tile."
        if (baseTag === 'world') return { xp: 3, recognized: true, category: 'world' };
        // The SpellBuilder's "Spell" marker tag: not a bought tag, 0 XP.
        if (baseTag === 'spell') return { xp: 0, recognized: true, category: 'marker' };
        if (baseTag === 'hitch') {
            const value = parsed.args.value ?? DEFAULT_HITCH_VALUE;
            return { xp: -value, recognized: true, category: 'flaw', hardArmorFlawEligible: false };
        }
        if (FLAW_XP.has(baseTag)) {
            return {
                xp: FLAW_XP.get(baseTag) ?? 0,
                recognized: true,
                category: 'flaw',
                // "Flaw tags on Hard armors rebate 1 more" (p.79) - every
                // flaw, X-type included (the p.66 titanium chassis prices
                // Stigma at -5). Hitch is a Story/Trait Build tag, not armor.
                hardArmorFlawEligible: baseTag !== 'hitch'
            };
        }
        if (RANGE_DURATION_XP.has(baseTag) && !isThrowDetailTag(parsed)) {
            return { xp: RANGE_DURATION_XP.get(baseTag) ?? 0, recognized: true, category: 'rangeDuration' };
        }
        if (isCrowdTag(parsed)) {
            return { xp: getCrowdXp(parsed.args.count ?? 0), recognized: true, category: 'rangeDuration' };
        }
        if (parsed.prefix === 'range' || parsed.prefix === 'duration') {
            return { xp: 2, recognized: true, category: 'rangeDuration' };
        }
        if (parsed.prefix === 'crit' || parsed.prefix === 'shield' || CRIT_SHIELD_XP.has(baseTag)) {
            return {
                xp: CRIT_SHIELD_XP.get(baseTag) ?? 2,
                recognized: true,
                category: parsed.prefix === 'shield' ? 'shield' : 'crit',
                hardArmorDiscountable: parsed.prefix === 'shield'
            };
        }
        if (TAG_XP_CATALOG.has(baseTag)) {
            return {
                xp: TAG_XP_CATALOG.get(baseTag) ?? 2,
                recognized: true,
                category: EXOTIC_TAGS.has(baseTag) ? 'exotic' : 'tag',
                hardArmorDiscountable: ARMOR_DETAIL_TAGS.has(baseTag) || parsed.prefix === 'detail'
            };
        }
        if (parsed.prefix === 'build' || parsed.prefix === 'detail') {
            return {
                xp: 2,
                recognized: true,
                category: parsed.prefix,
                hardArmorDiscountable: parsed.prefix === 'detail'
            };
        }

        return { xp: 2, recognized: false, category: 'unknown' };
    }

    /**
     * Detailed tile XP estimate. Same total as estimateTileXp(), but also
     * returns the list of unrecognized tags so the UI can warn the player
     * that a typo silently cost them XP. Use this in interactive contexts
     * (e.g. the "Auto-Estimate" button); use estimateTileXp when you only
     * need the number.
     *
     * @returns {{ xp: number, unknownTags: string[] }}
     */
    /**
     * @param {string[]} diceArray
     * @param {Array<string|{name: string}>} tagsArray
     * @param {{material: string, coverage: string}|null} [armorType]
     * @param {Object} [options]
     */
    estimateTileXpDetails(diceArray, tagsArray, armorType = null, options = {}) {
        let xp = this.calculateOptimalXpCost(diceArray);
        const isHardArmor = armorType != null && armorType.material === 'Hard';
        // Titan Identity (p.69): Build, Shield, and Detail tags cost -1 XP.
        const isTitanIdentity = normalizeSpecialIdentity(options.specialIdentity) === 'titan-identity';
        const TITAN_IDENTITY_CATEGORIES = new Set(['build', 'detail', 'shield', 'tag']);
        const unknownTags = [];
        const seenTags = new Map();
        let refundXp = 0;

        const exoticSpecialty = (options.exoticSkill?.specialty || '').toLowerCase();

        // Unborn (p.64): "(Green Yellow Orange tiles) Tile advances for 1 XP
        // less on dice and any tag of 3 XP or higher." Every die advance
        // (each new d4 and each promotion, p.6) costs at least 1 XP, so the
        // dice discount is 1 XP per ▟. Tags are judged by their price on
        // this tile after the other modifiers; the Unborn tag itself is the
        // purchase that grants the discount, so it pays full price.
        const isUnborn = tileHasActiveColorGatedTag({
            tags: tagsArray,
            boxes: options.boxes,
            specialIdentity: options.specialIdentity
        }, 'unborn');
        if (isUnborn) xp -= this.calculateSteps(diceArray);

        tagsArray.forEach(tag => {
            const parsed = parseTag(tag);
            const tagRule = this.classifyTagForXp(tag);
            let tagXp = tagRule.xp;

            // Bestial / Celestial are 2 XP on Skill tiles but 4 XP when added
            // to a Trait, Story, or Gear tile (glossary "X 2/4", pp.61-63).
            const baseTag = parsed.base;
            if (options.tileType && options.tileType !== 'Skill' && (baseTag === 'bestial' || baseTag === 'celestial')) {
                tagXp += 2;
            }

            const duplicateKey = getDuplicateKey(tag);
            const previousCopies = seenTags.get(duplicateKey) || 0;
            seenTags.set(duplicateKey, previousCopies + 1);
            if (duplicateKey) tagXp += previousCopies * 2;

            // Exotic skill tiles "start with the Bestial/Celestial/Cyber
            // Exotic tag" (pp.61-64): the skill's own exotic tag is covered
            // by its +2 base XP, so its first copy is free here.
            if (exoticSpecialty && baseTag === exoticSpecialty && previousCopies === 0) {
                tagXp = 0;
            }

            if (isHardArmor && tagRule.hardArmorFlawEligible) {
                tagXp -= 1;
            }
            if (isHardArmor && tagRule.hardArmorDiscountable && tagXp > 0) {
                tagXp -= 1;
            }
            if (isTitanIdentity && TITAN_IDENTITY_CATEGORIES.has(tagRule.category) && tagXp > 0) {
                tagXp -= 1;
            }
            if (isUnborn && baseTag !== 'unborn' && tagXp >= 3) {
                tagXp -= 1;
            }

            // Flaw and Hitch refunds are XP handed back to the sheet
            // ("Hitched tiles do not have to be the tiles the XP is spent
            // on", p.20), so they are kept out of the per-tile 0 floor.
            if (tagRule.category === 'flaw' && tagXp < 0) {
                refundXp += tagXp;
            } else {
                xp += tagXp;
            }
            if (!tagRule.recognized && parsed.name) unknownTags.push(parsed.raw);
        });

        // Armor base cost: material + coverage.
        if (armorType) {
            xp += (ARMOR_MATERIAL_XP[armorType.material] || 0) + (ARMOR_COVERAGE_XP[armorType.coverage] || 0);
        }

        // Hinders have a rebate of 3 XP (p.41).
        if (options.gearSubtype === 'Hinder') {
            xp -= 3;
        }

        // Gizmo (p.68): the tag is 4 XP chained to a skill; "If it does not
        // Chain a skill, Gizmo only costs 2 XP."
        const allBaseTags = tagsArray.map(tag => parseTag(tag).base);
        if (allBaseTags.includes('gizmo') && !allBaseTags.includes('chain')) {
            xp -= 2;
        }

        const weapon = options.weapon || null;
        const weaponTemplate = weapon?.templateId
            ? getWeaponTemplateById(options.weapon.templateId)
            : null;
        if (weaponTemplate?.extraXp) {
            xp += weaponTemplate.extraXp;
        } else if (String(weapon?.category || '').trim().toLowerCase() === 'far') {
            xp += 2;
        } else if (String(weapon?.range || '').trim().toLowerCase() === 'close') {
            xp += 1;
        }

        xp += getExoticSkillBaseXp(options.exoticSkill);
        xp += serializeTileBoxes(options.boxes || [], 3)
            .filter(box => box.type === 'shadow')
            .length * 2;

        return { xp: Math.max(0, xp) + refundXp, unknownTags };
    }

    estimateTileXp(diceArray, tagsArray, armorType = null, options = {}) {
        return this.estimateTileXpDetails(diceArray, tagsArray, armorType, options).xp;
    }

    // Resource maxes: each red/orange box adds 1 Health, green/yellow 1
    // Energy, blue/purple 1 Reflex (p.11). A Qi or Id box adds 1 point to
    // a chosen normal resource and 1 to the Shadow pool (p.58). Tough /
    // Vital / Quick add the tile's ▟ (pp.29/78); Bestial adds +1 (p.61).
    calculateResourceMaxes(tiles = []) {
        const maxes = { hp: 0, en: 0, rx: 0, sh: 0 };

        tiles.forEach(tile => {
            if (tile.isBuried) return;
            if (tile.gearSubtype === 'Ammo') return;
            getTileBoxes(tile).forEach(box => {
                if (box.type === 'color') {
                    const resource = COLOR_RESOURCE[box.color];
                    if (resource) maxes[resource] += 1;
                } else if (box.type === 'shadow') {
                    if (NORMAL_RESOURCE_KEYS.includes(box.resource)) maxes[box.resource] += 1;
                    maxes.sh += 1;
                }
            });

            const tileSteps = this.calculateSteps(tile.dice || []);
            activeParsedTags(tile).forEach(parsed => {
                if (MECHANICAL_PREFIXES.has(parsed.prefix)) {
                    const resource = RESOURCE_TAGS[parsed.base];
                    if (resource) maxes[resource] += tileSteps;
                }

                // Bestial (p.61): "For each tile with the Bestial tag, add an
                // extra point to one Resource." The chosen pool is fixed when
                // bought, stored on the tag as "Bestial: HP|EN|RX". Untyped
                // Bestial tags grant nothing until a resource is chosen (the
                // rules review flags them).
                if (parsed.base === 'bestial' && parsed.args.resource) {
                    maxes[parsed.args.resource] += 1;
                }
            });
        });

        return maxes;
    }

    calculateShadowMax(statsOrTiles, maybeTiles) {
        const tiles = Array.isArray(statsOrTiles) ? statsOrTiles : (maybeTiles || []);
        return this.calculateResourceMaxes(tiles).sh;
    }

    calculateStatXp(stats = {}) {
        return ADVANCEABLE_STATS.reduce((sum, stat) => {
            return sum + this.calculateOptimalXpCost(this.parseDiceString(stats[stat] || ''));
        }, 0);
    }

    getUnavailableReason(tile) {
        if (tile?.isBuried) return 'buried';
        if (tile?.isBurnt) return 'burnt';
        if (tile?.gearSubtype === 'Ammo') return 'ammo';
        return null;
    }

    /**
     * Compiles the dice pool based on selected colors and tiles.
     * @param {Array<string>} callColors 
     * @param {Object} stats 
     * @param {Object} callTile 
     * @param {Array<Object>} burnTiles 
     * @param {Array<Object>} allTiles 
     * @param {Array<string>} extraDice
     * @param {Object} options
     * @returns {Object} { dice: Array, adds: number, flatBonus: number, tagBonuses: Array, chainOptions: Array, error: string }
     */
    compilePool(callColors, stats, callTile, burnTiles, allTiles, extraDice = [], options = {}) {
        let pool = [];
        let adds = 2; // Base keep is 2: "add any two of the dice" (p.23).
        let flatBonus = 0;
        let tagBonuses = [];
        let chainOptions = [];
        let resourceCosts = [];
        let calledTileIds = [];
        /** @type {import('../types.js').BurnRequirement[]} */
        let burnRequirements = [];
        let error = null;
        const activeCallColors = [...new Set(callColors.filter(Boolean))];
        const disabledChainIds = options.disabledChainIds || new Set();
        const chainColorSelections = options.chainColorSelections || {};
        const aberrantEffects = options.aberrantEffects || {};
        const hitchCallTiles = options.hitchCallTiles || [];
        const usedTiles = [];
        const calledTiles = [];
        const dieStepEffects = [];
        const buildResult = (overrides = {}) => ({
            dice: pool,
            adds,
            flatBonus,
            tagBonuses,
            chainOptions,
            resourceCosts,
            calledTileIds,
            burnRequirements,
            burnRequirementMet: (burnTiles || []).length > 0,
            fearDrop: null,
            shadowUse: null,
            dieStepEffects,
            haywireThreshold: 1,
            freebieDie: null,
            titanActive: false,
            zenithActive: false,
            error: null,
            ...overrides
        });
        const isChainDisabled = (chainId) => {
            if (disabledChainIds instanceof Set) return disabledChainIds.has(chainId);
            if (Array.isArray(disabledChainIds)) return disabledChainIds.includes(chainId);
            return false;
        };
        const getSelectedChainColor = (chainId) => {
            if (chainColorSelections instanceof Map) return chainColorSelections.get(chainId) || '';
            return chainColorSelections[chainId] || '';
        };

        if (activeCallColors.length === 0) {
            return buildResult({ error: "Select at least 1 color for the Call." });
        }

        const getSharedCallColors = (...tiles) => {
            if (tiles.some(tile => !tile)) return [];

            return activeCallColors.filter(color =>
                tiles.every(tile => tileMatchesCallColor(tile, color))
            );
        };
        // A burn selection can narrow a multi-color Call to one color. That
        // sole color also resolves ambiguous Chain links automatically.
        const sharedPoolTileColors = callTile
            ? getSharedCallColors(callTile, ...(burnTiles || []))
            : [];
        const narrowedChainColor = sharedPoolTileColors.length === 1
            ? sharedPoolTileColors[0]
            : '';

        // 1. Add Stat Dice matching the Call Colors ("Each stat of matching
        // color contributes its dice", p.23).
        activeCallColors.forEach(color => {
            if (!color) return;
            // Find stats matching this color
            for (const [stat, statColor] of Object.entries(STAT_COLORS)) {
                if (statColor === color) {
                    this.getStatDice(stats[stat]).forEach(die => {
                        pool.push({ source: `Stat (${stat})`, die });
                    });
                }
            }
        });

        // Recursive resolution for call tiles and chains
        /**
         * @param {any} tile
         * @param {boolean} isCallTile
         * @param {Set<string>} visitedIds
         * @param {string} [chainColor]
         * @param {{rootName: string, limit: number, count: number}|null} [chainTracker]
         */
        const resolveTile = (tile, isCallTile, visitedIds, chainColor = '', chainTracker = null) => {
            if (!tile || visitedIds.has(tile.id)) return;
            visitedIds.add(tile.id);

            // Chain length limit (p.25): "The chain cannot call more tiles
            // than the ▟ of the Chained tile." The tracker is rooted at the
            // called tile bearing the Chain tag; every tile pulled in through
            // chain links counts against the root's die steps.
            if (isCallTile) {
                chainTracker = {
                    rootName: tile.name,
                    limit: this.calculateSteps(tile.dice || []),
                    count: 0
                };
            } else if (chainTracker) {
                chainTracker.count += 1;
                if (chainTracker.count > chainTracker.limit) {
                    error = `Chain from '${chainTracker.rootName}' calls ${chainTracker.count} tiles, but its ${chainTracker.limit}▟ allows at most ${chainTracker.limit}.`;
                    return;
                }
            }

            const unavailableReason = this.getUnavailableReason(tile);
            if (unavailableReason) {
                error = `Tile '${tile.name}' is ${unavailableReason} and cannot be called.`;
                return;
            }
            
            // Color check (p.23): the called tile must match at least one of
            // the call colors (it does not have to match both).
            const matchesCall = activeCallColors.some(c => tileMatchesCallColor(tile, c));
            if (!matchesCall) {
                if (isCallTile) {
                    error = `Call Tile '${tile.name}' does not match any Call Colors.`;
                } else {
                    error = `Chained Tile '${tile.name}' does not match any Call Colors.`;
                }
                return;
            }

            calledTileIds.push(tile.id);
            usedTiles.push(tile);
            calledTiles.push(tile);
            if (isHitchedTile(tile)) {
                resourceCosts.push({
                    resource: 'en',
                    amount: 1,
                    sourceTileId: tile.id,
                    sourceTileName: tile.name,
                    reason: 'Hitch'
                });
            }
            // Heavy / Fluid / Hungry charge their resource on every call,
            // including a call through a Chain. Broken gear tags are
            // inactive (activeParsedTags), so they cost nothing.
            activeParsedTags(tile).forEach(parsed => {
                const callCost = CALL_COST_FLAWS[parsed.base];
                if (!callCost || !CALL_COST_PREFIXES.has(parsed.prefix)) return;
                resourceCosts.push({
                    resource: callCost.resource,
                    amount: 1,
                    sourceTileId: tile.id,
                    sourceTileName: tile.name,
                    reason: callCost.reason
                });
            });
            getArcaneSacrificeCostTags(tile).forEach(tag => {
                const sacrificeKey = getArcaneSacrificeKey(tag);
                // Witch (p.48): "Mote or burn to cast." A mote is not a
                // tracked resource (the only mote in the book is the
                // "flame mote" Ammo tile, "For spell pool", p.72), so the
                // requirement is reported; a burn in this check meets it.
                if (sacrificeKey === WITCH_SACRIFICE_KEY) {
                    burnRequirements.push({
                        reason: 'Witch',
                        sourceTileId: tile.id,
                        sourceTileName: tile.name,
                        message: `Witch (${tile.name}): mote or burn to cast - burn a tile or spend a mote.`
                    });
                    return;
                }
                const sacrificeCost = ARCANE_SACRIFICE_COSTS[sacrificeKey];
                if (!sacrificeCost) return;
                resourceCosts.push({
                    resource: sacrificeCost.resource,
                    amount: 1,
                    sourceTileId: tile.id,
                    sourceTileName: tile.name,
                    reason: sacrificeCost.reason
                });
            });

            // Add tile dice. Chained tiles are labeled separately so the
            // resolution panel can price maxed chain dice (1 resource each).
            tile.dice.forEach(d => pool.push({ source: `${isCallTile ? 'Tile' : 'Chain'} (${tile.name})`, die: d }));

            // "The Chain tag also grants an extra Add." (p.25)
            if (!isCallTile) adds += 1;

            // Parse tags
            const tags = activeParsedTags(tile);

            // Contextual tag bonuses are surfaced for user selection.
            tags.forEach((parsed, index) => {
                if (!MECHANICAL_PREFIXES.has(parsed.prefix)) return;
                let bonusRule = CONTEXTUAL_TAG_BONUSES[parsed.base];

                // Motorized: "+steps on [stat]". The chosen stat is stored as "Motorized: STAT".
                if (!bonusRule && parsed.base === 'motorized') {
                    const stat = parsed.args.stat || '';
                    bonusRule = {
                        name: stat ? `Motorized (${stat})` : 'Motorized',
                        context: stat ? `${stat} check` : 'stat check',
                        description: `+▟ on ${stat || 'a chosen stat'} checks using this tile`
                    };
                }

                if (!bonusRule) return;

                const steps = this.calculateSteps(tile.dice);
                if (steps <= 0) return;

                tagBonuses.push({
                    id: `${tile.id}:${parsed.base}:${index}`,
                    tag: bonusRule.name,
                    sourceTileId: tile.id,
                    sourceTileName: tile.name,
                    steps,
                    context: bonusRule.context,
                    description: bonusRule.description
                });
            });

            // Chain tags. Only unprefixed links are followed: a
            // "Build: Chain X" tag prices as a Chain but is not walked.
            for (let index = 0; index < tags.length; index++) {
                const parsed = tags[index];
                if (parsed.prefix !== null) continue;
                const target = parsed.args.target || '';
                const isChainTag = parsed.base === 'chain' && target !== '';
                const isWorldTag = parsed.base === 'world' && target !== '';
                if (isChainTag || isWorldTag) {
                    const linkKind = isWorldTag ? 'world' : 'chain';
                    const linkLabel = isWorldTag ? 'World' : 'Chain';
                    const targetName = target;
                    const targetKey = target.toLowerCase();
                    const chainId = `${tile.id}:${linkKind}:${index}:${targetKey}`;
                    const targetTile = allTiles.find(t => (t.name || '').toLowerCase() === targetKey);
                    const disabled = isChainDisabled(chainId);
                    const sharedColors = targetTile ? getSharedCallColors(tile, targetTile) : [];
                    const selectedColor = getSelectedChainColor(chainId);
                    const automaticColor = sharedColors.includes(narrowedChainColor) ? narrowedChainColor : '';
                    const chainOption = {
                        id: chainId,
                        type: linkKind,
                        sourceTileId: tile.id,
                        sourceTileName: tile.name,
                        targetTileId: targetTile?.id || null,
                        targetTileName: targetTile?.name || targetName,
                        targetFound: Boolean(targetTile),
                        availableColors: sharedColors,
                        selectedColor: chainColor || automaticColor || selectedColor || (sharedColors.length === 1 ? sharedColors[0] : ''),
                        inheritedColor: chainColor,
                        requiresColorChoice: !chainColor && !automaticColor && sharedColors.length > 1,
                        enabled: !disabled,
                        status: disabled ? 'suppressed' : 'active'
                    };
                    chainOptions.push(chainOption);

                    if (disabled) continue;

                    if (!targetTile) {
                        chainOption.status = 'missing';
                        error = `${linkLabel} target '${targetName}' was not found.`;
                        return;
                    }

                    const chainUnavailableReason = this.getUnavailableReason(targetTile);
                    if (chainUnavailableReason) {
                        chainOption.status = 'blocked';
                        error = `${linkLabel} target '${targetTile.name}' is ${chainUnavailableReason} and cannot be called.`;
                        return;
                    }

                    if (sharedColors.length === 0) {
                        chainOption.status = 'blocked';
                        error = `${linkLabel} from '${tile.name}' to '${targetTile.name}' must share one selected Call color.`;
                        return;
                    }

                    if (chainColor && !sharedColors.includes(chainColor)) {
                        chainOption.status = 'blocked';
                        error = `${linkLabel} from '${tile.name}' to '${targetTile.name}' cannot continue on ${chainColor}.`;
                        return;
                    }

                    let nextChainColor = chainColor;
                    if (!nextChainColor) {
                        if (sharedColors.length === 1) {
                            nextChainColor = sharedColors[0];
                            chainOption.selectedColor = nextChainColor;
                        } else if (automaticColor) {
                            nextChainColor = automaticColor;
                            chainOption.selectedColor = nextChainColor;
                        } else if (selectedColor && sharedColors.includes(selectedColor)) {
                            nextChainColor = selectedColor;
                            chainOption.selectedColor = nextChainColor;
                        } else {
                            chainOption.status = 'needs-color';
                            error = `${linkLabel} from '${tile.name}' to '${targetTile.name}' can chain on ${sharedColors.join(' or ')}. Choose one chain color.`;
                            return;
                        }
                    }

                    resolveTile(targetTile, false, visitedIds, nextChainColor, chainTracker);
                    if (error) return;
                }
            }
        };

        // 2. Validate and Add Call Tile (with chains)
        if (callTile) {
            resolveTile(callTile, true, new Set());
            if (error) return buildResult({ error });
        }

        // 3. Validate and Add additional called Hitch tiles. These are called,
        // not burned: they cost Hitch EN and add dice, but grant no +1 Add.
        if (hitchCallTiles && hitchCallTiles.length > 0) {
            if (!callTile) {
                return buildResult({ error: "Select a Call Tile before adding Hitched called tiles." });
            }

            const invalidHitchTile = hitchCallTiles.find(tile => !isHitchedTile(tile));
            if (invalidHitchTile) {
                return buildResult({ error: `Tile '${invalidHitchTile.name}' is not Hitched and must be burned for an extra Add.` });
            }

            for (const hitchTile of hitchCallTiles) {
                resolveTile(hitchTile, true, new Set());
                if (error) return buildResult({ error });
            }
        }

        // 4. Validate and Add Burn Tiles (p.24): each burned tile adds its
        // dice plus a bonus Add, and all burns must share one selected color
        // with the call. Burn tiles do NOT trigger tags. Hitched tiles
        // cannot be burned (p.20).
        if (burnTiles && burnTiles.length > 0) {
            if (!callTile) {
                return buildResult({ error: "Select a Call Tile before adding Burn tiles." });
            }

            const burnError = this.getBurnTilesError(activeCallColors, callTile, burnTiles);
            if (burnError) return buildResult({ error: burnError });

            burnTiles.forEach(bt => {
                bt.dice.forEach(d => pool.push({ source: `Burn (${bt.name})`, die: d }));
                usedTiles.push(bt);
                adds += 1;
            });
        }

        const shadowUse = validateShadowUseForCheck(usedTiles);
        if (!shadowUse.valid) return buildResult({ error: shadowUse.error, shadowUse: shadowUse.kind });

        // 5. Validate and Add Extra Dice
        if (extraDice && extraDice.length > 0) {
            extraDice.forEach(d => pool.push({ source: `Extra`, die: d }));
        }

        // 6. Freebie die (p.25): once per test, spend Energy equal to the
        // die's ▟ to add a die that duplicates one already in the pool.
        const freebieDie = options.freebieDie || null;
        if (freebieDie) {
            if (!VALID_DICE.has(freebieDie)) {
                return buildResult({ error: getDiceValidationMessage('Freebie die') });
            }
            if (!pool.some(entry => entry.die === freebieDie)) {
                return buildResult({ error: `Freebie die must duplicate a die already in the pool; there is no ${freebieDie} to copy.` });
            }
            pool.push({ source: 'Freebie', die: freebieDie });
            const freebieCost = DIE_STEPS[freebieDie] || 0;
            if (freebieCost > 0) {
                resourceCosts.push({
                    resource: 'en',
                    amount: freebieCost,
                    sourceTileId: null,
                    sourceTileName: `Freebie ${freebieDie}`,
                    reason: 'Freebie'
                });
            }
        }

        // Glitch flaw (p.65): haywire counts 1s and 2s when any tile in the
        // pool carries it.
        const haywireThreshold = usedTiles.some(tile => tileHasParsedBase(tile, 'glitch')) ? 2 : 1;

        // Titan (p.69): when a Titan tile is used, dice rolling below their
        // own ▟ are rerolled, and Titan spends can maximize any pool die.
        const titanActive = usedTiles.some(tile => tileHasTitanTag(tile));

        // Zenith (p.64): "One reroll dice on dice in the pool below ▟" from a
        // called Orange/Red/Purple tile. Burned tiles do not trigger tags.
        const zenithActive = calledTiles.some(tile => tileHasActiveColorGatedTag(tile, 'zenith'));

        // GOAD (p.40): "target must burn for actions". Reported as a burn
        // requirement (a warning, not a block): a defense is not an action,
        // and a Call can still burn after rolling (p.24).
        if (options.goad) {
            burnRequirements.push({
                reason: 'GOAD',
                sourceTileId: null,
                sourceTileName: 'GOAD',
                message: 'GOAD: you must burn for actions.'
            });
        }

        const netDieStep = getAberrantDieStepNet(aberrantEffects);
        if (netDieStep !== 0) {
            pool = pool.map(dieEntry => {
                const adjustedDie = applyAberrantDieStepEffects(dieEntry.die, aberrantEffects);
                if (adjustedDie !== dieEntry.die) {
                    dieStepEffects.push({
                        source: dieEntry.source,
                        from: dieEntry.die,
                        to: adjustedDie,
                        direction: netDieStep > 0 ? 'boosted' : 'suppressed'
                    });
                    // The pre-push die survives as baseDie so the Freebie UI
                    // can offer (and price) the die the player actually owns;
                    // the blast-zone push itself is free.
                    return { ...dieEntry, die: adjustedDie, baseDie: dieEntry.die };
                }
                return dieEntry;
            });
        }

        // FEAR (p.40): "target's pools lose a die" - one die while FEAR is
        // active. Special Crits "stick until removed" and, unlike Sticky
        // Crits ("can pile up and stack", p.43), are not said to stack, so
        // a second FEAR costs no second die.
        let fearDrop = null;
        if (options.fear && pool.length > 0) {
            const dropIndex = getFearDropIndex(pool);
            fearDrop = { ...pool[dropIndex] };
            pool = pool.filter((_, index) => index !== dropIndex);
        }

        return buildResult({ shadowUse: shadowUse.kind, haywireThreshold, freebieDie, titanActive, zenithActive, fearDrop });
    }

    /**
     * Burn validation shared by pre-roll and post-roll burns (p.24): burned
     * tiles must be available, not Hitched (p.20), and share one selected
     * Call color with the Call tile. Returns an error message or null.
     * @param {string[]} callColors
     * @param {any} callTile
     * @param {any[]} burnTiles
     */
    getBurnTilesError(callColors, callTile, burnTiles) {
        const unavailableBurnTile = burnTiles.find(tile => this.getUnavailableReason(tile));
        if (unavailableBurnTile) {
            const reason = this.getUnavailableReason(unavailableBurnTile);
            return `Burn tile '${unavailableBurnTile.name}' is ${reason} and cannot be used.`;
        }

        const hitchedBurnTile = burnTiles.find(tile => isHitchedTile(tile));
        if (hitchedBurnTile) {
            return `Hitched tile '${hitchedBurnTile.name}' cannot be burned.`;
        }

        const colors = [...new Set((callColors || []).filter(Boolean))];
        const tiles = [callTile, ...burnTiles];
        const sharedBurnColors = colors.filter(color => tiles.every(tile => tileMatchesCallColor(tile, color)));
        if (sharedBurnColors.length === 0) {
            return "Burn tiles must share one selected Call color with the Call Tile.";
        }
        return null;
    }

    /**
     * Post-roll burn (p.24): "Tiles can be burned after rolling on a Call,
     * but not after rolling a Burn. i.e., you can't Burn twice on an
     * action." One burn step after the roll: the chosen tiles (one or more,
     * under the pre-roll burn color rules) add their dice and one Add each.
     * Tiles already called in the check cannot also be burned. The dice
     * take the same Aberrant Blast Zone push as the rest of the pool.
     * @param {string[]} callColors
     * @param {any} callTile
     * @param {any[]} burnTiles
     * @param {{alreadyBurned?: boolean, calledTileIds?: string[], aberrantEffects?: {risen?: boolean, fallen?: boolean}}} [options]
     * @returns {{dice: Array<{source: string, die: string, baseDie?: string}>, adds: number, burnTileIds: string[], error: string|null}}
     */
    compilePostRollBurn(callColors, callTile, burnTiles = [], options = {}) {
        /** @param {string} error */
        const fail = (error) => ({ dice: [], adds: 0, burnTileIds: [], error });
        if (options.alreadyBurned) return fail("This check already burned tiles; you can't Burn twice on an action.");
        if (!callTile) return fail('Tiles can only be burned after rolling on a Call.');
        if (!burnTiles || burnTiles.length === 0) return fail('Select at least one tile to burn.');
        const calledIds = new Set(options.calledTileIds || []);
        const calledBurn = burnTiles.find(tile => tile.id === callTile.id || calledIds.has(tile.id));
        if (calledBurn) return fail(`Tile '${calledBurn.name}' was called in this check and cannot also be burned.`);
        const burnError = this.getBurnTilesError(callColors, callTile, burnTiles);
        if (burnError) return fail(burnError);

        const aberrantEffects = options.aberrantEffects || {};
        /** @type {Array<{source: string, die: string, baseDie?: string}>} */
        const dice = [];
        burnTiles.forEach(tile => (tile.dice || []).forEach(die => {
            const adjustedDie = applyAberrantDieStepEffects(die, aberrantEffects);
            dice.push({
                source: `Burn (${tile.name})`,
                die: adjustedDie,
                ...(adjustedDie !== die ? { baseDie: die } : {})
            });
        }));
        return { dice, adds: burnTiles.length, burnTileIds: burnTiles.map(tile => tile.id), error: null };
    }

    /**
     * Titan reroll (p.69): "reroll any die in the pool that rolls below its
     * ▟ - e.g., d6s reroll on a 1, d8s reroll on a 1 or 2." Each qualifying
     * die is rerolled once and the new value kept. `rollFn` is injectable
     * for tests. `shouldReroll` narrows which qualifying dice reroll (the
     * Zenith reroll uses it to reroll a single die).
     * @param {Array<{source: string, die: string, val: number}>} rolledArray
     * @param {(die: string) => number} [rollFn]
     * @param {(roll: {source: string, die: string, val: number}, index: number) => boolean} [shouldReroll]
     */
    applyTitanRerolls(rolledArray, rollFn = (die) => this.rollDie(die), shouldReroll = () => true) {
        const rerolls = [];
        const rolls = rolledArray.map((roll, index) => {
            const steps = DIE_STEPS[roll.die] || 0;
            if (roll.val >= steps || !shouldReroll(roll, index)) return roll;
            const newVal = rollFn(roll.die);
            rerolls.push({ source: roll.source, die: roll.die, from: roll.val, to: newVal });
            return { ...roll, val: newVal };
        });
        return { rolls, rerolls };
    }

    /**
     * Zenith reroll (p.64): "One reroll dice on dice in the pool below ▟."
     * Read literally as one reroll per check: of the dice that rolled below
     * their own ▟, the one with the most to gain (largest average minus its
     * roll) is rerolled once, using the Titan reroll mechanism.
     */
    applyZenithReroll(rolledArray, rollFn = (die) => this.rollDie(die)) {
        let bestIndex = -1;
        let bestGain = 0;
        rolledArray.forEach((roll, index) => {
            const steps = DIE_STEPS[roll.die] || 0;
            if (roll.val >= steps) return;
            const sides = parseInt(String(roll.die).replace('d', ''), 10) || 0;
            const gain = (sides + 1) / 2 - roll.val;
            if (gain > bestGain) {
                bestGain = gain;
                bestIndex = index;
            }
        });
        if (bestIndex < 0) return { rolls: rolledArray, rerolls: [] };
        return this.applyTitanRerolls(rolledArray, rollFn, (_roll, index) => index === bestIndex);
    }

    rollDie(dieString) {
        // dieString e.g., 'd6'
        const max = parseInt(dieString.replace('d', ''), 10);
        if (isNaN(max)) return 0;
        return Math.floor(Math.random() * max) + 1;
    }

    rollPool(diceArray) {
        return diceArray.map(dObj => ({
            source: dObj.source,
            die: dObj.die,
            ...(dObj.baseDie ? { baseDie: dObj.baseDie } : {}),
            val: this.rollDie(dObj.die)
        }));
    }

    calculateOptimalTotal(rolledArray, adds, { haywireThreshold = 1 } = {}) {
        // Sort descending by value
        const sorted = [...rolledArray].sort((a, b) => b.val - a.val);
        const kept = sorted.slice(0, adds);
        const total = kept.reduce((sum, item) => sum + item.val, 0);

        // Haywire (p.23): "In any pool where more than half of the dice roll
        // 1s" the check goes haywire. The Glitch Cyber flaw raises the
        // threshold so 1s AND 2s count (p.65).
        const onesCount = rolledArray.filter(d => d.val <= haywireThreshold).length;
        const isHaywire = onesCount > (rolledArray.length / 2);

        return { total, kept, all: sorted, isHaywire, haywireThreshold, originalRolls: rolledArray };
    }
}
