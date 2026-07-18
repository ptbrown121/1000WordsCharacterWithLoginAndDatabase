// @ts-check
import {
    adjustAberrationForShadowUse,
    classifyAberration,
    escapeHtml,
    getDiceValidationMessage,
    getTileBoxes,
    getShadowTagCounts,
    isHitchedTile,
    parseDiceInput,
    RESOURCE_LABELS
} from '../pool.js';
import { COLOR_HEX } from '../data.js';
import {
    getBurnTileChoices,
    getCallTileChoices,
    getCompatibleBurnTiles,
    getSharedTileCallColors
} from '../pool-tile-selection.js';
import { resolvePoolAssistantSelection } from '../pool-assistant.js';
import { getWoundPenalty } from '../status-rules.js';
import { uiState } from '../state.js';
import { els } from '../els.js';
import { showResults } from './resolution.js';
import { renderCondition } from './condition.js';
import { renderArmorSoak } from './armorSoak.js';
import { updateShadowMax } from './vitals.js';
import { renderRulesReview } from './rulesReview.js';
import { showAlert, showConfirm } from './dialogService.js';

/** @type {import('../data.js').DataManager} */
let dataManager;
/** @type {import('../pool.js').PoolEngine} */
let poolEngine;
/** @type {() => void} */
let renderAll;
/** @type {() => void} */
let renderCards;
/** @type {'call'|'burn'|null} */
let tilePickerMode = null;

const RESOURCE_INPUTS = {
    hp: 'valHp',
    en: 'valEn',
    rx: 'valRx',
    sh: 'valSh'
};

/** @param {import('../types.js').AppDependencies} deps */
export function init(deps) {
    dataManager = deps.dataManager;
    poolEngine = deps.poolEngine;
    renderAll = deps.renderAll;
    renderCards = deps.renderCards;

    els.callColor1.addEventListener('change', syncCallColorsFromLegacySelects);
    els.callColor2.addEventListener('change', syncCallColorsFromLegacySelects);
    els.callColorOptions.forEach(button => {
        button.addEventListener('click', () => {
            if (button.dataset.value) toggleCallColor(button.dataset.value);
        });
    });
    syncCallColorButtons();
    els.btnClearCall?.addEventListener('click', clearCallSelection);
    // X buttons on the pool badges (finer-grained than Clear, which wipes
    // colors and all tiles at once).
    /** @param {Event} e */
    const handleBadgeClear = (e) => {
        const button = e.target instanceof Element ? e.target.closest('.badge-clear') : null;
        if (!(button instanceof HTMLButtonElement)) return;
        const tileId = button.dataset.tileId;
        if (button.dataset.clear === 'call') {
            uiState.callTile = null;
        } else if (button.dataset.clear === 'hitch') {
            uiState.hitchCallTiles = uiState.hitchCallTiles.filter(t => t.id !== tileId);
        } else if (button.dataset.clear === 'burn') {
            uiState.burnTiles = uiState.burnTiles.filter(t => t.id !== tileId);
        }
        renderCards();
        updatePoolPreview();
    };
    els.callTileZone?.addEventListener('click', handleBadgeClear);
    els.burnTilesZone?.addEventListener('click', handleBadgeClear);
    els.btnPickCallTile.addEventListener('click', () => openPoolTilePicker('call'));
    els.btnPickBurnTiles.addEventListener('click', () => openPoolTilePicker('burn'));
    els.btnPoolTilePickerClose.addEventListener('click', closePoolTilePicker);
    els.poolTilePickerModal.addEventListener('click', event => {
        if (event.target === els.poolTilePickerModal) closePoolTilePicker();
    });
    els.poolTilePickerChoices.addEventListener('click', handlePoolTileChoice);
    els.extraDiceInput.addEventListener('input', () => {
        syncExtraDiceChips();
        updatePoolPreview();
    });
    els.extraDiceButtons?.addEventListener('click', (e) => {
        const button = e.target instanceof Element ? e.target.closest('.dice-add-btn') : null;
        if (!(button instanceof HTMLButtonElement) || !els.extraDiceButtons.contains(button)) return;
        if (button.dataset.die) addExtraDie(button.dataset.die);
    });
    els.risenAberrantEffect?.addEventListener('change', updatePoolPreview);
    els.fallenAberrantEffect?.addEventListener('change', updatePoolPreview);
    els.freebieDieSelect?.addEventListener('change', updatePoolPreview);
    els.freebieDieButtons?.addEventListener('click', (e) => {
        const button = e.target instanceof Element ? e.target.closest('.freebie-die-btn') : null;
        if (!(button instanceof HTMLButtonElement) || !els.freebieDieButtons.contains(button)) return;
        const die = button.dataset.die || '';
        const select = els.freebieDieSelect;
        if (!select) return;
        // Tapping the active die deselects it, like picking None.
        select.value = select.value === die ? '' : die;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    els.chainOptions.addEventListener('change', (e) => {
        const target = e.target;
        if (target instanceof HTMLInputElement && target.classList.contains('chain-cb')) {
            const chainId = target.dataset.chainId;
            if (!chainId) return;
            if (target.checked) {
                uiState.disabledChainIds.delete(chainId);
            } else {
                uiState.disabledChainIds.add(chainId);
            }
            updatePoolPreview();
            return;
        }
        if (target instanceof HTMLSelectElement && target.classList.contains('chain-color-select')) {
            const chainId = target.dataset.chainId;
            if (!chainId) return;
            const color = target.value;
            if (color) {
                uiState.chainColorSelections[chainId] = color;
            } else {
                delete uiState.chainColorSelections[chainId];
            }
            uiState.disabledChainIds.delete(chainId);
            updatePoolPreview();
        }
    });
    els.tagBonusOptions.addEventListener('change', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLInputElement) || !target.classList.contains('tag-bonus-cb')) return;
        const bonusId = target.dataset.bonusId;
        if (!bonusId) return;
        if (target.checked) {
            uiState.selectedTagBonusIds.add(bonusId);
        } else {
            uiState.selectedTagBonusIds.delete(bonusId);
        }
        updatePoolPreview();
    });

    els.radioModes.forEach(r => {
        r.addEventListener('change', (e) => {
            const target = /** @type {HTMLInputElement} */ (e.currentTarget);
            if (target.value === 'virtual') {
                els.virtualSection.style.display = 'block';
                els.manualSection.style.display = 'none';
            } else {
                els.virtualSection.style.display = 'none';
                els.manualSection.style.display = 'block';
                renderManualInputs();
            }
        });
    });

    els.btnRoll.addEventListener('click', executeVirtualRoll);
    els.btnCalculate.addEventListener('click', executeManualCalculate);
}

