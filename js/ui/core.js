// @ts-check
// Cyber Core panel (v5.02 p.64). Core max derives from Cyber-tagged tiles;
// spend abilities come from the Core tags the character actually carries.
// The panel hides itself entirely for characters with no Core.
import { els } from '../els.js';
import { getEffectiveMax } from '../data.js';
import { calculateCoreMax, escapeHtml, getCoreAbilities } from '../pool.js';
import { showAlert, showConfirm } from './dialogService.js';

/** @typedef {{state: import('../types.js').CharacterState, canEditActiveCharacter: () => boolean, saveState: () => void}} CoreDataManager */
/** @type {CoreDataManager} */
let dataManager;
/** @type {() => void} */
let renderAll;

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** @param {import('../types.js').CharacterState} state */
export function getCoreEffectiveMax(state) {
    return getEffectiveMax(state, 'core', calculateCoreMax(state?.tiles || []));
}

async function spendCore(abilityId) {
    if (!dataManager.canEditActiveCharacter()) return;
    const state = dataManager.state;
    const current = toInt(state.core);
    const ability = getCoreAbilities(state.tiles || []).find(entry => entry.id === abilityId);
    if (!ability) return;

    if (current <= 0 && !state.gmOverride) {
        showAlert('No Core available to spend.');
        return;
    }
    if (!await showConfirm(`Spend 1 Core on ${ability.label}? (${ability.effect})`, { title: 'Spend Core?' })) return;

    state.core = Math.max(0, current - 1);
    dataManager.saveState();
    if (renderAll) renderAll();
}

export function renderCore() {
    if (!dataManager || !els.corePanel) return;
    const state = dataManager.state;
    const effectiveMax = getCoreEffectiveMax(state);

    if (effectiveMax <= 0) {
        els.corePanel.hidden = true;
        return;
    }

    els.corePanel.hidden = false;
    const current = toInt(state.core);
    els.coreDisplay.textContent = `${current} / ${effectiveMax}`;
    if (els.valCore && document.activeElement !== els.valCore) {
        els.valCore.value = String(current);
    }

    if (!els.coreAbilities) return;
    const abilities = getCoreAbilities(state.tiles || []);
    els.coreAbilities.innerHTML = abilities.length
        ? abilities.map(ability => `
            <div class="core-ability-row">
                <button type="button" class="btn btn-outline btn-core-spend" data-ability="${ability.id}"${current <= 0 && !state.gmOverride ? ' disabled' : ''}>Spend 1</button>
                <span><strong>${escapeHtml(ability.label)}</strong>: ${escapeHtml(ability.effect)} <small>(${escapeHtml(ability.sources.join(', '))})</small></span>
            </div>
        `).join('')
        : '<small>No Core spend tags (Antivenin, Boost, Machine, Reticle, Wired, ...) on any tile yet.</small>';
}

/** @param {{dataManager: CoreDataManager, renderAll: () => void}} deps */
export function init(deps) {
    dataManager = deps.dataManager;
    renderAll = deps.renderAll;

    if (els.btnCoreToggle && els.corePanelBody) {
        els.btnCoreToggle.addEventListener('click', () => {
            const isOpening = els.corePanelBody.hidden;
            els.corePanelBody.hidden = !isOpening;
            els.btnCoreToggle.setAttribute('aria-expanded', String(isOpening));
            els.btnCoreToggle.textContent = isOpening ? 'Hide' : 'Show';
        });
    }

    els.valCore.addEventListener('change', () => {
        if (!dataManager.canEditActiveCharacter()) return;
        dataManager.state.core = Math.max(0, toInt(els.valCore.value));
        dataManager.saveState();
        renderCore();
    });

    els.coreAbilities.addEventListener('click', (e) => {
        const button = e.target instanceof Element ? e.target.closest('.btn-core-spend') : null;
        if (button instanceof HTMLButtonElement && button.dataset.ability) spendCore(button.dataset.ability);
    });
}
