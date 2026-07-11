// Condition panel: derived status conditions (0-pool states), the Crits
// Dashboard counters, and the Press tracker. Rules math lives in
// js/status-rules.js; this module only renders and persists.
import { els } from '../els.js';
import { showAlert, showConfirm } from './dialogService.js';
import { escapeHtml, getCoreAbilities } from '../pool.js';
import {
    CRIT_DASHBOARD,
    calculatePressCost,
    getStatusConditions,
    normalizeActiveCrits
} from '../status-rules.js';

let dataManager;
let renderAll;

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

function getPressToggles() {
    return {
        repeatPrevious: Boolean(document.getElementById('press-repeat')?.checked),
        fastWeapon: Boolean(document.getElementById('press-fast')?.checked),
        recoilWeapon: Boolean(document.getElementById('press-recoil')?.checked),
        reticle: Boolean(document.getElementById('press-reticle')?.checked)
    };
}

function hasReticleAbility() {
    return getCoreAbilities(dataManager.state.tiles || []).some(ability => ability.id === 'reticle');
}

function adjustCrit(critId, step) {
    if (!dataManager.canEditActiveCharacter()) return;
    const crits = normalizeActiveCrits(dataManager.state.activeCrits);
    const next = Math.max(0, (crits[critId] || 0) + step);
    if (next > 0) {
        crits[critId] = next;
    } else {
        delete crits[critId];
    }
    dataManager.state.activeCrits = crits;
    dataManager.saveState();
    renderCondition();
}

async function executePress(kind) {
    if (!dataManager.canEditActiveCharacter()) return;
    const state = dataManager.state;
    const toggles = getPressToggles();
    const cost = calculatePressCost({ kind, pressCount: state.pressCount, ...toggles });
    const currentRx = toInt(state.rx);
    // Reticle (Cyber, p.64): spend 1 Core to Press without increasing the
    // Press counter.
    const useReticle = toggles.reticle && hasReticleAbility() && toInt(state.core) > 0;

    if (currentRx <= 0) {
        showAlert('Cornered (0 Reflex): the character cannot Press.');
        return;
    }
    if (currentRx < cost && !state.gmOverride) {
        showAlert(`This Press costs ${cost} RX, but only ${currentRx} is available.`);
        return;
    }
    const counterText = useReticle
        ? `1 Core (Reticle) keeps the press counter at ${toInt(state.pressCount)}`
        : `the press counter rises to ${toInt(state.pressCount) + 1}`;
    if (!await showConfirm(`Press for a${kind === 'move' ? ' Move' : 'n Action'}: spend ${cost} RX? ${counterText}.`, { title: 'Spend Reflex?' })) return;

    state.rx = Math.max(0, currentRx - cost);
    if (useReticle) {
        state.core = Math.max(0, toInt(state.core) - 1);
    } else {
        state.pressCount = toInt(state.pressCount) + 1;
    }
    dataManager.saveState();
    if (renderAll) renderAll();
}

function bumpPressCount(step) {
    if (!dataManager.canEditActiveCharacter()) return;
    dataManager.state.pressCount = Math.max(0, toInt(dataManager.state.pressCount) + step);
    dataManager.saveState();
    renderCondition();
}

function resetPressCount() {
    if (!dataManager.canEditActiveCharacter()) return;
    dataManager.state.pressCount = 0;
    dataManager.saveState();
    renderCondition();
}

function renderStatusBadges() {
    if (!els.statusConditionsDisplay) return;
    const conditions = getStatusConditions(dataManager.state);

    if (conditions.length === 0) {
        els.statusConditionsDisplay.textContent = 'No conditions';
        els.statusConditionsDisplay.title = '';
        return;
    }

    els.statusConditionsDisplay.innerHTML = conditions
        .map(condition => `<span class="status-badge status-${condition.severity}" title="${escapeHtml(condition.description)}">${escapeHtml(condition.label)}</span>`)
        .join(' ');
    els.statusConditionsDisplay.title = conditions.map(c => `${c.label}: ${c.description}`).join('\n');
}

function clearFastCrits() {
    if (!dataManager.canEditActiveCharacter()) return;
    const crits = normalizeActiveCrits(dataManager.state.activeCrits);
    CRIT_DASHBOARD.filter(crit => crit.kind === 'fast').forEach(crit => delete crits[crit.id]);
    dataManager.state.activeCrits = crits;
    dataManager.saveState();
    renderCondition();
}