function handleCallColorChange() {
    syncCallColorButtons();
    updatePoolPreview();
    if (els.autoFilterCall.checked) renderCards();
}

function getSelectedCallColors() {
    return [...new Set((uiState.callColors || []).filter(Boolean))];
}

function isTestRoll() {
    return Boolean(els.testRollToggle?.checked);
}

function selectedRollMode() {
    const selected = document.querySelector('input[name="roll-mode"]:checked');
    return selected instanceof HTMLInputElement ? selected.value : 'virtual';
}

/** @param {import('../types.js').RollResult} result @param {import('../types.js').CompiledPool} compiledPool @param {string} mode @param {string[]} callColors */
function buildRollLog(result, compiledPool, mode, callColors) {
    const allTiles = dataManager.state.tiles || [];
    const tileById = new Map(allTiles.map(tile => [tile.id, tile]));
    const calledTileIds = [...new Set(compiledPool.calledTileIds || [])];
    return {
        isTest: isTestRoll(),
        mode,
        callColors,
        calledTileIds,
        calledTiles: calledTileIds.map(id => {
            const tile = tileById.get(id);
            return {
                id,
                name: tile?.name || 'Unknown tile',
                type: tile?.type || '',
                colors: tile?.colors || []
            };
        }),
        burnTileIds: (uiState.burnTiles || []).map(tile => tile.id).filter(Boolean),
        hitchTileIds: (uiState.hitchCallTiles || []).map(tile => tile.id).filter(Boolean),
        total: result.total || 0,
        adds: result.adds || 0,
        flatBonus: result.flatBonus || 0,
        haywire: Boolean(result.isHaywire)
    };
}

/** @param {import('../types.js').RollResult} result @param {import('../types.js').CompiledPool} compiledPool @param {string} mode @param {string[]} callColors */
function finalizeRoll(result, compiledPool, mode, callColors) {
    const testRoll = isTestRoll();
    result.isTestRoll = testRoll;
    showResults(result);

    if (!testRoll) {
        dataManager.recordRollLog(buildRollLog(result, compiledPool, mode, callColors));
    }

    // A Haywire raises later Press costs just like a Press does (p.37), so
    // bump the per-fight counter automatically. Test rolls don't count, and
    // the Condition panel's Reset clears it at the end of the fight.
    if (result.isHaywire && !testRoll) {
        dataManager.state.pressCount = (parseInt(dataManager.state.pressCount, 10) || 0) + 1;
        result.pressCounterBumped = dataManager.state.pressCount;
        dataManager.saveState();
        renderCondition();
    }

    applyAberrationForShadowUse(compiledPool.shadowUse);
    processBurns();

    // Freebies are once per test: clear the pre-roll selection so the next
    // roll does not silently charge Energy again.
    if (els.freebieDieSelect && els.freebieDieSelect.value) {
        els.freebieDieSelect.value = '';
        updatePoolPreview();
    }
}

/** @param {string[]} colors */
function syncLegacyCallColorSelects(colors) {
    els.callColor1.value = colors[0] || '';
    els.callColor2.value = colors[1] || '';
}

function syncCallColorsFromLegacySelects() {
    uiState.callColors = [...new Set([els.callColor1.value, els.callColor2.value].filter(Boolean))];
    handleCallColorChange();
}

/** @param {string[]} colors */
export function setCallColors(colors) {
    const uniqueColors = [...new Set(colors.filter(Boolean))];
    uiState.callColors = uniqueColors;
    syncLegacyCallColorSelects(uniqueColors);
    handleCallColorChange();
}

/**
 * Atomically replace the transient Call selection with a validated assistant
 * suggestion. The assistant never rolls or spends resources; this only fills
 * the same controls the player can already operate by hand.
 * @param {unknown} rawSuggestion
 */
