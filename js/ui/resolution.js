// @ts-check
import { ARMOR_COVERAGE_SOAK, calculateCoreMax, calculateTitanMax, escapeHtml, getDefenseShieldSources, isGearTagsBroken, isHinderTile, isHitchedTile, RESOURCE_LABELS, tileHasMechanicalTag } from '../pool.js';
import { getEffectiveMax } from '../data.js';
import { normalizeActiveCrits } from '../status-rules.js';
import { uiState } from '../state.js';
import { els } from '../els.js';
import { showAlert, showConfirm } from './dialogService.js';
import {
    RESOLUTION_MODES,
    RESOLUTION_PLUS_BUCKETS,
    getRollId,
    getDefaultResolutionAssignments,
    getAssignmentOptions,
    getResolutionBonusTotals,
    calculateAssignedTotals,
    calculateResolutionPlusUsage,
    getHealingAssignments,
    applyShieldsToCrits,
    parseCritList,
    getRangeExtensionResults,
    getChainMaxedDieCost,
    CHAIN_COST_RESOURCE_KEYS
} from '../resolution-rules.js';

/** @type {import('../data.js').DataManager} */
let dataManager;
/** @type {import('../pool.js').PoolEngine} */
let poolEngine;
/** @type {() => void} */
let renderAll;

/** @param {import('../types.js').AppDependencies} deps */
export function init(deps) {
    dataManager = deps.dataManager;
    poolEngine = deps.poolEngine;
    renderAll = deps.renderAll;

    els.resolutionControls.addEventListener('change', (e) => {
        if (!uiState.lastRollResult) return;
        const target = e.target;
        if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) return;

        if (target.id === 'resolution-mode' && ['action', 'attack', 'defense', 'healing'].includes(target.value)) {
            uiState.currentResolutionMode = /** @type {'action'|'attack'|'defense'|'healing'} */ (target.value);
            uiState.currentResolutionAssignments = getDefaultResolutionAssignments(uiState.lastRollResult, uiState.currentResolutionMode);
            renderResolution();
            return;
        }

        if (target.classList.contains('resolution-die-select') && target.dataset.rollId) {
            uiState.currentResolutionAssignments[target.dataset.rollId] = target.value;
            renderResolution();
            return;
        }

        if (target.classList.contains('ammo-die-select') && target.dataset.ammoTileId) {
            uiState.ammoAssignments[target.dataset.ammoTileId] = target.value;
            renderResolution();
            return;
        }

        if (target.classList.contains('chain-cost-resource') && target.dataset.rollId) {
            uiState.chainCostSelections[target.dataset.rollId] = target.value;
            return;
        }

        if (target.id === 'healing-in-combat' && target instanceof HTMLInputElement) {
            uiState.healingInCombat = target.checked;
            renderResolutionDetails();
            return;
        }

        if (target.classList.contains('defense-shield-toggle') && target instanceof HTMLInputElement && target.dataset.tileId) {
            uiState.defenseShieldSelections[target.dataset.tileId] = target.checked;
            renderResolutionDetails();
            return;
        }

        if (target.classList.contains('resolution-extra')) {
            renderResolutionDetails();
        }
    });

    els.resolutionControls.addEventListener('input', (e) => {
        if (!uiState.lastRollResult || !(e.target instanceof Element) || !e.target.classList.contains('resolution-extra')) return;
        renderResolutionDetails();
    });

    els.resolutionControls.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.classList.contains('btn-roll-freebie')) {
            rollPostRollFreebie(target.dataset.die || '');
            return;
        }
        if (target.classList.contains('btn-titan-add')) {
            spendTitanOnAdd();
            return;
        }
        if (target.classList.contains('btn-titan-maximize')) {
            spendTitanOnMaximize();
            return;
        }
        if (target.classList.contains('btn-chain-cost-pay')) {
            payChainCost();
            return;
        }
        if (!target.classList.contains('btn-resolve-ammo') || !target.dataset.ammoTileId) return;
        resolveAmmo(target.dataset.ammoTileId);
    });

    els.resultNotices?.addEventListener('click', (e) => {
        if (e.target instanceof Element && e.target.classList.contains('btn-bleed-burn')) burnCalledTilesForBleed();
    });
}

// BLEED one-click: burn the called tiles from the last roll (skipping tiles
// already burnt and Hitched tiles, which cannot be burned).
function burnCalledTilesForBleed() {
    const result = uiState.lastRollResult;
    if (!result || !dataManager.canEditActiveCharacter()) return;
    const calledIds = new Set(result.calledTileIds || []);
    const tiles = (dataManager.state.tiles || [])
        .filter(tile => calledIds.has(tile.id) && !tile.isBurnt && !isHitchedTile(tile));
    if (tiles.length === 0) return;
    tiles.forEach(tile => {
        tile.isBurnt = true;
        dataManager.updateTile(tile);
    });
    if (renderAll) renderAll();
    renderResolutionDetails();
}

export function getResolutionExtraValue(id) {
    const input = document.getElementById(id);
    return input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement ? input.value : '';
}

function isShieldSourceActive(source) {
    const stored = uiState.defenseShieldSelections[source.tileId];
    return stored === undefined ? source.kind === 'armor' : Boolean(stored);
}

function getActiveDefenseShields() {
    const sources = getDefenseShieldSources(dataManager?.state?.tiles || []);
    const active = sources.filter(isShieldSourceActive);
    return {
        sources,
        active,
        crits: active.flatMap(source => source.crits)
    };
}

// Base soak from armor tiles called into this roll (p.42: "If it is part of
// armor, the Soak is applied only if the tile is called"). Ironclad soak is
// deliberately excluded - it already flows through the called tile's opt-in
// tag bonuses, and adding it here would double count.
/** @param {import('../types.js').RollResult} result */
function getCalledArmorSoak(result) {
    const calledIds = new Set(result?.calledTileIds || []);
    const sources = (dataManager?.state?.tiles || [])
        .filter(tile => calledIds.has(tile.id) && tile.armorType && !tile.isBuried && !tile.isBurnt && !isGearTagsBroken(tile))
        .map(tile => ({
            tileName: tile.name || 'Armor',
            soak: ARMOR_COVERAGE_SOAK[tile.armorType.coverage] || 0
        }))
        .filter(source => source.soak > 0);

    return {
        sources,
        total: sources.reduce((sum, source) => sum + source.soak, 0)
    };
}