function renderCritsDashboard() {
    if (!els.critsDashboard) return;
    const crits = normalizeActiveCrits(dataManager.state.activeCrits);
    const hasFastCrits = CRIT_DASHBOARD.some(crit => crit.kind === 'fast' && (crits[crit.id] || 0) > 0);

    const groups = [
        { kind: 'fast', label: 'Fast Crits (fade at end of turn)' },
        { kind: 'sticky', label: 'Sticky Crits (heal 1 per 4 hours, lowest first)' },
        { kind: 'special', label: 'Special Crits (stick until removed)' }
    ];

    els.critsDashboard.innerHTML = groups.map(group => {
        const rows = CRIT_DASHBOARD.filter(crit => crit.kind === group.kind).map(crit => {
            const count = crits[crit.id] || 0;
            return `
                <span class="crit-counter${count > 0 ? ' crit-active' : ''}" title="${escapeHtml(crit.effect)}">
                    <button type="button" class="crit-step" data-crit="${crit.id}" data-step="-1" aria-label="Remove ${crit.label}">-</button>
                    <span class="crit-label">${crit.label}${count > 0 ? ` ×${count}` : ''}</span>
                    <button type="button" class="crit-step" data-crit="${crit.id}" data-step="1" aria-label="Add ${crit.label}">+</button>
                </span>
            `;
        }).join('');
        const endTurn = group.kind === 'fast'
            ? `<button type="button" class="btn btn-outline" id="btn-clear-fast-crits" title="Fast crits fade at the end of the turn"${hasFastCrits ? '' : ' disabled'}>End turn</button>`
            : '';
        return `<div class="crit-group"><small>${group.label}</small><div class="crit-group-row">${rows}${endTurn}</div></div>`;
    }).join('');
}

function renderPressTracker() {
    if (!els.pressTracker) return;
    const state = dataManager.state;
    const toggles = getPressToggles();
    const moveCost = calculatePressCost({ kind: 'move', pressCount: state.pressCount, ...toggles });
    const actionCost = calculatePressCost({ kind: 'action', pressCount: state.pressCount, ...toggles });

    els.pressTracker.innerHTML = `
        <small>Press the Initiative (spends RX; each Press or Haywire raises later Press costs by 1)</small>
        <div class="press-tracker-row">
            <span class="press-count" title="Presses and Haywires this fight">Counter: ${toInt(state.pressCount)}</span>
            <button type="button" class="btn btn-outline btn-press" data-press-kind="move">Press Move (${moveCost} RX)</button>
            <button type="button" class="btn btn-outline btn-press" data-press-kind="action">Press Action (${actionCost} RX)</button>
            <button type="button" class="btn btn-outline" id="btn-press-haywire" title="A Haywire also raises future Press costs by 1">+1 Haywire</button>
            <button type="button" class="btn btn-outline" id="btn-press-reset" title="Press costs reset to zero at the end of the fight">Reset</button>
        </div>
        <div class="press-tracker-row">
            <label class="filter-toggle" title="Repeating your previous action reduces that Press by 1"><input type="checkbox" id="press-repeat"${toggles.repeatPrevious ? ' checked' : ''}> Repeat previous action (-1)</label>
            <label class="filter-toggle" title="Fast weapon Detail tag: -1 to Press Actions with that weapon"><input type="checkbox" id="press-fast"${toggles.fastWeapon ? ' checked' : ''}> Fast weapon (-1)</label>
            <label class="filter-toggle" title="Recoil flaw: +1 to Press Actions"><input type="checkbox" id="press-recoil"${toggles.recoilWeapon ? ' checked' : ''}> Recoil weapon (+1)</label>
            ${hasReticleAbility() ? `<label class="filter-toggle" title="Reticle (Cyber): spend 1 Core to Press without raising the counter"><input type="checkbox" id="press-reticle"${toggles.reticle ? ' checked' : ''}${toInt(state.core) <= 0 ? ' disabled' : ''}> Reticle (1 Core: no counter rise)</label>` : ''}
        </div>
    `;
}

export function renderCondition() {
    if (!dataManager) return;
    renderStatusBadges();
    renderCritsDashboard();
    renderPressTracker();
}

export function init(deps) {
    dataManager = deps.dataManager;
    renderAll = deps.renderAll;

    if (els.btnConditionToggle && els.conditionPanelBody) {
        els.btnConditionToggle.addEventListener('click', () => {
            const isOpening = els.conditionPanelBody.hidden;
            els.conditionPanelBody.hidden = !isOpening;
            els.btnConditionToggle.setAttribute('aria-expanded', String(isOpening));
            els.btnConditionToggle.textContent = isOpening ? 'Hide' : 'Show';
        });
    }

    els.conditionPanelBody?.addEventListener('click', (e) => {
        const critStep = e.target.closest('.crit-step');
        if (critStep) {
            adjustCrit(critStep.dataset.crit, toInt(critStep.dataset.step));
            return;
        }
        const pressButton = e.target.closest('.btn-press');
        if (pressButton) {
            executePress(pressButton.dataset.pressKind);
            return;
        }
        if (e.target.closest('#btn-clear-fast-crits')) {
            clearFastCrits();
            return;
        }
        if (e.target.closest('#btn-press-haywire')) {
            bumpPressCount(1);
            return;
        }
        if (e.target.closest('#btn-press-reset')) {
            resetPressCount();
        }
    });

    els.conditionPanelBody?.addEventListener('change', (e) => {
        if (['press-repeat', 'press-fast', 'press-recoil', 'press-reticle'].includes(e.target.id)) {
            renderPressTracker();
        }
    });
}