export function applyPoolAssistantSelection(rawSuggestion) {
    const resolved = resolvePoolAssistantSelection(rawSuggestion, dataManager.state.tiles || []);
    if (!resolved.valid || resolved.suggestion.status !== 'ready' || !resolved.callTile) {
        throw new Error(resolved.errors[0] || 'The assistant suggestion is not ready to apply.');
    }

    uiState.callColors = [...resolved.suggestion.callColors];
    uiState.callTile = resolved.callTile;
    uiState.hitchCallTiles = [];
    uiState.burnTiles = [...resolved.burnTiles];
    uiState.disabledChainIds.clear();
    uiState.chainColorSelections = {};
    uiState.selectedTagBonusIds.clear();
    syncLegacyCallColorSelects(uiState.callColors);
    syncCallColorButtons();
    renderCards();
    updatePoolPreview();
    if (els.autoFilterCall.checked) renderCards();
}

/** @param {string} color */
function toggleCallColor(color) {
    if (!color) return;
    const selected = getSelectedCallColors();
    if (selected.includes(color)) {
        setCallColors(selected.filter(current => current !== color));
        return;
    }
    setCallColors([...selected, color]);
}

function syncCallColorButtons() {
    const selected = new Set(getSelectedCallColors());
    els.callColorOptions.forEach(button => {
        const active = selected.has(button.dataset.value || '');
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (els.callColorWarning) {
        const isCustomRoll = selected.size > 2;
        els.callColorWarning.hidden = !isCustomRoll;
        els.callColorWarning.textContent = isCustomRoll
            ? 'Custom roll: more than 2 Call colors selected. Confirm this with the GM.'
            : '';
    }
}

function getExtraDiceTokens() {
    return els.extraDiceInput.value
        .split(',')
        .map(token => token.trim())
        .filter(Boolean);
}

/** @param {string[]} tokens */
function setExtraDiceTokens(tokens) {
    els.extraDiceInput.value = tokens.join(', ');
    els.extraDiceInput.dispatchEvent(new Event('input', { bubbles: true }));
}

/** @param {string} die */
function addExtraDie(die) {
    setExtraDiceTokens([...getExtraDiceTokens(), die]);
}

function syncExtraDiceChips() {
    if (!els.extraDiceSelected) return;
    els.extraDiceSelected.innerHTML = '';

    getExtraDiceTokens().forEach((die, index) => {
        const chip = document.createElement('span');
        chip.className = 'dice-selected-chip';

        const label = document.createElement('span');
        label.textContent = die;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'dice-remove-btn';
        removeBtn.textContent = 'x';
        removeBtn.title = `Remove ${die}`;
        removeBtn.setAttribute('aria-label', `Remove ${die}`);
        removeBtn.addEventListener('click', () => {
            const nextTokens = getExtraDiceTokens();
            nextTokens.splice(index, 1);
            setExtraDiceTokens(nextTokens);
        });

        chip.appendChild(label);
        chip.appendChild(removeBtn);
        els.extraDiceSelected.appendChild(chip);
    });
}

function getSelectedFreebieDie() {
    return els.freebieDieSelect?.value || '';
}

// Refresh the Freebie options from the compiled pool: a freebie must
// duplicate a die already present, so only those dice are offered. Inside
// an Aberrant Blast Zone the offer is the pre-push base die (baseDie) at
// the base cost — the zone then pushes the copy for free (GM-pending
// ruling 2026-06-12; may cost more in a later update). The current
// selection survives when its die is still in the pool. The hidden
// select stays the value holder; the buttons mirror it.
/** @param {import('../types.js').PoolDie[]} [poolDice] */
function syncFreebieOptions(poolDice = []) {
    const select = els.freebieDieSelect;
    if (!select) return;

    const current = select.value;
    const poolEntries = poolDice.filter(entry => entry.source !== 'Freebie');
    const pushedTo = {};
    poolEntries.forEach(entry => {
        if (entry.baseDie && entry.baseDie !== entry.die) pushedTo[entry.baseDie] = entry.die;
    });
    const distinctDice = [...new Set(poolEntries.map(entry => entry.baseDie || entry.die))]
        .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));

    const labelFor = (die) => {
        const cost = poolEngine.calculateSteps([die]);
        const push = pushedTo[die] ? `→${pushedTo[die]}` : '';
        return `${die}${push} (${cost} EN)`;
    };

    select.innerHTML = '<option value="">None</option>' + distinctDice.map(die =>
        `<option value="${escapeHtml(die)}">${escapeHtml(labelFor(die))}</option>`
    ).join('');
    select.value = distinctDice.some(die => die === current) ? current : '';

    if (els.freebieDieButtons) {
        els.freebieDieButtons.innerHTML = ['', ...distinctDice].map(die => {
            const isActive = die === select.value;
            const label = die ? escapeHtml(labelFor(die)) : 'None';
            return `<button type="button" class="dice-add-btn freebie-die-btn${isActive ? ' active' : ''}" data-die="${escapeHtml(die)}" aria-pressed="${isActive}">${label}</button>`;
        }).join('');
    }
}

