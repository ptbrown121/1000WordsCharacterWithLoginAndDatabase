import {
    adjustAberrationForShadowUse,
    classifyAberration,
    escapeHtml,
    getDiceValidationMessage,
    getShadowTagCounts,
    isHitchedTile,
    parseDiceInput,
    RESOURCE_LABELS
} from '../pool.js';
import { getWoundPenalty } from '../status-rules.js';
import { uiState } from '../state.js';
import { els } from '../els.js';
import { showResults } from './resolution.js';
import { renderCards } from './cards.js';
import { renderCondition } from './condition.js';
import { renderArmorSoak } from './armorSoak.js';
import { updateShadowMax } from './vitals.js';
import { renderRulesReview } from './rulesReview.js';

let dataManager;
let poolEngine;
let renderAll;

const RESOURCE_INPUTS = {
    hp: 'valHp',
    en: 'valEn',
    rx: 'valRx',
    sh: 'valSh'
};

export function init(deps) {
    dataManager = deps.dataManager;
    poolEngine = deps.poolEngine;
    renderAll = deps.renderAll;

    els.callColor1.addEventListener('change', syncCallColorsFromLegacySelects);
    els.callColor2.addEventListener('change', syncCallColorsFromLegacySelects);
    els.callColorOptions.forEach(button => {
        button.addEventListener('click', () => {
            toggleCallColor(button.dataset.value);
        });
    });
    syncCallColorButtons();
    els.btnClearCall?.addEventListener('click', clearCallSelection);
    els.extraDiceInput.addEventListener('input', () => {
        syncExtraDiceChips();
        updatePoolPreview();
    });
    els.extraDiceButtons?.addEventListener('click', (e) => {
        const button = e.target.closest('.dice-add-btn');
        if (!button || !els.extraDiceButtons.contains(button)) return;
        addExtraDie(button.dataset.die);
    });
    els.risenAberrantEffect?.addEventListener('change', updatePoolPreview);
    els.fallenAberrantEffect?.addEventListener('change', updatePoolPreview);
    els.freebieDieSelect?.addEventListener('change', updatePoolPreview);
    els.freebieDieButtons?.addEventListener('click', (e) => {
        const button = e.target.closest('.freebie-die-btn');
        if (!button || !els.freebieDieButtons.contains(button)) return;
        const die = button.dataset.die || '';
        const select = els.freebieDieSelect;
        if (!select) return;
        // Tapping the active die deselects it, like picking None.
        select.value = select.value === die ? '' : die;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    els.chainOptions.addEventListener('change', (e) => {
        if (e.target.classList.contains('chain-cb')) {
            const chainId = e.target.dataset.chainId;
            if (e.target.checked) {
                uiState.disabledChainIds.delete(chainId);
            } else {
                uiState.disabledChainIds.add(chainId);
            }
            updatePoolPreview();
            return;
        }
        if (e.target.classList.contains('chain-color-select')) {
            const chainId = e.target.dataset.chainId;
            const color = e.target.value;
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
        if (!e.target.classList.contains('tag-bonus-cb')) return;
        const bonusId = e.target.dataset.bonusId;
        if (e.target.checked) {
            uiState.selectedTagBonusIds.add(bonusId);
        } else {
            uiState.selectedTagBonusIds.delete(bonusId);
        }
        updatePoolPreview();
    });

    els.radioModes.forEach(r => {
        r.addEventListener('change', (e) => {
            if (e.target.value === 'virtual') {
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

function syncLegacyCallColorSelects(colors) {
    els.callColor1.value = colors[0] || '';
    els.callColor2.value = colors[1] || '';
}

function syncCallColorsFromLegacySelects() {
    uiState.callColors = [...new Set([els.callColor1.value, els.callColor2.value].filter(Boolean))];
    handleCallColorChange();
}

export function setCallColors(colors) {
    const uniqueColors = [...new Set(colors.filter(Boolean))];
    uiState.callColors = uniqueColors;
    syncLegacyCallColorSelects(uniqueColors);
    handleCallColorChange();
}

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
        const active = selected.has(button.dataset.value);
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

function setExtraDiceTokens(tokens) {
    els.extraDiceInput.value = tokens.join(', ');
    els.extraDiceInput.dispatchEvent(new Event('input', { bubbles: true }));
}

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
    select.value = distinctDice.includes(current) ? current : '';

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

function applyResourceCosts(resourceCosts = []) {
    const totals = resourceCosts.reduce((acc, cost) => {
        const resource = cost.resource;
        const amount = parseInt(cost.amount, 10) || 0;
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
            alert(`Calling ${costText} requires ${amount} ${RESOURCE_LABELS[resource] || resource.toUpperCase()}, but only ${current} is available.`);
            return false;
        }
    }

    const spend = confirm(`Calling ${costText}. Spend these resources now?`);
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

function applyAberrationForShadowUse(shadowUse) {
    if (!shadowUse) return;
    dataManager.state.aberration = adjustAberrationForShadowUse(dataManager.state.aberration, shadowUse);
    dataManager.saveState();
    updateShadowMax();
    renderRulesReview();
}

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

export function getSelectedTagBonuses(tagBonuses = []) {
    return tagBonuses.filter(bonus => uiState.selectedTagBonusIds.has(bonus.id));
}

export function calculateSelectedTagBonus(tagBonuses = []) {
    return getSelectedTagBonuses(tagBonuses)
        .reduce((sum, bonus) => sum + bonus.steps, 0);
}

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

export function updatePoolPreview() {
    const colors = getSelectedCallColors();

    // Update Dropzones visually
    const calledBadges = [];
    if (uiState.callTile) {
        calledBadges.push(`<div class="badge">${escapeHtml(uiState.callTile.name)} (${escapeHtml(uiState.callTile.dice.join(', '))})</div>`);
    }
    (uiState.hitchCallTiles || []).forEach(tile => {
        calledBadges.push(`<div class="badge" style="margin:2px">${escapeHtml(tile.name)} (${escapeHtml(tile.dice.join(', '))}; Hitch)</div>`);
    });
    els.callTileZone.innerHTML = calledBadges.join('');
    els.burnTilesZone.innerHTML = uiState.burnTiles.map(t => `<div class="badge" style="margin:2px">${escapeHtml(t.name)}</div>`).join('');

    const extraDice = getExtraDice();
    if (extraDice.error) {
        els.poolDiceDisplay.innerHTML = `<span style="color:#ff3333">${escapeHtml(extraDice.error)}</span>`;
        els.poolAddsDisplay.innerText = `Adds: --`;
        renderChainOptions([]);
        renderTagBonusOptions([]);
        if (document.querySelector('input[name="roll-mode"]:checked').value === 'manual') {
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
    if (document.querySelector('input[name="roll-mode"]:checked').value === 'manual') {
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
        div.innerHTML = `
            <label>${escapeHtml(dObj.source)} - Roll for ${escapeHtml(dObj.die)}:</label>
            <input type="number" class="manual-val" data-die="${escapeHtml(dObj.die)}" data-source="${escapeHtml(dObj.source)}" min="1" max="${escapeHtml(dObj.die.replace('d',''))}" value="">
        `;
        els.manualInputsContainer.appendChild(div);
    });
}

export function executeVirtualRoll() {
    const colors = getSelectedCallColors();
    const extraDice = getExtraDice();
    if (extraDice.error) {
        alert(extraDice.error);
        return;
    }

    const res = poolEngine.compilePool(colors, dataManager.state.stats, uiState.callTile, uiState.burnTiles, dataManager.state.tiles, extraDice.dice, getPoolOptions());
    
    if (res.error || res.dice.length === 0) {
        alert(res.error || "No dice to roll.");
        return;
    }
    if (!applyResourceCosts(res.resourceCosts || [])) return;

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

export function executeManualCalculate() {
    const inputs = els.manualInputsContainer.querySelectorAll('.manual-val');
    let rolled = [];
    let hasError = false;

    inputs.forEach(inp => {
        const val = parseInt(inp.value, 10);
        const dieStr = inp.dataset.die;
        const sourceStr = inp.dataset.source;
        const max = parseInt(dieStr.replace('d', ''), 10);
        if (isNaN(val) || val < 1 || val > max) {
            hasError = true;
        } else {
            rolled.push({ source: sourceStr, die: dieStr, val: val });
        }
    });

    if (hasError) {
        alert("Please enter a valid roll for every die, within that die's range.");
        return;
    }

    const colors = getSelectedCallColors();
    const extraDice = getExtraDice();
    if (extraDice.error) {
        alert(extraDice.error);
        return;
    }

    const res = poolEngine.compilePool(colors, dataManager.state.stats, uiState.callTile, uiState.burnTiles, dataManager.state.tiles, extraDice.dice, getPoolOptions());
    if (res.error || res.dice.length === 0) {
        alert(res.error || "No dice to calculate.");
        return;
    }
    if (!applyResourceCosts(res.resourceCosts || [])) return;

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
