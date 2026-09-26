// @ts-check
import { parseTag } from './tag-model.js';
import {
    activeTileTagList,
    calculateHitchRebateTotal,
    countGizmoTiles,
    countSliverTiles,
    getExoticSkillBaseXp,
    getTileShadowBoxes,
    isHitchedTile,
    tileHasBestialTag,
    tileHasMechanicalTag,
    tileTagList,
    validateShadowTags
} from './pool.js';
import { getResourceMaxDrift } from './sheet-rules.js';

function hasStickyTag(tile) {
    return tileTagList(tile).some(tag => parseTag(tag).base === 'sticky');
}

function hasBestialResourceChoice(tile) {
    // Typed means the +1 resource is chosen ("Bestial: HP"), matching what
    // calculateResourceMaxes actually grants.
    return tileTagList(tile).some(tag => {
        const parsed = parseTag(tag);
        return parsed.base === 'bestial' && Boolean(parsed.args.resource);
    });
}

function statXpTotal(state, poolEngine) {
    return poolEngine.calculateStatXp(state.stats || {});
}

function tileXpTotal(state) {
    return (state.tiles || []).reduce((sum, tile) => sum + (parseInt(tile.xpCost, 10) || 0), 0);
}

function hasChainTo(tile, targetName) {
    const target = String(targetName || '').trim().toLowerCase();
    return activeTileTagList(tile).some(tag => {
        const parsed = parseTag(tag);
        return parsed.prefix === null
            && (parsed.base === 'chain' || parsed.base === 'world')
            && (parsed.args.target || '').toLowerCase() === target;
    });
}

function hasArcanaSkill(tile) {
    return tile?.type === 'Skill' && tile.exoticSkill?.system === 'Arcana';
}

function countChainTags(tile) {
    return tileTagList(tile).filter(tag => {
        const parsed = parseTag(tag);
        return parsed.prefix === null && parsed.base === 'chain' && parsed.args.target !== '';
    }).length;
}