function renderDefenseShieldPanel() {
    const { sources } = getActiveDefenseShields();
    if (sources.length === 0) return '';

    const rows = sources.map(source => {
        const checked = isShieldSourceActive(source) ? ' checked' : '';
        const critList = source.crits.map(crit => crit.toUpperCase()).join(', ');
        const hint = source.kind === 'armor' ? 'armor' : `${source.kind} - must be ready as a defense`;
        return `
            <label class="resolution-field" style="justify-content: start; gap: 0.5rem;">
                <input type="checkbox" class="defense-shield-toggle" data-tile-id="${escapeHtml(source.tileId)}"${checked}>
                <span><strong>${escapeHtml(source.tileName)}</strong> shields ${escapeHtml(critList)} <small>(${escapeHtml(hint)})</small></span>
            </label>
        `;
    }).join('');

    return `
        <div class="defense-shield-panel" style="margin-top: 0.5rem;">
            <label>Shield Tags</label>
            ${rows}
        </div>
    `;
}

export function getResolutionNumber(id) {
    const value = parseInt(getResolutionExtraValue(id), 10);
    return Number.isFinite(value) ? value : null;
}

export function getResolutionText(id) {
    return getResolutionExtraValue(id).trim();
}

/** @param {import('../types.js').RollResult} result @param {number} usedCount @param {number} adds */
export function renderResolutionUsageFields(result, usedCount, adds) {
    if (!RESOLUTION_PLUS_BUCKETS[uiState.currentResolutionMode]) {
        return `
            <div class="resolution-field">
                <label>Dice Used</label>
                <div class="${usedCount > adds ? 'resolution-warning' : 'resolution-success'}">${usedCount}/${adds}</div>
            </div>
        `;
    }

    const plusUsage = calculateResolutionPlusUsage(result, uiState.currentResolutionMode, uiState.currentResolutionAssignments);
    const diceTotal = (result.originalRolls || []).length;

    return `
        <div class="resolution-field">
            <label>Dice Assigned</label>
            <div class="resolution-success">${usedCount}/${diceTotal}</div>
        </div>
        <div class="resolution-field">
            <label>Pluses Used</label>
            <div class="${plusUsage.used > plusUsage.budget ? 'resolution-warning' : 'resolution-success'}">${plusUsage.used}/${plusUsage.budget}</div>
        </div>
    `;
}

export function renderResolutionModeOptions() {
    return Object.entries(RESOLUTION_MODES).map(([value, mode]) => {
        const selected = value === uiState.currentResolutionMode ? ' selected' : '';
        return `<option value="${value}"${selected}>${mode.label}</option>`;
    }).join('');
}

export function renderResolutionExtraFields() {
    if (uiState.currentResolutionMode === 'attack') {
        return `
            <div class="resolution-extra-grid">
                <div class="resolution-field">
                    <label for="target-evasion">Target Evasion</label>
                    <input id="target-evasion" class="resolution-extra" type="text" inputmode="numeric" value="${escapeHtml(getResolutionExtraValue('target-evasion'))}">
                </div>
                <div class="resolution-field">
                    <label for="target-soak">Target Soak</label>
                    <input id="target-soak" class="resolution-extra" type="text" inputmode="numeric" value="${escapeHtml(getResolutionExtraValue('target-soak'))}">
                </div>
                <div class="resolution-field">
                    <label for="target-grit">Target Grit</label>
                    <input id="target-grit" class="resolution-extra" type="text" inputmode="numeric" value="${escapeHtml(getResolutionExtraValue('target-grit'))}">
                </div>
                <div class="resolution-field">
                    <label for="attack-crits">Crit Tags</label>
                    <input id="attack-crits" class="resolution-extra" type="text" value="${escapeHtml(getResolutionExtraValue('attack-crits'))}" placeholder="e.g. JOLT, DOWN">
                </div>
            </div>
        `;
    }

    if (uiState.currentResolutionMode === 'defense') {
        return `
            <div class="resolution-extra-grid">
                <div class="resolution-field">
                    <label for="incoming-attack">Incoming Attack</label>
                    <input id="incoming-attack" class="resolution-extra" type="text" inputmode="numeric" value="${escapeHtml(getResolutionExtraValue('incoming-attack'))}">
                </div>
                <div class="resolution-field">
                    <label for="incoming-impact">Incoming Impact</label>
                    <input id="incoming-impact" class="resolution-extra" type="text" inputmode="numeric" value="${escapeHtml(getResolutionExtraValue('incoming-impact'))}">
                </div>
                <div class="resolution-field">
                    <label for="defense-soak">Other Soak</label>
                    <input id="defense-soak" class="resolution-extra" type="text" inputmode="numeric" value="${escapeHtml(getResolutionExtraValue('defense-soak'))}">
                </div>
                <div class="resolution-field">
                    <label for="incoming-crits">Incoming Crit Tags</label>
                    <input id="incoming-crits" class="resolution-extra" type="text" value="${escapeHtml(getResolutionExtraValue('incoming-crits'))}" placeholder="e.g. BLEED, DOWN">
                </div>
            </div>
            ${renderDefenseShieldPanel()}
            <p class="hint-text">Resisting a Hinder: defend with Guile, Menace, Presence, Reason, or Wiles — but not the attacker's skill. Hinder impact drains Energy or Reflex, not Health.</p>
        `;
    }

    if (uiState.currentResolutionMode === 'healing') {
        return `
            <div class="resolution-extra-grid">
                <label class="resolution-field" style="justify-content: end;">
                    <span>During Combat</span>
                    <input id="healing-in-combat" type="checkbox"${uiState.healingInCombat ? ' checked' : ''}>
                </label>
            </div>
        `;
    }

    return '';
}

