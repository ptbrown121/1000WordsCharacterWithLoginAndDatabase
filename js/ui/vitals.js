// @ts-check
import { els } from '../els.js';
import { getEffectiveMax } from '../data.js';
import { calculateCoreMax, formatAberration, getAvailableShadowAbilities, getShadowTagCounts } from '../pool.js';
import { shiftResourceMaxesForTileChange } from '../sheet-rules.js';
import { showConfirm } from './dialogService.js';
import { editorElements } from './editorDom.js';
import { renderCondition } from './condition.js';

/** @typedef {{state: import('../types.js').CharacterState, canEditActiveCharacter: () => boolean, updateResource: (key: string, value: number) => void, saveState: () => void}} VitalsDataManager */
/** @type {VitalsDataManager} */
let dataManager;
/** @type {import('../pool.js').PoolEngine} */
let poolEngine;
/** @type {() => void} */
let renderAll;

const toInt = (value) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
};

const currentVitalInputs = () => ({
    hp: els.valHp,
    en: els.valEn,
    rx: els.valRx,
    sh: els.valSh
});

function saveCurrentVital(key, value) {
    const input = currentVitalInputs()[key];
    if (!input) return;
    dataManager.updateResource(key, value);
    input.value = dataManager.state[key] ?? 0;
    // Status conditions and Walk (= current RX, p.35) read the pools.
    renderCondition();
}

function stepCurrentVital(key, step) {
    const input = currentVitalInputs()[key];
    if (!input) return;
    const current = toInt(input.value);
    const next = Math.max(0, current + step);
    saveCurrentVital(key, next);
}

/** @param {{dataManager: VitalsDataManager, poolEngine: import('../pool.js').PoolEngine, renderAll: () => void}} deps */
export function init(deps) {
    dataManager = deps.dataManager;
    poolEngine = deps.poolEngine;
    renderAll = deps.renderAll;

    Object.entries(currentVitalInputs()).forEach(([key, input]) => {
        input.addEventListener('change', () => saveCurrentVital(key, toInt(input.value)));
    });
    els.vitalStepButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            stepCurrentVital(btn.dataset.vital, toInt(btn.dataset.step));
        });
    });
    if (els.valAberration) {
        els.valAberration.addEventListener('change', () => {
            dataManager.state.aberration = toInt(els.valAberration.value);
            dataManager.saveState();
            renderShadowStatus();
        });
    }
    if (els.btnShadowToggle && els.shadowPanelBody) {
        els.btnShadowToggle.addEventListener('click', () => {
            const isOpening = els.shadowPanelBody.hidden;
            els.shadowPanelBody.hidden = !isOpening;
            els.btnShadowToggle.setAttribute('aria-expanded', String(isOpening));
            els.btnShadowToggle.textContent = isOpening ? 'Hide' : 'Show';
        });
    }
    if (els.btnShadowInfo && els.shadowInfoModal) {
        els.btnShadowInfo.addEventListener('click', () => {
            renderShadowStatus();
            els.shadowInfoModal.classList.add('active');
        });
    }
    if (els.btnShadowInfoClose && els.shadowInfoModal) {
        els.btnShadowInfoClose.addEventListener('click', () => {
            els.shadowInfoModal.classList.remove('active');
        });
        els.shadowInfoModal.addEventListener('click', (e) => {
            if (e.target === els.shadowInfoModal) els.shadowInfoModal.classList.remove('active');
        });
    }

    // Vital Edit Buttons
    editorElements(document, '.btn-edit-vital', HTMLButtonElement).forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.vital; // hp, en, or rx
            const labels = { hp: 'Health (HP)', en: 'Energy (EN)', rx: 'Reflex (RX)', sh: 'Shadow (SH)' };
            if (!key || !labels[key]) return;
            els.vitalModalTitle.innerText = `Edit ${labels[key]} Bonuses`;
            els.vitalModalKey.value = key;
            els.vitalPermInput.value = String(dataManager.state[key + 'Perm'] || 0);
            els.vitalTempInput.value = String(dataManager.state[key + 'Temp'] || 0);
            els.vitalModal.classList.add('active');
        });
    });

    els.btnVitalCancel.addEventListener('click', () => {
        els.vitalModal.classList.remove('active');
    });

    els.btnVitalSave.addEventListener('click', () => {
        const key = els.vitalModalKey.value;
        dataManager.state[key + 'Perm'] = parseInt(els.vitalPermInput.value, 10) || 0;
        dataManager.state[key + 'Temp'] = parseInt(els.vitalTempInput.value, 10) || 0;
        dataManager.saveState();
        els.vitalModal.classList.remove('active');
        renderAll();
    });

    // Rest Button
    els.btnRest.addEventListener('click', async () => {
        if (!await showConfirm('Rest and recover all resources? This will un-burn all tiles and clear tracked crits and the Press counter.', { title: 'Rest character?' })) return;
        const state = dataManager.state;
        state.hp = getEffectiveMax(state, 'hp');
        state.en = getEffectiveMax(state, 'en');
        state.rx = getEffectiveMax(state, 'rx');
        state.sh = getEffectiveMax(state, 'sh', poolEngine.calculateShadowMax(state.tiles));
        state.core = getEffectiveMax(state, 'core', calculateCoreMax(state.tiles));
        state.tiles.forEach(t => t.isBurnt = false);
        state.activeCrits = {};
        state.pressCount = 0;
        dataManager.saveState();
        renderAll();
    });

    // Auto-Calculate Vitals
    els.btnCalcVitals.addEventListener('click', () => {
        const state = dataManager.state;
        const resourceMaxes = poolEngine.calculateResourceMaxes(state.tiles);

        state.hpMax = resourceMaxes.hp;
        state.enMax = resourceMaxes.en;
        state.rxMax = resourceMaxes.rx;

        // A recalculated max can drop (e.g. a form switch buried a Bestial
        // tile); current pools cannot sit above the new effective max.
        ['hp', 'en', 'rx'].forEach(key => {
            const current = parseInt(state[key], 10) || 0;
            state[key] = Math.min(current, getEffectiveMax(state, key));
        });

        dataManager.saveState();
        renderAll();
    });
}