export function clearCallSelection() {
    setCallColors([]);
    uiState.callTile = null;
    uiState.hitchCallTiles = [];
    uiState.burnTiles = [];
    uiState.disabledChainIds.clear();
    uiState.chainColorSelections = {};
    uiState.selectedTagBonusIds.clear();
    renderCards();
    updatePoolPreview();
}

export function getExtraDice() {
    syncExtraDiceChips();
    const val = els.extraDiceInput.value.trim();
    const { dice, invalid } = parseDiceInput(val);
    return {
        dice,
        error: invalid.length > 0 ? getDiceValidationMessage('Extra dice') : null
    };
}

export function getPoolOptions() {
    const maxShadow = poolEngine.calculateResourceMaxes(dataManager.state.tiles || []).sh;
    const alignmentStates = classifyAberration(
        dataManager.state.aberration || 0,
        maxShadow,
        getShadowTagCounts(dataManager.state.tiles || [])
    );
    return {
        hitchCallTiles: [...(uiState.hitchCallTiles || [])],
        disabledChainIds: new Set(uiState.disabledChainIds),
        chainColorSelections: { ...(uiState.chainColorSelections || {}) },
        freebieDie: getSelectedFreebieDie(),
        aberrantEffects: {
            risen: alignmentStates.includes('Risen Aberrant') || Boolean(els.risenAberrantEffect?.checked),
            fallen: alignmentStates.includes('Fallen Aberrant') || Boolean(els.fallenAberrantEffect?.checked)
        }
    };
}

/** @param {string[]} [calledTileIds] */
function getAmmoResolutionOptions(calledTileIds = []) {
    const calledIds = new Set(calledTileIds);
    return (dataManager.state.tiles || [])
        .filter(tile => tile.type === 'Gear' && tile.gearSubtype === 'Ammo' && tile.ammo && !tile.isBuried)
        .filter(tile => (parseInt(tile.ammo.currentSupply, 10) || 0) > 0)
        .filter(tile => !tile.ammo.targetTileId || calledIds.has(tile.ammo.targetTileId))
        .map(tile => ({
            tileId: tile.id,
            name: tile.name,
            targetName: tile.ammo.targetName || '',
            currentSupply: parseInt(tile.ammo.currentSupply, 10) || 0,
            supply: Math.max(1, parseInt(tile.ammo.maxSupply, 10) || 1),
            linked: Boolean(tile.ammo.targetTileId),
            xpCost: parseInt(tile.xpCost, 10) || 0
        }));
}

/** @param {import('../types.js').ResourceCost[]} [resourceCosts] */
async function applyResourceCosts(resourceCosts = []) {
    const totals = resourceCosts.reduce((acc, cost) => {
        const resource = cost.resource;
        const amount = parseInt(String(cost.amount), 10) || 0;
        if (!resource || amount <= 0) return acc;
        acc[resource] = (acc[resource] || 0) + amount;
        return acc;
    }, {});
    const entries = Object.entries(totals).filter(([, amount]) => amount > 0);

    if (entries.length === 0) return true;

    const costText = resourceCosts
        .map(cost => `${cost.sourceTileName} (${cost.reason || 'cost'}: ${cost.amount} ${RESOURCE_LABELS[cost.resource] || cost.resource.toUpperCase()})`)
        .join(', ');

    for (const [resource, amount] of entries) {
        const current = parseInt(dataManager.state[resource], 10) || 0;
        if (current < amount && !dataManager.state.gmOverride) {
            showAlert(`Calling ${costText} requires ${amount} ${RESOURCE_LABELS[resource] || resource.toUpperCase()}, but only ${current} is available.`);
            return false;
        }
    }

    const spend = await showConfirm(`Calling ${costText}. Spend these resources now?`, { title: 'Spend call resources?' });
    if (!spend) return false;

    entries.forEach(([resource, amount]) => {
        const current = parseInt(dataManager.state[resource], 10) || 0;
        dataManager.state[resource] = Math.max(0, current - amount);
        const input = els[RESOURCE_INPUTS[resource]];
        if (input) input.value = dataManager.state[resource];
    });
    dataManager.saveState();
    if (renderAll) renderAll();
    return true;
}

/** @param {'Qi'|'Id'|null} shadowUse */
function applyAberrationForShadowUse(shadowUse) {
    if (!shadowUse) return;
    dataManager.state.aberration = adjustAberrationForShadowUse(dataManager.state.aberration, shadowUse);
    dataManager.saveState();
    updateShadowMax();
    renderRulesReview();
}