/** @param {import('../types.js').RollResult} result */
export function renderResolutionAssignments(result) {
    const options = getAssignmentOptions(uiState.currentResolutionMode);
    const validValues = new Set(options.map(option => option.value));

    return (result.originalRolls || []).map((roll, index) => {
        const rollId = getRollId(roll, index);
        const assignment = validValues.has(uiState.currentResolutionAssignments[rollId])
            ? uiState.currentResolutionAssignments[rollId]
            : 'unused';
        const optionHtml = options.map(option => {
            const selected = option.value === assignment ? ' selected' : '';
            return `<option value="${option.value}"${selected}>${option.label}</option>`;
        }).join('');

        return `
            <div class="resolution-die-row">
                <span class="resolution-die-main">
                    <span class="resolution-die-badge" title="${escapeHtml(roll.die)} rolled ${roll.val}">
                        <span class="resolution-die-type">${escapeHtml(roll.die)}</span>
                        <span class="resolution-die-label">rolled</span>
                        <span class="resolution-die-roll">${roll.val}</span>
                    </span>
                    <span class="resolution-die-source">${escapeHtml(roll.source)}</span>
                </span>
                <select class="resolution-die-select" data-roll-id="${rollId}">
                    ${optionHtml}
                </select>
            </div>
        `;
    }).join('');
}

/** @param {import('../types.js').RollResult} result @param {string} [selectedId] */
function getRollOptions(result, selectedId = '') {
    const empty = '<option value="">-- Assign die --</option>';
    const options = (result.originalRolls || []).map((roll, index) => {
        const rollId = getRollId(roll, index);
        const selected = rollId === selectedId ? ' selected' : '';
        return `<option value="${escapeHtml(rollId)}"${selected}>${escapeHtml(roll.source)} ${escapeHtml(roll.die)} rolled ${escapeHtml(roll.val)}</option>`;
    }).join('');
    return empty + options;
}

/** @param {import('../types.js').RollResult} result */
export function renderAmmoResolution(result) {
    const options = result.ammoOptions || [];
    if (options.length === 0) return '';

    const rows = options.map(option => {
        const selected = uiState.ammoAssignments[option.tileId] || '';
        const roll = (result.originalRolls || []).find((candidate, index) => getRollId(candidate, index) === selected);
        const status = roll
            ? (roll.val >= option.supply ? 'Retains on resolve' : 'Runs out on resolve')
            : (option.linked ? `Supply ${option.supply}` : `Unlinked · Supply ${option.supply}`);
        return `
            <div class="ammo-resolution-row">
                <span class="ammo-resolution-main">
                    <strong>${escapeHtml(option.name)}</strong>
                    <small>${escapeHtml(option.targetName || 'GM target')} · ${escapeHtml(option.currentSupply)}/${escapeHtml(option.supply)}</small>
                </span>
                <select class="ammo-die-select" data-ammo-tile-id="${escapeHtml(option.tileId)}">
                    ${getRollOptions(result, selected)}
                </select>
                <button class="btn-resolve-ammo" type="button" data-ammo-tile-id="${escapeHtml(option.tileId)}"${selected ? '' : ' disabled'}>Resolve</button>
                <span class="ammo-resolution-status">${escapeHtml(status)}</span>
            </div>
        `;
    }).join('');

    // Crafting (pp.74-75): reagents are unlinked Ammo tiles. The minimum
    // crafting Test is the sum of the reagent XP (the GM may raise it), and
    // the impact die sets the doses produced.
    const reagents = options.filter(option => !option.linked);
    const craftingHint = reagents.length > 0
        ? `<p class="hint-text">Crafting: minimum Test = sum of reagent XP (these unlinked tiles total ${reagents.reduce((sum, option) => sum + (option.xpCost || 0), 0)} XP; the GM may raise it). Resolve as an Attack — the die assigned to Impact sets the doses produced. "Supply"-keyed effects use each reagent's 🞧 value.</p>`
        : '';

    return `
        <div class="ammo-resolution-panel">
            <h3>Ammo Resolution</h3>
            <p class="hint-text">Assign a spare die to ammo. If the die is below Supply, the ammo is buried/runs out.</p>
            ${rows}
            ${craftingHint}
        </div>
    `;
}

// Post-roll Freebie (p.25): "You can do this before or after you roll, but
// only once per check." Pre-roll freebies set result.freebieUsed, which
// hides this panel.
/** @param {import('../types.js').RollResult} result */
function renderFreebiePanel(result) {
    if (result.freebieUsed || !poolEngine) return '';

    // Offer the pre-push base die (baseDie) at the base cost; an Aberrant
    // Blast Zone pushes the copy for free, shown as e.g. "d8→d10".
    const rolls = (result.originalRolls || [])
        .filter(roll => /^d\d+$/.test(String(roll.baseDie || roll.die)));
    const pushedTo = {};
    rolls.forEach(roll => {
        if (roll.baseDie && roll.baseDie !== roll.die) pushedTo[roll.baseDie] = roll.die;
    });
    const distinctDice = [...new Set(rolls.map(roll => roll.baseDie || roll.die))]
        .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
    if (distinctDice.length === 0) return '';

    const buttons = distinctDice.map(die => {
        const cost = poolEngine.calculateSteps([die]);
        const push = pushedTo[die] ? `→${pushedTo[die]}` : '';
        return `<button class="btn btn-outline btn-roll-freebie" type="button" data-die="${escapeHtml(die)}">Roll ${escapeHtml(die)}${escapeHtml(push)} (${cost} EN)</button>`;
    }).join('');

    return `
        <div class="freebie-resolution-panel" style="margin-top: 0.5rem;">
            <h3>Freebie Die</h3>
            <p class="hint-text">Once per test: spend Energy equal to the die's ▟ to add one more die that duplicates a die already in the pool.</p>
            <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                ${buttons}
            </div>
        </div>
    `;
}