/** @returns {{hp: number, en: number, rx: number, sh: number}|null} */
function tileResourceMaxes() {
    if (!dataManager || !poolEngine) return null;
    return poolEngine.calculateResourceMaxes(dataManager.state.tiles || []);
}

/**
 * Run a tile change (add, edit, delete, bury, restore, break, form switch)
 * and move the stored HP / EN / RX maxes with it: "Pools are adjusted
 * whenever new tiles are gained. ... If a tile is buried, its
 * contributions to pools are lost." (p.11) The shift-by-delta rule and
 * current-pool clamping live in shiftResourceMaxesForTileChange.
 * @template T
 * @param {() => T} mutate
 * @returns {T}
 */
export function withTileResourceSync(mutate) {
    const before = tileResourceMaxes();
    const result = mutate();
    const after = tileResourceMaxes();
    if (!before || !after || !dataManager.canEditActiveCharacter()) return result;

    const { changed, patch } = shiftResourceMaxesForTileChange(dataManager.state, before, after);
    if (changed) {
        Object.assign(dataManager.state, patch);
        dataManager.saveState();
        renderResourcePools();
        renderCondition();
    }
    return result;
}

// Current / effective-max display for HP, EN, and RX.
export function renderResourcePools() {
    if (!dataManager) return;
    const state = dataManager.state;
    // Effective max = base max + perm + temp (see getEffectiveMax in data.js).
    els.valHp.value = String(state.hp ?? 0);
    els.valHpMax.innerText = String(getEffectiveMax(state, 'hp'));
    els.valEn.value = String(state.en ?? 0);
    els.valEnMax.innerText = String(getEffectiveMax(state, 'en'));
    els.valRx.value = String(state.rx ?? 0);
    els.valRxMax.innerText = String(getEffectiveMax(state, 'rx'));
    renderTempBadge(els.hpTempBadge, state.hpTemp);
    renderTempBadge(els.enTempBadge, state.enTemp);
    renderTempBadge(els.rxTempBadge, state.rxTemp);
}

export function renderTempBadge(badgeEl, tempVal) {
    const val = parseInt(tempVal, 10) || 0;
    if (val > 0) {
        badgeEl.innerText = `+${val} Temp`;
        badgeEl.style.display = 'inline-block';
    } else {
        badgeEl.style.display = 'none';
    }
}

export function updateShadowMax() {
    const shBase = poolEngine.calculateShadowMax(dataManager.state.tiles);
    const shEffMax = getEffectiveMax(dataManager.state, 'sh', shBase);
    els.valShMax.innerText = String(shEffMax);
    renderTempBadge(els.shTempBadge, dataManager.state.shTemp);
    renderShadowStatus();
}

export function renderShadowStatus() {
    if (!els.shadowAlignmentDisplay || !dataManager || !poolEngine) return;
    const shBase = poolEngine.calculateShadowMax(dataManager.state.tiles);
    const maxShadow = getEffectiveMax(dataManager.state, 'sh', shBase);
    const tagCounts = getShadowTagCounts(dataManager.state.tiles);
    const aberration = toInt(dataManager.state.aberration);
    if (els.valAberration) els.valAberration.value = String(aberration);
    els.shadowAlignmentDisplay.textContent = formatAberration(aberration, maxShadow, tagCounts);

    if (!els.shadowAbilitiesDisplay) return;
    const abilities = getAvailableShadowAbilities(aberration, maxShadow, tagCounts);
    if (maxShadow <= 0) {
        els.shadowAbilitiesDisplay.textContent = 'No Qi or Id boxes: no Shadow abilities available.';
        return;
    }
    els.shadowAbilitiesDisplay.innerHTML = abilities.length
        ? abilities.map(ability => `<div><strong>${ability.side}</strong>: ${ability.label}</div>`).join('')
        : 'No Shadow abilities available at this Aberration.';
}
