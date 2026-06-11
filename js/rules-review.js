import { activeTileTagList, calculateHitchRebateTotal, getExoticSkillBaseXp, isHitchedTile, tileTagList, validateShadowTags } from './pool.js';

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
                specialIdentity: tile.specialIdentity
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

        const tagLimit = poolEngine.calculateTagLimit(dice, tileTagList(tile), { specialIdentity: tile.specialIdentity });
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

        if (getExoticSkillBaseXp(tile.exoticSkill) > 0) {
            items.push({
                severity: 'low',
                category: 'Exotic',
                message: `${tile.name}: ${tile.exoticSkill.label} metadata is tracked; subsystem effects remain GM-managed.`
            });
        }
    });

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