// Titan spends on the current roll (p.69): 1 Titan buys an extra Add, or
// maximizes a die. When no Titan tile was used in the check, only dice
// assigned to Grit or Impact may be maximized.
function getTitanEffectiveMaxValue() {
    if (!dataManager) return 0;
    return getEffectiveMax(dataManager.state, 'titan', calculateTitanMax(dataManager.state.tiles || []));
}

async function spendOneTitan(reason) {
    const state = dataManager.state;
    const current = parseInt(state.titan, 10) || 0;
    if (current <= 0 && !state.gmOverride) {
        showAlert('No Titan available to spend.');
        return false;
    }
    if (!await showConfirm(`Spend 1 Titan to ${reason}?`, { title: 'Spend Titan?' })) return false;
    state.titan = Math.max(0, current - 1);
    dataManager.saveState();
    if (renderAll) renderAll();
    return true;
}

/** @param {import('../types.js').RollResult} result */
function recalculateRollTotals(result) {
    const recalculated = poolEngine.calculateOptimalTotal(result.originalRolls || [], result.adds ?? 2, {
        haywireThreshold: result.haywireThreshold || 1
    });
    Object.assign(result, recalculated);
}

async function spendTitanOnAdd() {
    const result = uiState.lastRollResult;
    if (!result || !poolEngine) return;
    if (!await spendOneTitan('gain +1 Add')) return;
    result.adds = (result.adds ?? 2) + 1;
    recalculateRollTotals(result);
    renderResolution();
}

/** @param {import('../types.js').RollResult} result */
function getTitanMaximizeCandidates(result) {
    return (result.originalRolls || [])
        .map((roll, index) => {
            const rollId = getRollId(roll, index);
            return {
                roll,
                rollId,
                assignment: uiState.currentResolutionAssignments[rollId] || 'unused',
                faces: parseInt(String(roll.die || '').replace('d', ''), 10) || 0
            };
        })
        .filter(entry => entry.faces > 0 && entry.roll.val < entry.faces)
        .filter(entry => result.titanActive || ['grit', 'impact'].includes(entry.assignment));
}

async function spendTitanOnMaximize() {
    const result = uiState.lastRollResult;
    if (!result || !poolEngine) return;

    const maximizeSelect = document.getElementById('titan-maximize-die');
    const rollId = maximizeSelect instanceof HTMLSelectElement ? maximizeSelect.value : '';
    const candidate = getTitanMaximizeCandidates(result).find(entry => entry.rollId === rollId);
    if (!candidate) return;
    if (!await spendOneTitan(`maximize the ${candidate.roll.die} (${candidate.roll.val} -> ${candidate.faces})`)) return;

    candidate.roll.val = candidate.faces;
    recalculateRollTotals(result);
    renderResolution();
}

/** @param {import('../types.js').RollResult} result */
function renderTitanResolutionPanel(result) {
    if (!poolEngine || getTitanEffectiveMaxValue() <= 0) return '';
    const current = parseInt(dataManager.state.titan, 10) || 0;
    const candidates = getTitanMaximizeCandidates(result);
    const options = candidates.map(entry =>
        `<option value="${escapeHtml(entry.rollId)}">${escapeHtml(entry.roll.die)} rolled ${entry.roll.val} (${escapeHtml(entry.assignment)})</option>`
    ).join('');
    const restriction = result.titanActive
        ? 'Titan tile used: any die may be maximized.'
        : 'No Titan tile in this check: only dice assigned to Grit or Impact may be maximized.';

    return `
        <div class="freebie-resolution-panel" style="margin-top: 0.5rem;">
            <h3>Titan (${current} available)</h3>
            <p class="hint-text">${restriction} Titan can also be spent as Core or Shadow (1:1) if those pools exist.</p>
            <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                <button class="btn btn-outline btn-titan-add" type="button"${current <= 0 ? ' disabled' : ''}>+1 Add (1 Titan)</button>
                <select id="titan-maximize-die">
                    <option value="">-- Choose die --</option>
                    ${options}
                </select>
                <button class="btn btn-outline btn-titan-maximize" type="button"${current <= 0 || candidates.length === 0 ? ' disabled' : ''}>Maximize (1 Titan)</button>
            </div>
        </div>
    `;
}

// Chain cost (p.25, upcoming-edition ruling): in a chained check every
// maxed die that is used costs 1 resource of the player's choice. The
// panel lists each maxed die; leaving it on Unused in the assignment list
// skips its cost, otherwise the player picks the resource to spend.
/** @param {import('../types.js').RollResult} result */
function renderChainCostPanel(result) {
    const cost = getChainMaxedDieCost(result, uiState.currentResolutionAssignments);
    if (!cost.chained || cost.entries.length === 0) return '';

    const paid = result.chainCostPaid;
    const shadowMax = getEffectiveMax(dataManager?.state || {}, 'sh',
        poolEngine ? poolEngine.calculateShadowMax(dataManager?.state?.tiles || []) : 0);
    const resourceKeys = CHAIN_COST_RESOURCE_KEYS.filter(key => key !== 'sh' || shadowMax > 0);

    const rows = cost.entries.map(entry => {
        let control;
        if (paid) {
            const paidKey = paid.selections?.[entry.rollId];
            control = paidKey
                ? `<span class="resolution-success">Paid 1 ${escapeHtml(RESOURCE_LABELS[paidKey] || paidKey)}</span>`
                : '<span>Unused — no cost</span>';
        } else if (entry.used) {
            const selected = uiState.chainCostSelections[entry.rollId] || 'en';
            const options = resourceKeys.map(key =>
                `<option value="${key}"${key === selected ? ' selected' : ''}>${RESOURCE_LABELS[key]}</option>`).join('');
            control = `<select class="chain-cost-resource" data-roll-id="${escapeHtml(entry.rollId)}">${options}</select>`;
        } else {
            control = '<span class="resolution-success">Unused — no cost</span>';
        }
        return `
            <div class="resolution-die-row">
                <span class="resolution-die-main">
                    <span class="resolution-die-badge" title="${escapeHtml(entry.die)} rolled its maximum">
                        <span class="resolution-die-type">${escapeHtml(entry.die)}</span>
                        <span class="resolution-die-label">maxed</span>
                        <span class="resolution-die-roll">${entry.val}</span>
                    </span>
                    <span class="resolution-die-source">${escapeHtml(entry.source)}</span>
                </span>
                ${control}
            </div>
        `;
    }).join('');

    let footer;
    if (paid) {
        const detail = Object.entries(paid.breakdown)
            .map(([key, amount]) => `${amount} ${RESOURCE_LABELS[key] || key}`).join(', ');
        footer = `<p class="resolution-success">Chain cost paid: ${escapeHtml(detail)}.</p>`;
        if (paid.count !== cost.dueCount) {
            footer += `<p class="resolution-warning">Assignments changed after paying (${paid.count} paid, ${cost.dueCount} now used) — settle the difference with the GM.</p>`;
        }
    } else if (cost.dueCount === 0) {
        footer = '<p class="resolution-success">All maxed dice are Unused — no resource cost.</p>';
    } else {
        footer = `<button class="btn btn-outline btn-chain-cost-pay" type="button">Pay ${cost.dueCount} resource${cost.dueCount === 1 ? '' : 's'}</button>`;
    }

    return `
        <div class="freebie-resolution-panel chain-cost-panel" style="margin-top: 0.5rem;">
            <h3>Chain Cost</h3>
            <p class="hint-text">This check uses a chain: each maxed die <em>used</em> costs 1 resource (your choice). Assign a maxed die to Unused to skip its cost.</p>
            ${rows}
            ${footer}
        </div>
    `;
}

