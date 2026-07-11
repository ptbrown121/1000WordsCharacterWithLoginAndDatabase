// @ts-check
// Shadow and tile-box rules: Qi/Id and color boxes, call colors,
// Aberration states, Shadow abilities, and Shadow tag validation.
import { normalizeResourceKey, DIE_STEPS, DICE_BY_STEP, D6_STEP, NORMAL_COLORS, SHADOW_KINDS } from './shared.js';
import { normalizeSpecialIdentity } from './exotic.js';
import { parsedTileTags, activeParsedTags } from './tags.js';

export function normalizeShadowKind(kind) {
    const value = String(kind || '').trim().toLowerCase();
    if (value === 'qi' || value === 'white') return 'Qi';
    if (value === 'id' || value === 'black') return 'Id';
    return '';
}

function normalizeTileBox(box) {
    if (!box || typeof box !== 'object') return null;

    const shadowKind = normalizeShadowKind(box.kind || box.shadowKind || box.type);
    if (shadowKind) {
        return {
            type: 'shadow',
            kind: shadowKind,
            resource: normalizeResourceKey(box.resource || box.normalResource || box.contributesTo)
        };
    }

    const color = String(box.color || box.type || '').trim();
    if (NORMAL_COLORS.includes(color)) return { type: 'color', color };
    return null;
}

export function getTileBoxLimit(tile) {
    return normalizeSpecialIdentity(tile?.specialIdentity) ? 3 : 2;
}

export function getTileBoxes(tile) {
    if (!tile) return [];

    if (Array.isArray(tile.boxes) && tile.boxes.length > 0) {
        // flatMap instead of filter(Boolean) so the checker knows nulls are gone.
        return tile.boxes.map(normalizeTileBox).flatMap(box => box ? [box] : []).slice(0, getTileBoxLimit(tile));
    }

    return (tile.colors || []).flatMap(color => {
        const shadowKind = normalizeShadowKind(color);
        if (shadowKind) return [{ type: 'shadow', kind: shadowKind, resource: '' }];
        return NORMAL_COLORS.includes(color) ? [{ type: 'color', color }] : [];
    }).slice(0, getTileBoxLimit(tile));
}

export function serializeTileBoxes(boxes = [], maxBoxes = 2) {
    return boxes.map(normalizeTileBox).flatMap(box => box ? [box] : []).slice(0, maxBoxes);
}

export function getTileColorsFromBoxes(boxes = []) {
    // Cap 3 covers special identity tiles; ordinary tiles never carry more
    // than 2 boxes by the time they reach here.
    return serializeTileBoxes(boxes, 3)
        .map(box => box.type === 'shadow' ? box.kind : box.color)
        .filter(color => color !== undefined);
}

export function getTileNormalCallColors(tile) {
    return [...new Set(getTileBoxes(tile)
        .filter(box => box.type === 'color' && NORMAL_COLORS.includes(box.color))
        .map(box => box.color))];
}

export function getTileShadowBoxes(tile) {
    return getTileBoxes(tile).filter(box => box.type === 'shadow');
}

export function getTileShadowKinds(tile) {
    return [...new Set(getTileShadowBoxes(tile).map(box => box.kind))];
}

export function tileHasShadowKind(tile, kind) {
    return getTileShadowBoxes(tile).some(box => box.kind === kind);
}

export function tileUsesShadow(tile) {
    return getTileShadowBoxes(tile).length > 0;
}

export function tileMatchesCallColor(tile, color) {
    if (!NORMAL_COLORS.includes(color)) return false;
    return getTileBoxes(tile).some(box => {
        if (box.type === 'color') return box.color === color;
        return box.type === 'shadow' && SHADOW_KINDS.includes(box.kind);
    });
}

function getTilesShadowUse(tiles = []) {
    const kinds = new Set();
    tiles.forEach(tile => getTileShadowKinds(tile).forEach(kind => kinds.add(kind)));
    return kinds;
}