/** @param {import('../types.js').ChainOption[]} [chainOptions] */
export function renderChainOptions(chainOptions = []) {
    const validIds = new Set(chainOptions.map(chain => chain.id));
    uiState.disabledChainIds = new Set(
        Array.from(uiState.disabledChainIds).filter(id => validIds.has(id))
    );
    uiState.chainColorSelections = Object.fromEntries(
        Object.entries(uiState.chainColorSelections || {}).filter(([id]) => validIds.has(id))
    );

    els.chainOptions.innerHTML = '';

    if (chainOptions.length === 0) {
        els.chainPanel.hidden = true;
        return;
    }

    els.chainPanel.hidden = false;

    chainOptions.forEach(chain => {
        const option = document.createElement('label');
        const isBlocked = chain.enabled && ['blocked', 'missing', 'needs-color'].includes(chain.status);
        option.className = `chain-option${isBlocked ? ' chain-blocked' : ''}`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'chain-cb';
        checkbox.dataset.chainId = chain.id;
        checkbox.checked = !uiState.disabledChainIds.has(chain.id);

        const main = document.createElement('span');
        main.className = 'chain-main';

        const title = document.createElement('span');
        title.className = 'chain-title';
        title.textContent = `${chain.sourceTileName} -> ${chain.targetTileName}`;

        const context = document.createElement('span');
        context.className = 'chain-context';
        const selectedColor = chain.selectedColor || uiState.chainColorSelections[chain.id] || '';
        context.textContent = chain.enabled
            ? selectedColor
                ? `Chaining on ${selectedColor}; grants its dice plus one Add`
                : 'Called with the source tile and grants its dice plus one Add'
            : 'Suppressed for this roll';

        if (chain.enabled && chain.requiresColorChoice && (chain.availableColors || []).length > 1) {
            const colorSelect = document.createElement('select');
            colorSelect.className = 'chain-color-select';
            colorSelect.dataset.chainId = chain.id;
            colorSelect.setAttribute('aria-label', `Choose chain color for ${chain.sourceTileName} to ${chain.targetTileName}`);

            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '-- Chain color --';
            colorSelect.appendChild(placeholder);

            chain.availableColors.forEach(color => {
                const optionEl = document.createElement('option');
                optionEl.value = color;
                optionEl.textContent = color;
                colorSelect.appendChild(optionEl);
            });
            colorSelect.value = selectedColor || '';
            main.appendChild(colorSelect);
        }

        const status = document.createElement('span');
        status.className = `chain-status chain-status-${chain.status}`;
        status.textContent = chain.enabled ? 'On' : 'Off';
        if (chain.status === 'missing') status.textContent = 'Missing';
        if (chain.status === 'blocked') status.textContent = 'Blocked';
        if (chain.status === 'needs-color') status.textContent = 'Choose Color';

        main.appendChild(title);
        main.appendChild(context);
        option.appendChild(checkbox);
        option.appendChild(main);
        option.appendChild(status);
        els.chainOptions.appendChild(option);
    });
}

/** @param {import('../types.js').TagBonus[]} [tagBonuses] */
export function getSelectedTagBonuses(tagBonuses = []) {
    return tagBonuses.filter(bonus => uiState.selectedTagBonusIds.has(bonus.id));
}

/** @param {import('../types.js').TagBonus[]} [tagBonuses] */
export function calculateSelectedTagBonus(tagBonuses = []) {
    return getSelectedTagBonuses(tagBonuses)
        .reduce((sum, bonus) => sum + bonus.steps, 0);
}

/** @param {import('../types.js').TagBonus[]} [tagBonuses] */
export function renderTagBonusOptions(tagBonuses = []) {
    const validIds = new Set(tagBonuses.map(bonus => bonus.id));
    uiState.selectedTagBonusIds = new Set(
        Array.from(uiState.selectedTagBonusIds).filter(id => validIds.has(id))
    );

    els.tagBonusOptions.innerHTML = '';

    if (tagBonuses.length === 0) {
        els.tagBonusPanel.hidden = true;
        return;
    }

    els.tagBonusPanel.hidden = false;

    tagBonuses.forEach(bonus => {
        const option = document.createElement('label');
        option.className = 'tag-bonus-option';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'tag-bonus-cb';
        checkbox.dataset.bonusId = bonus.id;
        checkbox.checked = uiState.selectedTagBonusIds.has(bonus.id);

        const main = document.createElement('span');
        main.className = 'tag-bonus-main';

        const title = document.createElement('span');
        title.className = 'tag-bonus-title';
        title.textContent = `${bonus.tag} from ${bonus.sourceTileName}`;

        const context = document.createElement('span');
        context.className = 'tag-bonus-context';
        context.textContent = bonus.description || bonus.context;

        const steps = document.createElement('span');
        steps.className = 'tag-bonus-steps';
        steps.textContent = `+${bonus.steps}`;

        main.appendChild(title);
        main.appendChild(context);
        option.appendChild(checkbox);
        option.appendChild(main);
        option.appendChild(steps);
        els.tagBonusOptions.appendChild(option);
    });
}

// X on each pool badge, so a selection can be cleared without scrolling
// back to its tile in the Mosaic.
/** @param {'call'|'hitch'|'burn'} kind @param {import('../types.js').Tile} tile */
function badgeClearButton(kind, tile) {
    const label = `Remove ${escapeHtml(tile.name)} from the pool`;
    return ` <button type="button" class="badge-clear" data-clear="${kind}" data-tile-id="${escapeHtml(tile.id)}" title="${label}" aria-label="${label}">&times;</button>`;
}

/** @param {string[]} colors */
function renderPoolTilePickerLaunchers(colors) {
    els.btnPickCallTile.hidden = !uiState.callTile && colors.length < 2;
    els.btnPickCallTile.textContent = uiState.callTile ? 'Change Call Tile' : 'Select Call Tile';

    els.btnPickBurnTiles.hidden = !uiState.callTile;
    els.btnPickBurnTiles.textContent = uiState.burnTiles.length > 0
        ? `Change Burn Tiles (${uiState.burnTiles.length})`
        : 'Select Burn Tiles';

    if (els.poolTilePickerModal.classList.contains('active')) renderPoolTilePickerChoices();
}