async function payChainCost() {
    const result = uiState.lastRollResult;
    if (!result || result.chainCostPaid || !dataManager) return;

    const cost = getChainMaxedDieCost(result, uiState.currentResolutionAssignments);
    const due = cost.entries.filter(entry => entry.used);
    if (due.length === 0) return;

    /** @type {Object<string, string>} */
    const selections = {};
    /** @type {Object<string, number>} */
    const breakdown = {};
    due.forEach(entry => {
        const key = uiState.chainCostSelections[entry.rollId] || 'en';
        selections[entry.rollId] = key;
        breakdown[key] = (breakdown[key] || 0) + 1;
    });

    const state = dataManager.state;
    if (!state.gmOverride) {
        const short = Object.entries(breakdown)
            .filter(([key, amount]) => (parseInt(state[key], 10) || 0) < amount)
            .map(([key, amount]) => `${RESOURCE_LABELS[key]} (need ${amount}, have ${parseInt(state[key], 10) || 0})`);
        if (short.length > 0) {
            showAlert(`Not enough resources for the chain cost: ${short.join(', ')}. Pick different resources or set maxed dice to Unused.`);
            return;
        }
    }

    const detail = Object.entries(breakdown)
        .map(([key, amount]) => `${amount} ${RESOURCE_LABELS[key]}`).join(', ');
    if (!await showConfirm(`Spend ${detail} for ${due.length} maxed ${due.length === 1 ? 'die' : 'dice'} in this chained check?`, { title: 'Pay chain cost?' })) return;

    Object.entries(breakdown).forEach(([key, amount]) => {
        state[key] = Math.max(0, (parseInt(state[key], 10) || 0) - amount);
    });
    dataManager.saveState();
    result.chainCostPaid = { count: due.length, breakdown, selections };
    if (renderAll) renderAll();
    renderResolution();
}

async function rollPostRollFreebie(die) {
    const result = uiState.lastRollResult;
    if (!result || result.freebieUsed || !poolEngine) return;

    if (!die) return;
    // `die` is the base die; in a blast zone the copy rolls as the pushed
    // die (match.die) but is still priced at the base.
    const match = (result.originalRolls || []).find(roll => (roll.baseDie || roll.die) === die);
    if (!match) return;
    const rollAs = match.die;

    const cost = poolEngine.calculateSteps([die]);
    if (cost > 0 && dataManager) {
        const currentEn = parseInt(dataManager.state.en, 10) || 0;
        if (currentEn < cost && !dataManager.state.gmOverride) {
            showAlert(`A Freebie ${die} costs ${cost} Energy, but only ${currentEn} is available.`);
            return;
        }
        const pushNote = rollAs !== die ? ` (rolls as ${rollAs} in the blast zone)` : '';
        if (!await showConfirm(`Spend ${cost} Energy for a Freebie ${die}${pushNote}?`, { title: 'Buy Freebie die?' })) return;
        dataManager.state.en = Math.max(0, currentEn - cost);
        dataManager.saveState();
        if (renderAll) renderAll();
    }

    const rolls = [...(result.originalRolls || []), {
        source: 'Freebie',
        die: rollAs,
        ...(match.baseDie ? { baseDie: match.baseDie } : {}),
        val: poolEngine.rollDie(rollAs)
    }];
    const recalculated = poolEngine.calculateOptimalTotal(rolls, result.adds ?? 2, {
        haywireThreshold: result.haywireThreshold || 1
    });
    Object.assign(result, recalculated);
    result.freebieUsed = true;
    renderResolution();
}

function resolveAmmo(tileId) {
    if (!dataManager || !uiState.lastRollResult) return;
    const selectedRollId = uiState.ammoAssignments[tileId];
    const roll = (uiState.lastRollResult.originalRolls || [])
        .find((candidate, index) => getRollId(candidate, index) === selectedRollId);
    const tile = (dataManager.state.tiles || []).find(candidate => candidate.id === tileId);
    if (!roll || !tile?.ammo) return;

    const supply = Math.max(1, parseInt(tile.ammo.maxSupply, 10) || 1);
    const retained = roll.val >= supply;
    tile.ammo.currentSupply = Math.max(0, (parseInt(tile.ammo.currentSupply, 10) || 0) - 1);
    if (!retained) {
        tile.isBuried = true;
        tile.isBurnt = false;
        tile.ammo.currentSupply = 0;
    }

    dataManager.updateTile(tile);
    uiState.lastRollResult.ammoOptions = (uiState.lastRollResult.ammoOptions || [])
        .filter(option => option.tileId !== tileId);
    delete uiState.ammoAssignments[tileId];
    if (renderAll) renderAll();
    renderResolution();
}

