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

function hasBestialResourceChoice(tile) {
    return tileTagList(tile).some(tag => /^(?:build\s*:|detail\s*:)?\s*bestial\s*:?\s*(hp|health|en|energy|rx|reflex)/i.test(String(tag).trim()));
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
        const normalized = String(tag).trim().toLowerCase();
        return normalized === `chain ${target}` || normalized === `world ${target}`;
    });
}

function hasArcanaSkill(tile) {
    return tile?.type === 'Skill' && tile.exoticSkill?.system === 'Arcana';
}

function countChainTags(tile) {
    return tileTagList(tile).filter(tag => /^chain\s+/i.test(String(tag).trim())).length;
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

    if ((parseInt(state.xpEarned, 10) || 0) <= 75 && (statXp > 25 || tileXp > 50)) {
        items.push({
            severity: 'low',
            category: 'GM review',
            message: `Creation split is over the PDF start budget (${statXp}/25 stat XP, ${tileXp}/50 tile XP).`
        });
    }

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

        if (!tile.isSpell && dice.some(die => poolEngine.calculateSteps([die]) > 3)) {
            items.push({
                severity: 'low',
                category: 'GM review',
                message: `${tile.name}: has a die above 3▟; confirm this is not a starting tile.`
            });
        }

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