export function buildRulesReviewItems(state, poolEngine) {
    const items = [];
    const tiles = state.tiles || [];

    const statXp = statXpTotal(state, poolEngine);
    const tileXp = tileXpTotal(state);
    if (state.legacyShadowWarning) {
        items.push({
            severity: 'medium',
            category: 'Legacy Shadow',
            message: 'This character used the old Qi / Id stat rules. The new rules remove those stats. Rebuild Shadow features using Qi / Id tile boxes.'
        });
    }

    // Starting budgets: 25 XP for stats (p.6) and 50 XP for tiles (p.8).
    if ((parseInt(state.xpEarned, 10) || 0) <= 75 && (statXp > 25 || tileXp > 50)) {
        items.push({
            severity: 'low',
            category: 'GM review',
            message: `Creation split is over the PDF start budget (${statXp}/25 stat XP, ${tileXp}/50 tile XP).`
        });
    }

    // "Pools are adjusted whenever new tiles are gained." (p.11) Tile
    // changes now shift the stored HP / EN / RX base with the tiles, but a
    // base saved before that (or typed in by older builds) can still be
    // off. It is not overwritten automatically in case the difference was
    // deliberate; flag it instead.
    const drift = getResourceMaxDrift(state, poolEngine.calculateResourceMaxes(tiles));
    if (drift.length > 0) {
        const details = drift.map(entry => `${entry.key.toUpperCase()} ${entry.stored} (tiles give ${entry.computed})`).join(', ');
        items.push({
            severity: 'low',
            category: 'Vitals',
            message: `Stored base max differs from the tiles: ${details}. Use Auto-Calculate Vitals to match the tiles; record deliberate changes as a Perm bonus (⚙️).`
        });
    }

    // "up to 6 XP can be split between tiles with Hitches" (p.20).
    const hitchRebateTotal = calculateHitchRebateTotal(tiles);
    if (hitchRebateTotal > 6) {
        items.push({
            severity: 'high',
            category: 'Hitch',
            message: `Hitch rebates total ${hitchRebateTotal}/6 XP. Reduce Hitch values until the sheet is at 6 XP or less.`
        });
    }

    tiles.forEach(tile => {
        const dice = tile.dice || [];
        if (!tile.isSpell && tile.gearSubtype !== 'Ammo') {
            const estimate = poolEngine.estimateTileXpDetails(dice, tileTagList(tile), tile.armorType, {
                weapon: tile.weapon,
                exoticSkill: tile.exoticSkill,
                boxes: tile.boxes,
                tileType: tile.type,
                specialIdentity: tile.specialIdentity,
                gearSubtype: tile.type === 'Gear' ? tile.gearSubtype : null
            }).xp;
            const stored = parseInt(tile.xpCost, 10) || 0;
            if (stored !== estimate) {
                items.push({
                    severity: 'medium',
                    category: 'XP',
                    message: `${tile.name}: stored XP ${stored}, current estimate ${estimate}.`
                });
            }
        }

        const tagLimit = poolEngine.calculateTagLimit(dice, tileTagList(tile), {
            specialIdentity: tile.specialIdentity,
            isSpell: Boolean(tile.isSpell)
        });
        if (!tagLimit.valid) {
            items.push({
                severity: 'high',
                category: 'Tags',
                message: `${tile.name}: ${tagLimit.count}/${tagLimit.limit} countable tags.`
            });
        }

        // "Each tile costs 1XP and begins with ... a d4" (p.8): the free d3
        // is only a stat baseline, so a d3 on a tile is a free die.
        if (!tile.isSpell && dice.includes('d3')) {
            items.push({
                severity: 'medium',
                category: 'Dice',
                message: `${tile.name}: has a d3; tiles start at d4.`
            });
        }

        // "They may not start with more than 3▟ on any one tile." (p.8) -
        // the tile's total, so 2d6 (4▟) is over the cap.
        if (!tile.isSpell && poolEngine.calculateSteps(dice) > 3) {
            items.push({
                severity: 'low',
                category: 'GM review',
                message: `${tile.name}: has ${poolEngine.calculateSteps(dice)}▟, above the 3▟ starting cap; confirm this is not a starting tile.`
            });
        }

        // Hitch behavior (p.20): 1 EN on call, cannot be burned.
        if (isHitchedTile(tile)) {
            items.push({
                severity: 'low',
                category: 'Hitch',
                message: `${tile.name}: Hitch costs 1 EN when called and cannot be burned.`
            });
        }

        validateShadowTags(tile).forEach(issue => {
            items.push({
                severity: 'medium',
                category: 'Shadow',
                message: `${tile.name}: ${issue.message}`
            });
        });

        // GM ruling (2026-06-12): Sticky is Ammo-only — an open Sticky
        // would bypass the spell system's Duration pricing.
        if (tile.gearSubtype !== 'Ammo' && hasStickyTag(tile)) {
            items.push({
                severity: 'medium',
                category: 'Tags',
                message: `${tile.name}: the Sticky tag is Ammo-only (GM ruling); use Duration tags for lasting effects.`
            });
        }

        // Bestial adds +1 to one chosen resource pool (p.61).
        if (tileHasBestialTag(tile) && !hasBestialResourceChoice(tile)) {
            items.push({
                severity: 'low',
                category: 'Stranger',
                message: `${tile.name}: Bestial tiles add +1 to one resource. Add a "Bestial: HP/EN/RX" tag to choose it.`
            });
        }

        if (getExoticSkillBaseXp(tile.exoticSkill) > 0) {
            items.push({
                severity: 'low',
                category: 'Exotic',
                message: `${tile.name}: ${tile.exoticSkill.label} metadata is tracked; subsystem effects remain GM-managed.`
            });
        }

        // Chain length limit (p.25): a chain cannot call more tiles than the
        // tile's ▟. More Chain tags than ▟ will always fail at roll time.
        const chainCount = countChainTags(tile);
        const tileSteps = poolEngine.calculateSteps(dice);
        if (chainCount > tileSteps) {
            items.push({
                severity: 'medium',
                category: 'Chain',
                message: `${tile.name}: ${chainCount} Chain tags exceed its ${tileSteps}▟ chain limit (p.25).`
            });
        }

        // Hinder sanity (p.41): a Hinder works through a Range (Earshot or
        // Visual) and a Special crit.
        if (tile.type === 'Gear' && tile.gearSubtype === 'Hinder') {
            const categories = tileTagList(tile).map(tag => poolEngine.classifyTagForXp(tag).category);
            if (!categories.includes('rangeDuration')) {
                items.push({
                    severity: 'low',
                    category: 'Hinder',
                    message: `${tile.name}: Hinders use a Range tag (usually Earshot or Visual).`
                });
            }
            if (!categories.includes('crit')) {
                items.push({
                    severity: 'low',
                    category: 'Hinder',
                    message: `${tile.name}: Hinders deal a Special crit (HOLD, FEAR, GOAD, REVEAL, or VOW).`
                });
            }
        }
    });

    // Chain pacing (p.25): "For each Story Point earned, a Chain tag can be
    // gained." Spells gain their Chain for free and are excluded.
    const boughtChainTags = tiles
        .filter(tile => !tile.isSpell)
        .reduce((sum, tile) => sum + countChainTags(tile), 0);
    const storyPointsEarned = parseInt(state.storyPointsEarned, 10) || 0;
    if (boughtChainTags > storyPointsEarned) {
        items.push({
            severity: 'low',
            category: 'GM review',
            message: `${boughtChainTags} bought Chain tags vs ${storyPointsEarned} Story Points earned ("For each Story Point earned, a Chain tag can be gained", p.25).`
        });
    }

    // "Each Arcana skill tile supports up to ▟ spell tiles." (p.48)
    const arcanaSkills = tiles.filter(hasArcanaSkill);
    arcanaSkills.forEach(skill => {
        const capacity = poolEngine.calculateSteps(skill.dice || []);
        const chainedSpells = tiles.filter(tile => tile.isSpell && hasChainTo(tile, skill.name));
        if (chainedSpells.length > capacity) {
            items.push({
                severity: 'medium',
                category: 'Arcana',
                message: `${skill.name}: ${chainedSpells.length}/${capacity} chained spells for this Arcana skill.`
            });
        }
    });

    // Gizmo / Sliver caps (p.68): up to MIND+FOCUS ▟ gizmos and BODY+POWER ▟
    // slivers (Knack or Implant tags).
    const statSteps = (stat) => poolEngine.calculateSteps(poolEngine.parseDiceString(state.stats?.[stat] || ''));
    const gizmoCount = countGizmoTiles(tiles);
    const gizmoCap = statSteps('MIND') + statSteps('FOCUS');
    if (gizmoCount > gizmoCap) {
        items.push({
            severity: 'medium',
            category: 'Gizmo',
            message: `${gizmoCount}/${gizmoCap} gizmos (limit is MIND+FOCUS ▟).`
        });
    }
    const sliverCount = countSliverTiles(tiles);
    const sliverCap = statSteps('BODY') + statSteps('POWER');
    if (sliverCount > sliverCap) {
        items.push({
            severity: 'medium',
            category: 'Sliver',
            message: `${sliverCount}/${sliverCap} slivers (Knacks/Implants; limit is BODY+POWER ▟).`
        });
    }

    // Gizmos and Implants cannot use Qi or Id (p.68); Knacks can.
    tiles.forEach(tile => {
        const isGizmoOrImplant = tileHasMechanicalTag(tile, 'gizmo') || tileHasMechanicalTag(tile, 'implant');
        if (isGizmoOrImplant && getTileShadowBoxes(tile).length > 0) {
            items.push({
                severity: 'medium',
                category: 'Gizmo',
                message: `${tile.name}: Gizmos and Implants cannot use Qi or Id boxes (Knacks can).`
            });
        }
    });

    // A spell's granted Chain "can only be chained to an Arcana skill
    // tile" (p.48).
    tiles.filter(tile => tile.isSpell).forEach(spell => {
        const chainedToArcana = arcanaSkills.some(skill => hasChainTo(spell, skill.name));
        if (!chainedToArcana) {
            items.push({
                severity: 'medium',
                category: 'Arcana',
                message: `${spell.name}: spell is not chained to a tracked Arcana skill.`
            });
        }
    });

    return items;
}