export function renderBonusDetails(details) {
    if (!details.length) return '';
    return `<p><strong>Tag Bonuses:</strong><br>${details.map(detail => escapeHtml(detail)).join('<br>')}</p>`;
}

/** @param {import('../types.js').RollResult} result */
export function calculateResolutionSummary(result) {
    const { totals, usedCount } = calculateAssignedTotals(result, uiState.currentResolutionAssignments);
    const bonusInfo = getResolutionBonusTotals(result, uiState.currentResolutionMode);
    const bonuses = bonusInfo.totals;
    const adds = result.adds ?? 2;
    const warnings = [];
    const plusUsage = RESOLUTION_PLUS_BUCKETS[uiState.currentResolutionMode]
        ? calculateResolutionPlusUsage(result, uiState.currentResolutionMode, uiState.currentResolutionAssignments)
        : null;
    const plusesAreLegal = !plusUsage || plusUsage.used <= plusUsage.budget;

    if (plusUsage && !plusesAreLegal) {
        if (uiState.currentResolutionMode === 'healing') {
            warnings.push(`Too many pluses used: ${plusUsage.used}/${plusUsage.budget}. Move dice out of combined diagnosis/resource totals or assign them to one-at-a-time healing options.`);
        } else {
            warnings.push(`Too many pluses used: ${plusUsage.used}/${plusUsage.budget}. Split dice across ${uiState.currentResolutionMode === 'attack' ? 'Attack/Impact' : 'Evasion/Grit'} differently or move dice to Unused.`);
        }
    } else if (!plusUsage && usedCount > adds) {
        warnings.push(`Too many dice assigned: ${usedCount}/${adds}. Move ${usedCount - adds} die${usedCount - adds === 1 ? '' : 's'} to Unused.`);
    }

    if (uiState.currentResolutionMode === 'attack') {
        const attackTotal = (totals.attack || 0) + bonuses.attack;
        const impactTotal = (totals.impact || 0) + bonuses.impact;
        const targetEvasion = getResolutionNumber('target-evasion');
        const targetSoak = getResolutionNumber('target-soak') || 0;
        const targetGrit = getResolutionNumber('target-grit') || 0;
        const crits = getResolutionText('attack-crits');
        const lines = [
            `<p><strong>Attack:</strong> ${attackTotal} (${totals.attack || 0} dice + ${bonuses.attack} bonus)</p>`,
            `<p><strong>Impact:</strong> ${impactTotal} HP (${totals.impact || 0} dice + ${bonuses.impact} bonus)</p>`,
            `<p><strong>Pluses Used:</strong> ${plusUsage?.used ?? 0}/${plusUsage?.budget ?? 0}</p>`
        ];

        if (!plusesAreLegal) {
            lines.push('<p class="resolution-warning">Reduce plus use before resolving attack.</p>');
        } else if (targetEvasion !== null) {
            const hit = attackTotal >= targetEvasion;
            lines.push(`<p class="${hit ? 'resolution-success' : 'resolution-warning'}">${hit ? 'Hit' : 'Miss'} vs target evasion ${targetEvasion}.</p>`);

            if (hit) {
                const hpLoss = Math.max(0, impactTotal - targetSoak);
                const critsApply = crits && hpLoss > targetGrit;
                lines.push(`<p><strong>After Soak:</strong> ${hpLoss} HP (${impactTotal} impact - ${targetSoak} soak).</p>`);
                lines.push(`<p><strong>Grit Check:</strong> ${targetGrit} grit ${hpLoss > targetGrit ? 'does not prevent crits' : 'prevents crits'}.</p>`);
                if (crits) lines.push(`<p><strong>Crits:</strong> ${escapeHtml(crits)} ${critsApply ? 'apply' : 'do not apply'}.</p>`);
            }
        }

        const extension = getRangeExtensionResults(result, uiState.currentResolutionAssignments);
        if (extension.entries.length > 0) {
            const detail = extension.entries
                .map(entry => `${entry.val} vs ${entry.threshold} ${entry.success ? '✓' : '✗'}`)
                .join(', ');
            lines.push(`<p><strong>Range/Duration:</strong> ${detail} → ${extension.increments} increment${extension.increments === 1 ? '' : 's'} on the Space &amp; Time table. One use; Instant, Sustain, and Rite durations cannot be modified.</p>`);
        }

        return {
            headline: `Attack ${attackTotal} / Impact ${impactTotal}`,
            html: lines.join('') + renderBonusDetails(bonusInfo.details),
            warnings
        };
    }

    if (uiState.currentResolutionMode === 'defense') {
        const evasionTotal = (totals.evasion || 0) + bonuses.evasion;
        // Core adds its current value to Grit (p.64) - automatic for any
        // character whose tiles grant a Core pool.
        const coreGrit = calculateCoreMax(dataManager?.state?.tiles || []) > 0
            ? Math.max(0, parseInt(dataManager.state.core, 10) || 0)
            : 0;
        const gritTotal = (totals.grit || 0) + bonuses.grit + coreGrit;
        const otherSoak = getResolutionNumber('defense-soak') || 0;
        const calledArmor = getCalledArmorSoak(result);
        const soakTotal = otherSoak + bonuses.soak + calledArmor.total;
        const incomingAttack = getResolutionNumber('incoming-attack');
        const incomingImpact = getResolutionNumber('incoming-impact') || 0;
        const incomingCrits = parseCritList(getResolutionText('incoming-crits'));
        const armorSoakText = calledArmor.sources.length
            ? ` + ${calledArmor.total} called armor (${calledArmor.sources.map(source => source.tileName).join(', ')})`
            : '';
        const coreGritText = coreGrit > 0 ? ` + ${coreGrit} Core` : '';
        const lines = [
            `<p><strong>Evasion:</strong> ${evasionTotal} (${totals.evasion || 0} dice + ${bonuses.evasion} bonus)</p>`,
            `<p><strong>Grit:</strong> ${gritTotal} (${totals.grit || 0} dice + ${bonuses.grit} bonus${coreGritText})</p>`,
            `<p><strong>Soak:</strong> ${soakTotal} (${otherSoak} other + ${bonuses.soak} bonus${escapeHtml(armorSoakText)})</p>`,
            `<p><strong>Pluses Used:</strong> ${plusUsage?.used ?? 0}/${plusUsage?.budget ?? 0}</p>`
        ];

        const activeJolts = normalizeActiveCrits(dataManager?.state?.activeCrits).jolt || 0;
        if (activeJolts > 0) {
            lines.push(`<p class="resolution-warning">JOLT active ×${activeJolts}: reduce Grit by 3 each on this defense, then clear the JOLT from the Condition panel.</p>`);
        }

        if (!plusesAreLegal) {
            lines.push('<p class="resolution-warning">Reduce plus use before resolving defense.</p>');
        } else if (incomingAttack !== null) {
            const missed = evasionTotal > incomingAttack;
            lines.push(`<p class="${missed ? 'resolution-success' : 'resolution-warning'}">${missed ? 'Attack misses' : 'Attack hits'} vs incoming attack ${incomingAttack}.</p>`);

            if (!missed) {
                const hpLoss = Math.max(0, incomingImpact - soakTotal);
                const critsApply = incomingCrits.length > 0 && hpLoss > gritTotal;
                lines.push(`<p><strong>After Soak:</strong> ${hpLoss} HP (${incomingImpact} impact - ${soakTotal} soak).</p>`);
                lines.push(`<p><strong>Grit Check:</strong> ${gritTotal} grit ${hpLoss > gritTotal ? 'does not prevent crits' : 'prevents crits'}.</p>`);
                if (critsApply) {
                    const shields = getActiveDefenseShields();
                    const { blocked, remaining } = applyShieldsToCrits(incomingCrits, shields.crits);
                    if (blocked.length > 0) {
                        lines.push(`<p><strong>Shields Block:</strong> ${escapeHtml(blocked.map(crit => crit.toUpperCase()).join(', '))}.</p>`);
                    }
                    lines.push(remaining.length > 0
                        ? `<p class="resolution-warning"><strong>Crits That Land:</strong> ${escapeHtml(remaining.map(crit => crit.toUpperCase()).join(', '))}.</p>`
                        : '<p class="resolution-success"><strong>Crits:</strong> all blocked by Shield tags.</p>');
                } else if (incomingCrits.length > 0) {
                    lines.push(`<p><strong>Crits:</strong> ${escapeHtml(incomingCrits.map(crit => crit.toUpperCase()).join(', '))} do not apply.</p>`);
                }
            }
        }

        return {
            headline: `Evasion ${evasionTotal} / Grit ${gritTotal}`,
            html: lines.join('') + renderBonusDetails(bonusInfo.details),
            warnings
        };
    }

    if (uiState.currentResolutionMode === 'healing') {
        const diagnosisTotal = (totals.diagnosis || 0) + bonuses.diagnosis;
        const healingAssignments = getHealingAssignments(result, uiState.currentResolutionAssignments);
        const healingEntries = Object.values(healingAssignments);
        const spareCount = healingEntries.reduce((sum, entry) => sum + entry.count, 0);
        const baseDifficulty = healingEntries.reduce((max, entry) => Math.max(max, entry.difficulty), 0);
        const difficulty = baseDifficulty + (spareCount * 2) + (uiState.healingInCombat ? 4 : 0);
        const succeeds = plusesAreLegal && spareCount > 0 && diagnosisTotal >= difficulty;
        const lines = [
            `<p><strong>Diagnosis:</strong> ${diagnosisTotal} (${totals.diagnosis || 0} dice + ${bonuses.diagnosis} bonus)</p>`,
            `<p><strong>Pluses Used:</strong> ${plusUsage?.used ?? 0}/${plusUsage?.budget ?? 0}</p>`
        ];

        if (spareCount === 0) {
            lines.push('<p>No treatment dice assigned.</p>');
        } else if (!plusesAreLegal) {
            lines.push('<p class="resolution-warning">Reduce plus use before resolving treatment.</p>');
        } else {
            lines.push(`<p><strong>Difficulty:</strong> ${difficulty} (${baseDifficulty} base + ${spareCount * 2} from ${spareCount} treatment dice${uiState.healingInCombat ? ' + 4 combat' : ''}).</p>`);
            lines.push(`<p class="${succeeds ? 'resolution-success' : 'resolution-warning'}">${succeeds ? 'Treatment succeeds' : 'Treatment fails'}.</p>`);
            healingEntries.forEach(entry => {
                if (entry.kind === 'resource') {
                    lines.push(`<p><strong>${entry.label}:</strong> restore ${entry.amount} if successful.</p>`);
                } else {
                    lines.push(`<p><strong>${entry.label}:</strong> restore/reduce ${entry.count} if successful.</p>`);
                }
            });
        }

        return {
            headline: `Diagnosis ${diagnosisTotal}`,
            html: lines.join('') + renderBonusDetails(bonusInfo.details),
            warnings
        };
    }

    const actionTotal = (totals.action || 0) + bonuses.action;
    return {
        headline: String(actionTotal),
        html: `<p><strong>Action Total:</strong> ${actionTotal} (${totals.action || 0} dice + ${bonuses.action} bonus)</p>${renderBonusDetails(bonusInfo.details)}`,
        warnings
    };
}