/** @param {'call'|'burn'} mode */
function openPoolTilePicker(mode) {
    if (mode === 'burn' && !uiState.callTile) return;
    tilePickerMode = mode;
    renderPoolTilePickerChoices();
    els.poolTilePickerModal.classList.add('active');
}

function closePoolTilePicker() {
    els.poolTilePickerModal.classList.remove('active');
    tilePickerMode = null;
}

function renderPoolTilePickerChoices() {
    if (!tilePickerMode) return;
    const callColors = getSelectedCallColors();
    const isBurnPicker = tilePickerMode === 'burn';
    const choices = isBurnPicker
        ? getBurnTileChoices(dataManager.state.tiles, callColors, uiState.callTile, uiState.burnTiles)
        : getCallTileChoices(dataManager.state.tiles, callColors);
    const sharedColors = uiState.callTile
        ? getSharedTileCallColors(callColors, [uiState.callTile, ...uiState.burnTiles])
        : [];
    const selectedIds = new Set(isBurnPicker
        ? uiState.burnTiles.map(tile => tile.id)
        : uiState.callTile ? [uiState.callTile.id] : []);

    els.poolTilePickerTitle.textContent = isBurnPicker ? 'Select Burn Tiles' : 'Select Call Tile';
    els.poolTilePickerHelp.textContent = isBurnPicker
        ? 'Tap tiles to add or remove them. Choices narrow to colors shared by the Call tile and every selected burn.'
        : 'Choose one available tile matching any selected Call color. Choosing another tile swaps the current Call tile.';

    const colorLabel = isBurnPicker ? 'Shared color' : 'Matching colors';
    els.poolTilePickerColors.innerHTML = sharedColors.length > 0 || !isBurnPicker
        ? `<strong>${colorLabel}:</strong> ${escapeHtml((isBurnPicker ? sharedColors : callColors).join(', ') || 'None')}${isBurnPicker && sharedColors.length === 1 ? ` <span class="pool-tile-picker-chain-note">Chain: ${escapeHtml(sharedColors[0])}</span>` : ''}`
        : '<strong>Shared color:</strong> None — remove a selected burn to widen the choices.';

    els.poolTilePickerChoices.innerHTML = choices.map(tile => {
        const selected = selectedIds.has(tile.id);
        const boxes = getTileBoxes(tile);
        const boxLabels = boxes.map(box => box.type === 'shadow' ? box.kind : box.color);
        const boxColors = boxLabels.map(color => COLOR_HEX[color] || '#555');
        const firstColor = boxColors[0] || '#555';
        const secondColor = boxColors[1] || firstColor;
        const dice = (tile.dice || []).join(', ') || 'No dice';
        return `<button type="button" class="pool-tile-choice${selected ? ' selected' : ''}" data-tile-id="${escapeHtml(tile.id)}" aria-pressed="${selected}">
            <span class="pool-tile-choice-colors">${boxLabels.map((label, index) => `<span class="badge" style="background:${boxColors[index]};color:${['Yellow', 'Qi'].includes(label) ? 'black' : 'white'}">${escapeHtml(label)}</span>`).join('')}</span>
            <span class="pool-tile-choice-name">${selected ? '✓ ' : ''}${escapeHtml(tile.name)}</span>
            <span class="pool-tile-choice-dice">${escapeHtml(dice)}</span>
            <span class="pool-tile-choice-swatch" style="background:linear-gradient(135deg,${firstColor}55,${secondColor}55);border-color:${firstColor}99"></span>
        </button>`;
    }).join('');
    els.poolTilePickerEmpty.hidden = choices.length > 0;
    els.poolTilePickerEmpty.textContent = callColors.length === 0
        ? 'Select at least one Call color first.'
        : 'No matching tiles are available.';
}

/** @param {Event} event */
function handlePoolTileChoice(event) {
    const button = event.target instanceof Element ? event.target.closest('.pool-tile-choice') : null;
    if (!(button instanceof HTMLButtonElement) || !tilePickerMode) return;
    const tile = dataManager.state.tiles.find(candidate => candidate.id === button.dataset.tileId);
    if (!tile) return;

    if (tilePickerMode === 'call') {
        uiState.callTile = tile;
        uiState.hitchCallTiles = uiState.hitchCallTiles.filter(candidate => candidate.id !== tile.id);
        const remainingBurns = uiState.burnTiles.filter(candidate => candidate.id !== tile.id);
        uiState.burnTiles = getCompatibleBurnTiles(getSelectedCallColors(), tile, remainingBurns);
        closePoolTilePicker();
    } else if (uiState.burnTiles.some(candidate => candidate.id === tile.id)) {
        uiState.burnTiles = uiState.burnTiles.filter(candidate => candidate.id !== tile.id);
    } else {
        uiState.burnTiles.push(tile);
    }

    renderCards();
    updatePoolPreview();
}