// "Any check can either include Qi or Id tiles, not both." (p.58)
export function validateShadowUseForCheck(tiles = []) {
    const kinds = getTilesShadowUse(tiles);
    if (kinds.has('Qi') && kinds.has('Id')) {
        return {
            valid: false,
            kind: 'mixed',
            error: 'A check can include Qi tiles or Id tiles, but not both.'
        };
    }

    return {
        valid: true,
        kind: kinds.has('Qi') ? 'Qi' : kinds.has('Id') ? 'Id' : null,
        error: null
    };
}

// "A check using a Qi tile slides Aberration by 1 rank of Risen. A check
// using an Id tile slides Aberration by 1 rank of Fallen." (p.58)
export function adjustAberrationForShadowUse(currentAberration, shadowKind) {
    const current = parseInt(currentAberration, 10) || 0;
    if (shadowKind === 'Qi') return current + 1;
    if (shadowKind === 'Id') return current - 1;
    return current;
}

// Aberrant Blast Zones (p.59): near a Risen Aberrant any die higher than
// d6 is suppressed 1 ▟; near a Fallen Aberrant it is boosted 1 ▟.
export function getAberrantDieStepNet(effects = {}) {
    return (effects.fallen ? 1 : 0) - (effects.risen ? 1 : 0);
}

export function applyAberrantDieStepEffects(die, effects = {}) {
    const currentStep = DIE_STEPS[die];
    if (currentStep === undefined || currentStep <= D6_STEP) return die;

    const netStep = getAberrantDieStepNet(effects);
    if (netStep === 0) return die;

    const nextStep = Math.max(D6_STEP, Math.min(DIE_STEPS.d16, currentStep + netStep));
    return DICE_BY_STEP[nextStep] || die;
}

export function getShadowTagCounts(tiles = []) {
    const counts = { day: 0, night: 0, dawn: 0, dusk: 0, terminator: 0 };

    tiles.forEach(tile => {
        if (tile?.isBuried) return;
        activeParsedTags(tile).forEach(parsed => {
            if (counts[parsed.base] !== undefined) counts[parsed.base] += 1;
        });
    });

    return counts;
}

// Aberration thresholds from the Shadow and Aberration diagram (p.60):
// Rising/Falling open at ±1, the Dusk and Dawn tags move those thresholds
// down/up by their count, Terminator widens Neutral by 1 each way, and a
// rank past max Shadow makes the caster Risen/Fallen Aberrant (p.58).
export function classifyAberration(aberration = 0, maxShadow = 0, tagCounts = {}) {
    const value = parseInt(String(aberration), 10) || 0;
    const max = Math.max(0, parseInt(String(maxShadow), 10) || 0);
    const dusk = Math.max(0, parseInt(tagCounts.dusk, 10) || 0);
    const dawn = Math.max(0, parseInt(tagCounts.dawn, 10) || 0);
    const terminator = Math.max(0, parseInt(tagCounts.terminator, 10) || 0);
    const states = new Set();

    if (Math.abs(value) <= terminator) states.add('Neutral');
    if (value >= 1 - dusk) states.add('Rising');
    if (value <= -1 + dawn) states.add('Falling');
    if (value > max) states.add('Risen Aberrant');
    if (value < -max) states.add('Fallen Aberrant');

    if (value === 0) states.add('Neutral');

    return Array.from(states);
}

export function formatAberration(aberration = 0, maxShadow = 0, tagCounts = {}) {
    const value = parseInt(String(aberration), 10) || 0;
    const states = classifyAberration(value, maxShadow, tagCounts);
    const rank = Math.abs(value);
    const base = value > 0 ? `Rising ${rank}` : value < 0 ? `Falling ${rank}` : 'Neutral 0';
    const combined = states.length ? states.join(' / ') : 'Unaligned';
    return `${base} (${combined})`;
}

