// @ts-check
// Call-time rules on the results screen, kept apart from the resolution
// math in resolution.js:
//   - Post-roll burn (p.24): "Tiles can be burned after rolling on a Call,
//     but not after rolling a Burn. i.e., you can't Burn twice on an
//     action." Mirrors the post-roll Freebie panel.
//   - Result notices for FEAR (p.40), GOAD / Witch burn requirements
//     (pp.40, 48), and Zenith rerolls (p.64).
import { escapeHtml } from '../pool.js';
import { getBurnTileChoices } from '../pool-tile-selection.js';
import { uiState } from '../state.js';
import { els } from '../els.js';
import { showAlert, showConfirm } from './dialogService.js';

/** @type {import('../data.js').DataManager} */
let dataManager;
/** @type {import('../pool.js').PoolEngine} */
let poolEngine;
/** @type {() => void} */
let renderAll;
/** @type {() => void} */
let rerender = () => {};

// Tiles ticked in the post-roll burn panel, for the result they were
// picked on (a new roll starts a fresh selection).
/** @type {string[]} */
let selectedIds = [];
/** @type {import('../types.js').RollResult|null} */
let selectionResult = null;

/**
 * @param {import('../types.js').AppDependencies} deps
 * @param {() => void} rerenderResolution
 */
export function init(deps, rerenderResolution) {
    dataManager = deps.dataManager;
    poolEngine = deps.poolEngine;
    renderAll = deps.renderAll;
    rerender = rerenderResolution;

    els.resolutionControls.addEventListener('change', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLInputElement) || !target.classList.contains('post-burn-cb')) return;
        const tileId = target.dataset.tileId;
        if (!tileId) return;
        syncSelection(uiState.lastRollResult);
        selectedIds = target.checked
            ? [...new Set([...selectedIds, tileId])]
            : selectedIds.filter(id => id !== tileId);
        rerender();
    });

    els.resolutionControls.addEventListener('click', (e) => {
        const target = e.target;
        if (target instanceof HTMLElement && target.classList.contains('btn-post-burn')) {
            burnAfterRoll();
        }
    });
}

/** @param {import('../types.js').RollResult|null} result */
function syncSelection(result) {
    if (selectionResult !== result) {
        selectionResult = result;
        selectedIds = [];
    }
}

/** @param {import('../types.js').RollResult} result */
function canBurnAfterRoll(result) {
    return Boolean(result.callTileId)
        && (result.preRollBurnTileIds || []).length === 0
        && (result.postRollBurnTileIds || []).length === 0
        && dataManager?.canEditActiveCharacter();
}

/** @param {import('../types.js').RollResult} result */
function getCallTile(result) {
    return (dataManager.state.tiles || []).find(tile => tile.id === result.callTileId) || null;
}

/**
 * Burn candidates follow the pre-roll burn rules (getBurnTileChoices: same
 * shared color, available, not Hitched), minus tiles already called in
 * this check.
 * @param {import('../types.js').RollResult} result
 * @param {import('../types.js').Tile[]} selectedTiles
 */
function getPostRollBurnChoices(result, selectedTiles) {
    const callTile = getCallTile(result);
    if (!callTile) return [];
    const calledIds = new Set([...(result.calledTileIds || []), ...(result.hitchTileIds || [])]);
    return getBurnTileChoices(dataManager.state.tiles || [], result.callColors || [], callTile, selectedTiles)
        .filter(tile => !calledIds.has(tile.id));
}

/** @param {import('../types.js').RollResult} result */
function getSelectedTiles(result) {
    syncSelection(result);
    const tiles = dataManager.state.tiles || [];
    return selectedIds
        .map(id => tiles.find(tile => tile.id === id))
        .filter(tile => tile && !tile.isBurnt && !tile.isBuried);
}

/** @param {import('../types.js').RollResult} result */
export function renderPostRollBurnPanel(result) {
    if (!poolEngine || !canBurnAfterRoll(result)) return '';
    const selectedTiles = /** @type {import('../types.js').Tile[]} */ (getSelectedTiles(result));
    const choices = getPostRollBurnChoices(result, selectedTiles);
    if (choices.length === 0) return '';

    const selected = new Set(selectedTiles.map(tile => tile.id));
    const options = choices.map(tile => `
        <label class="tag-bonus-option">
            <input type="checkbox" class="post-burn-cb" data-tile-id="${escapeHtml(tile.id)}"${selected.has(tile.id) ? ' checked' : ''}>
            <span class="tag-bonus-main">
                <span class="tag-bonus-title">${escapeHtml(tile.name)}</span>
                <span class="tag-bonus-context">${escapeHtml((tile.dice || []).join(', ') || 'No dice')}</span>
            </span>
        </label>`).join('');
    const count = selectedTiles.length;
    const button = count > 0
        ? `<button class="btn btn-outline btn-post-burn" type="button">Burn ${count} tile${count === 1 ? '' : 's'} and roll (+${count} Add${count === 1 ? '' : 's'})</button>`
        : '';

    return `
        <div class="freebie-resolution-panel post-roll-burn-panel" style="margin-top: 0.5rem;">
            <h3>Burn After Rolling</h3>
            <p class="hint-text">Tiles can be burned after rolling on a Call, but not after rolling a Burn: one burn per action. Each burned tile adds its dice and a bonus Add, and must share one Call color with the Call tile.</p>
            ${options}
            <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-top: 0.25rem;">
                ${button}
            </div>
        </div>
    `;
}