export function updatePoolPreview() {
    const colors = getSelectedCallColors();

    // Update Dropzones visually
    const calledBadges = [];
    if (uiState.callTile) {
        calledBadges.push(`<div class="badge">${escapeHtml(uiState.callTile.name)} (${escapeHtml(uiState.callTile.dice.join(', '))})${badgeClearButton('call', uiState.callTile)}</div>`);
    }
    (uiState.hitchCallTiles || []).forEach(tile => {
        calledBadges.push(`<div class="badge" style="margin:2px">${escapeHtml(tile.name)} (${escapeHtml(tile.dice.join(', '))}; Hitch)${badgeClearButton('hitch', tile)}</div>`);
    });
    els.callTileZone.innerHTML = calledBadges.join('');
    els.burnTilesZone.innerHTML = uiState.burnTiles.map(t => `<div class="badge" style="margin:2px">${escapeHtml(t.name)}${badgeClearButton('burn', t)}</div>`).join('');
    renderPoolTilePickerLaunchers(colors);

    const extraDice = getExtraDice();
    if (extraDice.error) {
        els.poolDiceDisplay.innerHTML = `<span style="color:#ff3333">${escapeHtml(extraDice.error)}</span>`;
        els.poolAddsDisplay.innerText = `Adds: --`;
        renderChainOptions([]);
        renderTagBonusOptions([]);
        if (selectedRollMode() === 'manual') {
            els.manualInputsContainer.innerHTML = '';
        }
        return;
    }

    const res = poolEngine.compilePool(colors, dataManager.state.stats, uiState.callTile, uiState.burnTiles, dataManager.state.tiles, extraDice.dice, getPoolOptions());

    // Re-sync the Freebie options against the compiled pool. If the stored
    // selection is no longer a duplicate of a pool die it is cleared, and the
    // preview recompiles once without it.
    const freebieBefore = getSelectedFreebieDie();
    syncFreebieOptions(res.dice || []);
    if (freebieBefore && getSelectedFreebieDie() !== freebieBefore) {
        updatePoolPreview();
        return;
    }

    if (res.error) {
        // An empty Call is the page's default state, not a failure: show
        // the "pick a color" message as guidance, and save red for errors
        // in something the player actually entered.
        const style = colors.length === 0
            ? 'color: var(--text-secondary); font-style: italic'
            : 'color:#ff3333';
        els.poolDiceDisplay.innerHTML = `<span style="${style}">${escapeHtml(res.error)}</span>`;
        els.poolAddsDisplay.innerText = `Adds: --`;
        renderChainOptions(res.chainOptions || []);
        renderTagBonusOptions([]);
    } else {
        if (res.dice.length === 0) {
            els.poolDiceDisplay.innerText = 'No dice in pool.';
        } else {
            let diceStr = res.dice.map(d => escapeHtml(d.die)).join(' + ');
            if (res.dice.length % 2 !== 0) {
                diceStr += ' <span style="color: #ffaa00; font-size: 0.85em; margin-left: 0.5rem;" title="Odd number of dice significantly increases the odds of a haywire">⚠️ Odd Dice (Haywire Risk)</span>';
            }
            els.poolDiceDisplay.innerHTML = diceStr;
        }
        renderChainOptions(res.chainOptions || []);
        renderTagBonusOptions(res.tagBonuses || []);
        const selectedTagBonus = calculateSelectedTagBonus(res.tagBonuses || []);
        let addsText = `Adds (Keep): ${res.adds}`;
        if ((res.tagBonuses || []).length > 0) addsText += ` | Tag Bonus: +${selectedTagBonus}`;
        if ((res.resourceCosts || []).length > 0) {
            addsText += ` | Costs: ${res.resourceCosts.map(cost => `${cost.reason || 'Cost'} ${cost.amount} ${cost.resource.toUpperCase()}`).join(', ')}`;
        }
        if ((res.dieStepEffects || []).length > 0) {
            addsText += ` | Aberrant dice: ${res.dieStepEffects.map(effect => `${effect.from}->${effect.to}`).join(', ')}`;
        }
        if (res.titanActive) {
            addsText += ' | Titan: dice below their ▟ reroll';
        }
        els.poolAddsDisplay.innerText = addsText;
    }

    // Update manual inputs if in manual mode
    if (selectedRollMode() === 'manual') {
        renderManualInputs();
    }
}

export function renderManualInputs() {
    const colors = getSelectedCallColors();
    els.manualInputsContainer.innerHTML = '';

    const extraDice = getExtraDice();
    if (extraDice.error) return;

    const res = poolEngine.compilePool(colors, dataManager.state.stats, uiState.callTile, uiState.burnTiles, dataManager.state.tiles, extraDice.dice, getPoolOptions());
    if (res.error || res.dice.length === 0) return;

    res.dice.forEach((dObj) => {
        const div = document.createElement('div');
        div.className = 'manual-die-input';
        // baseDie rides along so the manual path's rolls carry it too —
        // the post-roll Freebie panel prices blast-zone dice from it.
        const baseDieAttr = dObj.baseDie ? ` data-base-die="${escapeHtml(dObj.baseDie)}"` : '';
        div.innerHTML = `
            <label>${escapeHtml(dObj.source)} - Roll for ${escapeHtml(dObj.die)}:</label>
            <input type="number" class="manual-val" data-die="${escapeHtml(dObj.die)}"${baseDieAttr} data-source="${escapeHtml(dObj.source)}" min="1" max="${escapeHtml(dObj.die.replace('d',''))}" value="">
        `;
        els.manualInputsContainer.appendChild(div);
    });
}