// Shadow spends from the Assets of Rising/Qi and Falling/Id lists and the
// Aberrant Blast Zones (p.59).
export const SHADOW_ABILITIES = [
    { id: 'qi-test', side: 'Qi', tier: 'Neutral/Rising', label: 'Spend 1 Shadow to add max Shadow to a test.' },
    { id: 'qi-color', side: 'Qi', tier: 'Neutral/Rising', label: 'Spend 1 Shadow to add a color to a tile for one check.' },
    { id: 'qi-heal', side: 'Qi', tier: 'Rising', label: 'Spend 1 Shadow to touch-heal any target, restoring max Shadow to 1 resource.' },
    { id: 'qi-soak', side: 'Qi', tier: 'Rising', label: 'Spend 1 Shadow to give any target their Aberration rank as Soak for one round.' },
    { id: 'qi-add-reach', side: 'Qi', tier: 'Rising', label: 'Spend 1 Shadow to give an Add to all targets within Reach range.' },
    { id: 'qi-risen-blast', side: 'Qi', tier: 'Risen Aberrant', label: 'Risen Blast Zone: on your test, all targets heal 1 standard resource each; dice above d6 are suppressed 1 step.' },
    { id: 'id-impact', side: 'Id', tier: 'Neutral/Falling', label: 'Spend 1 Shadow to add max Shadow to impact.' },
    { id: 'id-press', side: 'Id', tier: 'Neutral/Falling', label: 'Spend 1 Shadow to pay for a Press.' },
    { id: 'id-drain', side: 'Id', tier: 'Falling', label: 'Spend 1 Shadow to touch-drain any target, leaching Aberration rank from Health.' },
    { id: 'id-reroll', side: 'Id', tier: 'Falling', label: 'Spend 1 Shadow to let any target reroll all dice on a check.' },
    { id: 'id-haywire', side: 'Id', tier: 'Falling', label: 'Spend 1 Shadow to force all targets within Reach range to Haywire.' },
    { id: 'id-fallen-blast', side: 'Id', tier: 'Fallen Aberrant', label: 'Fallen Blast Zone: on your test, all targets lose 1 standard resource each; dice above d6 are boosted 1 step.' }
];

export function getAvailableShadowAbilities(aberration = 0, maxShadow = 0, tagCounts = {}) {
    const states = classifyAberration(aberration, maxShadow, tagCounts);
    const has = (state) => states.includes(state);

    return SHADOW_ABILITIES.filter(ability => {
        if (ability.side === 'Qi' && ability.tier === 'Neutral/Rising') return has('Neutral') || has('Rising');
        if (ability.side === 'Qi' && ability.tier === 'Rising') return has('Rising');
        if (ability.side === 'Qi' && ability.tier === 'Risen Aberrant') return has('Risen Aberrant');
        if (ability.side === 'Id' && ability.tier === 'Neutral/Falling') return has('Neutral') || has('Falling');
        if (ability.side === 'Id' && ability.tier === 'Falling') return has('Falling');
        if (ability.side === 'Id' && ability.tier === 'Fallen Aberrant') return has('Fallen Aberrant');
        return false;
    });
}

export function getAberrationRank(aberration = 0) {
    return Math.abs(parseInt(String(aberration), 10) || 0);
}

// Shadow Build/Detail tags (p.60): Day needs a Qi box, Night an Id box,
// and Dawn / Dusk / Terminator need either.
export function validateShadowTags(tile) {
    const issues = [];
    const hasQi = tileHasShadowKind(tile, 'Qi');
    const hasId = tileHasShadowKind(tile, 'Id');
    const hasAnyShadow = hasQi || hasId;

    parsedTileTags(tile).forEach(parsed => {
        const baseTag = parsed.base;
        const tag = parsed.raw;
        if (baseTag === 'day' && !hasQi) {
            issues.push({ tag, message: 'Day requires a Qi box.' });
        } else if (baseTag === 'night' && !hasId) {
            issues.push({ tag, message: 'Night requires an Id box.' });
        } else if (['dusk', 'dawn', 'terminator'].includes(baseTag) && !hasAnyShadow) {
            issues.push({ tag, message: `${baseTag[0].toUpperCase()}${baseTag.slice(1)} requires a Qi or Id box.` });
        } else if (['light', 'gloam'].includes(baseTag)) {
            issues.push({ tag, message: `${tag} is from the old Shadow rules and is no longer offered for new builds.` });
        }
    });

    getTileShadowBoxes(tile).forEach((box, index) => {
        if (!box.resource) {
            issues.push({
                tag: box.kind,
                message: `${box.kind} box ${index + 1} must choose Health, Energy, or Reflex.`
            });
        }
    });

    return issues;
}