async function burnAfterRoll() {
    const result = uiState.lastRollResult;
    if (!result || !poolEngine || !canBurnAfterRoll(result)) return;
    const burnTiles = /** @type {import('../types.js').Tile[]} */ (getSelectedTiles(result));
    const compiled = poolEngine.compilePostRollBurn(result.callColors || [], getCallTile(result), burnTiles, {
        alreadyBurned: (result.preRollBurnTileIds || []).length > 0 || (result.postRollBurnTileIds || []).length > 0,
        calledTileIds: [...(result.calledTileIds || []), ...(result.hitchTileIds || [])],
        aberrantEffects: result.aberrantEffects
    });
    if (compiled.error) {
        showAlert(compiled.error);
        return;
    }

    const names = burnTiles.map(tile => tile.name).join(', ');
    const dice = compiled.dice.map(entry => entry.die).join(', ');
    if (!await showConfirm(`Burn ${names} after rolling? ${dice ? `Rolls ${dice} and adds` : 'Adds'} ${compiled.adds} Add${compiled.adds === 1 ? '' : 's'}. Burned tiles are out of play until the character rests.`, { title: 'Burn after rolling?' })) return;
    // The dialog is async: bail if another roll replaced this result.
    if (uiState.lastRollResult !== result) return;

    // New dice roll like the post-roll Freebie does (virtually). Titan and
    // an unused Zenith reroll still apply to them.
    let newRolls = poolEngine.rollPool(/** @type {import('../types.js').PoolDie[]} */ (compiled.dice));
    if (result.titanActive && result.rollMode !== 'manual') {
        const titanResult = poolEngine.applyTitanRerolls(newRolls);
        newRolls = titanResult.rolls;
        result.titanRerolls = [...(result.titanRerolls || []), ...titanResult.rerolls];
    }
    if (result.zenithActive && result.rollMode !== 'manual' && (result.zenithRerolls || []).length === 0) {
        const zenithResult = poolEngine.applyZenithReroll(newRolls);
        newRolls = zenithResult.rolls;
        result.zenithRerolls = zenithResult.rerolls;
    }

    const adds = (result.adds ?? 2) + compiled.adds;
    const recalculated = poolEngine.calculateOptimalTotal([...(result.originalRolls || []), ...newRolls], adds, {
        haywireThreshold: result.haywireThreshold || 1
    });
    Object.assign(result, recalculated);
    result.adds = adds;
    result.postRollBurnTileIds = [...compiled.burnTileIds];

    burnTiles.forEach(tile => {
        tile.isBurnt = true;
        dataManager.updateTile(tile);
    });

    // Tile-usage tracking: the check's roll-log row is already written
    // (roll_logs rows are insert-only), so the post-roll burn gets its own
    // row carrying the burned tiles and the check's new total.
    if (!result.isTestRoll) {
        dataManager.recordRollLog({
            isTest: false,
            mode: result.rollMode || 'virtual',
            callColors: result.callColors || [],
            calledTileIds: [],
            calledTiles: burnTiles.map(tile => ({
                id: tile.id,
                name: tile.name || 'Unknown tile',
                type: tile.type || '',
                colors: tile.colors || [],
                burnedAfterRoll: true
            })),
            burnTileIds: [...compiled.burnTileIds],
            hitchTileIds: [],
            total: result.total || 0,
            adds,
            flatBonus: result.flatBonus || 0,
            haywire: Boolean(result.isHaywire)
        });
    }

    selectedIds = [];
    if (renderAll) renderAll();
    rerender();
}

/**
 * Call-time notices for the results panel (HTML strings).
 * @param {import('../types.js').RollResult} result
 */
export function getCallTimeNotices(result) {
    const notices = [];
    if (result.fearDrop) {
        notices.push(`<div class="result-notice">FEAR: this pool lost a die — ${escapeHtml(result.fearDrop.die)} from ${escapeHtml(result.fearDrop.source)} (the lowest die).</div>`);
    }
    const requirements = result.burnRequirements || [];
    if (requirements.length > 0) {
        const burned = (result.preRollBurnTileIds || []).length > 0 || (result.postRollBurnTileIds || []).length > 0;
        const reasons = requirements.map(req => req.reason).join(' and ');
        notices.push(burned
            ? `<div class="result-notice">${escapeHtml(reasons)}: met by the burn in this check.</div>`
            : `<div class="result-notice">${requirements.map(req => escapeHtml(req.message)).join(' ')} No tile was burned — burn one below, or confirm with the GM how it was met.</div>`);
    }
    const zenithRerolls = result.zenithRerolls || [];
    if (zenithRerolls.length > 0) {
        notices.push(`<div class="result-notice">Zenith reroll: ${zenithRerolls.map(r => `${escapeHtml(r.die)} ${r.from}→${r.to}`).join(', ')}.</div>`);
    } else if (result.zenithActive && result.zenithManualReminder) {
        notices.push('<div class="result-notice">Zenith active: reroll one physical die that rolled below its ▟ and enter the new value.</div>');
    }
    return notices;
}