export async function executeVirtualRoll() {
    const colors = getSelectedCallColors();
    const extraDice = getExtraDice();
    if (extraDice.error) {
        showAlert(extraDice.error);
        return;
    }

    const res = poolEngine.compilePool(colors, dataManager.state.stats, uiState.callTile, uiState.burnTiles, dataManager.state.tiles, extraDice.dice, getPoolOptions());
    
    if (res.error || res.dice.length === 0) {
        showAlert(res.error || 'No dice to roll.');
        return;
    }
    if (!await applyResourceCosts(res.resourceCosts || [])) return;

    let rolled = poolEngine.rollPool(res.dice);
    let titanRerolls = [];
    if (res.titanActive) {
        const titanResult = poolEngine.applyTitanRerolls(rolled);
        rolled = titanResult.rolls;
        titanRerolls = titanResult.rerolls;
    }
    const result = poolEngine.calculateOptimalTotal(rolled, res.adds, { haywireThreshold: res.haywireThreshold });
    const appliedTagBonuses = getSelectedTagBonuses(res.tagBonuses || []);
    result.adds = res.adds;
    result.woundPenalty = getWoundPenalty(dataManager.state.activeCrits);
    result.flatBonus = (res.flatBonus || 0) - result.woundPenalty;
    result.appliedTagBonuses = appliedTagBonuses;
    result.ammoOptions = getAmmoResolutionOptions(res.calledTileIds || []);
    // The resolution panel needs the called tiles for called-armor soak and
    // Hinder/Gizmo notices.
    result.calledTileIds = [...new Set(res.calledTileIds || [])];
    result.freebieUsed = Boolean(res.freebieDie);
    result.titanActive = Boolean(res.titanActive);
    result.titanRerolls = titanRerolls;
    finalizeRoll(result, res, 'virtual', colors);
}

export async function executeManualCalculate() {
    const inputs = /** @type {NodeListOf<HTMLInputElement>} */ (els.manualInputsContainer.querySelectorAll('.manual-val'));
    let rolled = [];
    let hasError = false;

    inputs.forEach(inp => {
        const val = parseInt(inp.value, 10);
        const dieStr = inp.dataset.die;
        const sourceStr = inp.dataset.source;
        if (!dieStr || !sourceStr) {
            hasError = true;
            return;
        }
        const max = parseInt(dieStr.replace('d', ''), 10);
        if (isNaN(val) || val < 1 || val > max) {
            hasError = true;
        } else {
            rolled.push({
                source: sourceStr,
                die: dieStr,
                ...(inp.dataset.baseDie ? { baseDie: inp.dataset.baseDie } : {}),
                val: val
            });
        }
    });

    if (hasError) {
        showAlert("Please enter a valid roll for every die, within that die's range.");
        return;
    }

    const colors = getSelectedCallColors();
    const extraDice = getExtraDice();
    if (extraDice.error) {
        showAlert(extraDice.error);
        return;
    }

    const res = poolEngine.compilePool(colors, dataManager.state.stats, uiState.callTile, uiState.burnTiles, dataManager.state.tiles, extraDice.dice, getPoolOptions());
    if (res.error || res.dice.length === 0) {
        showAlert(res.error || 'No dice to calculate.');
        return;
    }
    if (!await applyResourceCosts(res.resourceCosts || [])) return;

    const result = poolEngine.calculateOptimalTotal(rolled, res.adds, { haywireThreshold: res.haywireThreshold });
    const appliedTagBonuses = getSelectedTagBonuses(res.tagBonuses || []);
    result.adds = res.adds;
    result.woundPenalty = getWoundPenalty(dataManager.state.activeCrits);
    result.flatBonus = (res.flatBonus || 0) - result.woundPenalty;
    result.appliedTagBonuses = appliedTagBonuses;
    result.ammoOptions = getAmmoResolutionOptions(res.calledTileIds || []);
    result.calledTileIds = [...new Set(res.calledTileIds || [])];
    result.freebieUsed = Boolean(res.freebieDie);
    // Manual mode: the player rolls physical dice, so Titan rerolls happen
    // at the table; the results panel reminds them.
    result.titanActive = Boolean(res.titanActive);
    result.titanRerolls = [];
    result.titanManualReminder = Boolean(res.titanActive);
    finalizeRoll(result, res, 'manual', colors);
}

export function processBurns() {
    if (uiState.burnTiles.length > 0) {
        uiState.burnTiles
            .filter(t => !poolEngine.getUnavailableReason(t))
            .filter(t => !isHitchedTile(t))
            .forEach(t => {
            t.isBurnt = true;
            dataManager.updateTile(t);
        });
        uiState.callTile = null;
        uiState.hitchCallTiles = [];
        uiState.burnTiles = [];
        renderCards();
        updatePoolPreview();
        updateShadowMax();
        renderArmorSoak(dataManager.state.tiles || []);
    }
}