/** @param {import('../types.js').RollResult} result */
export function renderRollGroups(result) {
    const groups = {};
    (result.originalRolls || []).forEach(r => {
        if (!groups[r.source]) groups[r.source] = [];
        groups[r.source].push(`<strong>${escapeHtml(r.die)}:</strong> ${r.val}`);
    });

    return Object.entries(groups).map(([source, rolls]) => {
        return `<div style="margin-top: 4px; padding-left: 10px; border-left: 2px solid var(--glass-border);"><em>${escapeHtml(source)}</em>: ${rolls.join(' | ')}</div>`;
    }).join('');
}

export function renderResolutionDetails() {
    if (!uiState.lastRollResult) return;

    const result = uiState.lastRollResult;
    const summary = calculateResolutionSummary(result);
    const notices = [];
    if (result.isTestRoll) {
        notices.push('<div class="result-notice">TEST ROLL: this roll was not saved to campaign history.</div>');
    }
    if (result.isHaywire) {
        const haywireText = result.haywireThreshold === 2
            ? 'HAYWIRE! More than half the dice rolled 1 or 2 (Glitch).'
            : 'HAYWIRE! More than half the dice rolled 1.';
        const pressText = result.pressCounterBumped
            ? ` Press counter raised to ${result.pressCounterBumped}.`
            : '';
        notices.push(`<div class="result-notice result-notice-haywire">${haywireText}${pressText}</div>`);
    }
    if ((result.woundPenalty || 0) > 0) {
        notices.push(`<div class="result-notice">WOUND: -${result.woundPenalty} applied to this check's totals (all checks at -3 per active WOUND).</div>`);
    }
    const calledIds = new Set(result.calledTileIds || []);
    const calledTiles = (dataManager?.state?.tiles || []).filter(tile => calledIds.has(tile.id));
    // BLEED (p.43): called tiles are burned. Hitched tiles cannot be burned.
    const bleedCount = normalizeActiveCrits(dataManager?.state?.activeCrits).bleed || 0;
    if (bleedCount > 0 && calledTiles.length > 0) {
        const bleedable = calledTiles.filter(tile => !tile.isBurnt && !isHitchedTile(tile));
        if (bleedable.length > 0) {
            const names = bleedable.map(tile => escapeHtml(tile.name || 'Unnamed tile')).join(', ');
            notices.push(`<div class="result-notice">BLEED ×${bleedCount}: called tiles are burned — ${names}. <button type="button" class="btn btn-outline btn-bleed-burn">Burn them</button></div>`);
        }
    }
    const calledHinder = calledTiles.find(isHinderTile);
    if (calledHinder) {
        notices.push(`<div class="result-notice">Hinder (${escapeHtml(calledHinder.name)}): nonlethal verbal attack — impact drains Energy or Reflex per its assault type, not Health. Defenders resist with Guile/Menace/Presence/Reason/Wiles, but not the attacking skill.</div>`);
    }
    if (result.isHaywire && calledTiles.some(tile => tileHasMechanicalTag(tile, 'gizmo'))) {
        notices.push('<div class="result-notice">Haywire with a gizmo in the check: the gizmo may BREAK (it has ▟ HP; GM call).</div>');
    }
    const titanRerolls = result.titanRerolls || [];
    if (titanRerolls.length > 0) {
        notices.push(`<div class="result-notice">Titan reroll: ${titanRerolls.map(r => `${escapeHtml(r.die)} ${r.from}→${r.to}`).join(', ')}.</div>`);
    } else if (result.titanActive && result.titanManualReminder) {
        notices.push('<div class="result-notice">Titan active: reroll any physical die that rolled below its ▟ (d6 on 1, d8 on 1-2, ...) and enter the new values.</div>');
    }
    const chainCost = getChainMaxedDieCost(result, uiState.currentResolutionAssignments);
    if (chainCost.dueCount > 0 && !result.chainCostPaid) {
        notices.push(`<div class="result-notice">Chain cost: ${chainCost.dueCount} maxed ${chainCost.dueCount === 1 ? 'die is' : 'dice are'} used in this chained check — pay 1 resource each (Health, Energy, Reflex, or Shadow) in the Chain Cost panel, or set the ${chainCost.dueCount === 1 ? 'die' : 'dice'} to Unused.</div>`);
    }
    els.resultNotices.innerHTML = notices.join('');

    els.resultTotal.innerText = summary.headline;
    els.resultDetails.innerHTML = `
        <div style="margin-bottom: 0.5rem; color: #a0aab5;">
            <p style="margin: 0; text-decoration: underline;">All Rolls by Source:</p>
            ${renderRollGroups(result)}
        </div>
        <div class="resolution-summary">
            ${summary.html}
        </div>
    `;
}

export function renderResolution() {
    if (!uiState.lastRollResult) return;

    const result = uiState.lastRollResult;
    const { usedCount } = calculateAssignedTotals(result, uiState.currentResolutionAssignments);
    const adds = result.adds ?? 2;
    const summary = calculateResolutionSummary(result);
    const warningHtml = summary.warnings.map(warning => `<p class="resolution-warning">${escapeHtml(warning)}</p>`).join('');

    els.resolutionControls.innerHTML = `
        <div class="resolution-toolbar">
            <div class="resolution-field">
                <label for="resolution-mode">Resolution</label>
                <select id="resolution-mode">${renderResolutionModeOptions()}</select>
            </div>
            ${renderResolutionUsageFields(result, usedCount, adds)}
        </div>
        ${renderResolutionExtraFields()}
        <div class="resolution-assignments">
            <label>Assign Rolled Dice</label>
            ${renderResolutionAssignments(result)}
        </div>
        ${renderChainCostPanel(result)}
        ${renderAmmoResolution(result)}
        ${renderFreebiePanel(result)}
        ${renderTitanResolutionPanel(result)}
        ${warningHtml}
    `;

    renderResolutionDetails();
}

/** @param {import('../types.js').RollResult} result */
export function showResults(result) {
    uiState.lastRollResult = result;
    uiState.currentResolutionMode = 'action';
    uiState.currentResolutionAssignments = getDefaultResolutionAssignments(result, uiState.currentResolutionMode);
    uiState.ammoAssignments = {};
    uiState.chainCostSelections = {};
    uiState.healingInCombat = false;
    els.rollResults.style.display = 'block';
    renderResolution();
    
    setTimeout(() => {
        const dash = document.getElementById('action-dashboard');
        if (dash && window.getComputedStyle(dash).overflowY === 'auto') {
            dash.scrollTo({ top: dash.scrollHeight, behavior: 'smooth' });
        } else {
            els.rollResults.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, 50);
}
