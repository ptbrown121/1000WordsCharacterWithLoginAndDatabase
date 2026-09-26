// @ts-check
// Condition panel: derived status conditions (0-pool states), the Crits
// Dashboard counters, the Press tracker, movement distances, and the
// Sustain upkeep tracker. Rules math lives in js/status-rules.js and
// js/sheet-rules.js; this module only renders and persists.
import { els } from '../els.js';
import { showAlert, showConfirm } from './dialogService.js';
import { escapeHtml, getCoreAbilities } from '../pool.js';
import { optionalEditorElement } from './editorDom.js';
import {
    CRIT_DASHBOARD,
    calculatePressCost,
    getStatusConditions,
    normalizeActiveCrits
} from '../status-rules.js';
import {
    DASH_DIFFICULTY,
    calculateMovement,
    getBulkyTiles,
    getSustainTracker,
    paySustainUpkeep
} from '../sheet-rules.js';

/** @typedef {{state: import('../types.js').CharacterState, canEditActiveCharacter: () => boolean, saveState: () => void}} ConditionDataManager */
/** @type {ConditionDataManager} */
let dataManager;
/** @type {() => void} */
let renderAll;

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

// Bulky items the player marked "in use" (p.29: "while used, -3 Walk").
// View-only like the Press toggles: whether gear is in use changes scene
// to scene, so it is not saved with the character.
/** @type {Set<string>} */
const bulkyInUseIds = new Set();

function getPressToggles() {
    return {
        repeatPrevious: Boolean(optionalEditorElement(document, '#press-repeat', HTMLInputElement)?.checked),
        fastWeapon: Boolean(optionalEditorElement(document, '#press-fast', HTMLInputElement)?.checked),
        recoilWeapon: Boolean(optionalEditorElement(document, '#press-recoil', HTMLInputElement)?.checked),
        reticle: Boolean(optionalEditorElement(document, '#press-reticle', HTMLInputElement)?.checked)
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
    const cost = calculatePressCost({ kind, pressCount: toInt(state.pressCount), ...toggles });
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
    const moveCost = calculatePressCost({ kind: 'move', pressCount: toInt(state.pressCount), ...toggles });
    const actionCost = calculatePressCost({ kind: 'action', pressCount: toInt(state.pressCount), ...toggles });

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

function getMovement() {
    const state = dataManager.state;
    const bulkyTiles = getBulkyTiles(state.tiles || []);
    const liveIds = new Set(bulkyTiles.map(tile => String(tile.id)));
    [...bulkyInUseIds].forEach(id => { if (!liveIds.has(id)) bulkyInUseIds.delete(id); });
    const movement = calculateMovement({
        rx: state.rx,
        tiles: state.tiles || [],
        activeCrits: state.activeCrits,
        bulkyInUse: bulkyInUseIds.size
    });
    return { movement, bulkyTiles };
}

function renderMovementSummary(movement) {
    if (!els.movementSummary) return;
    if (movement.cornered) {
        els.movementSummary.innerHTML = `Move: <strong>Pace ${movement.pace} m</strong> only (Cornered)`;
        return;
    }
    const parts = [`Pace <strong>${movement.pace} m</strong>`];
    parts.push(movement.canWalk ? `Walk <strong>${movement.walk} m</strong>` : 'Walk: no (HOLD)');
    parts.push(movement.canRun ? `Run <strong>${movement.run} m</strong>` : 'Run: no (HOLD)');
    els.movementSummary.innerHTML = `Move: ${parts.join(' · ')}`;
}

function renderMovementTracker(movement, bulkyTiles) {
    if (!els.movementTracker) return;
    const rx = Math.max(0, toInt(dataManager.state.rx));
    const breakdown = [`RX ${rx}`];
    if (movement.slowPenalty) breakdown.push(`SLOW -${movement.slowPenalty}`);
    if (movement.nimbleBonus) breakdown.push(`Nimble +${movement.nimbleBonus}`);
    if (movement.bulkyPenalty) breakdown.push(`Bulky -${movement.bulkyPenalty}`);

    const notes = [];
    if (movement.cornered) notes.push('Cornered (0 RX): cannot Walk, Run, or Dash; restricted to a Pace (3 m) each turn.');
    if (movement.held) notes.push('HOLD: cannot Walk or Run until resisted. HOLD does not mention Dash; ask the GM.');
    if (movement.bestial && !movement.cornered) notes.push('Bestial: Pace equals Walk.');

    const dashText = movement.canDash
        ? `Dash: test Athletics (or similar) vs. ${DASH_DIFFICULTY}. Travel at least 3× Walk (${movement.dashMinimum} m); each point on an assigned spare die adds a Walk (${movement.walk} m). Take a SLOW crit after Dashing.`
        : 'Dash: not available while Cornered.';

    const bulkyRows = bulkyTiles.map(tile => {
        const id = String(tile.id);
        return `<label class="filter-toggle" title="Bulky: while used, -3 Walk"><input type="checkbox" class="bulky-in-use" data-tile-id="${escapeHtml(id)}"${bulkyInUseIds.has(id) ? ' checked' : ''}> ${escapeHtml(tile.name || 'Bulky item')} in use (-3 Walk)</label>`;
    }).join('');

    els.movementTracker.innerHTML = `
        <small>Movement in Y/M (Walk = current Reflex; Run uses Action + Move for 3× Walk)</small>
        <div class="press-tracker-row">
            <span>Pace <strong>${movement.pace}</strong></span>
            <span>Walk <strong>${movement.canWalk ? movement.walk : '—'}</strong></span>
            <span>Run <strong>${movement.canRun ? movement.run : '—'}</strong></span>
            <span class="movement-note">(${breakdown.join(', ')})</span>
        </div>
        ${bulkyRows ? `<div class="press-tracker-row">${bulkyRows}</div>` : ''}
        <div class="movement-note">${escapeHtml(dashText)}</div>
        ${movement.canDash ? '<div class="press-tracker-row"><button type="button" class="btn btn-outline" id="btn-dash-slow" title="Take a SLOW crit after Dashing">Dashed: add SLOW</button></div>' : ''}
        ${notes.map(note => `<div class="movement-note">${escapeHtml(note)}</div>`).join('')}
    `;
}

function renderSustainTracker() {
    if (!els.sustainTracker) return;
    const { rows } = getSustainTracker(dataManager.state.tiles || [], dataManager.state.activeSustains);
    if (rows.length === 0) {
        els.sustainTracker.innerHTML = '';
        return;
    }

    const rowHtml = rows.map(row => {
        const id = escapeHtml(row.id);
        const payButtons = row.active
            ? ['en', 'rx', 'hp'].map(key => `<button type="button" class="btn btn-outline btn-sustain-pay" data-spell-id="${id}" data-resource="${key}">Pay 1 ${key.toUpperCase()}</button>`).join('')
            : '';
        return `
            <div class="sustain-row">
                <label class="filter-toggle"><input type="checkbox" class="sustain-active" data-spell-id="${id}"${row.active ? ' checked' : ''}> ${escapeHtml(row.name)}</label>
                ${payButtons}
            </div>
        `;
    }).join('');

    els.sustainTracker.innerHTML = `
        <small>Sustained spells: tick a spell while it is up, and pay 1 EN, RX, or HP each time upkeep is due. The upkeep interval is set by the GM (the rules text says after three turns; the sample cards say 1 Res / minute).</small>
        ${rowHtml}
    `;
}

function setSustainActive(spellId, active) {
    if (!dataManager.canEditActiveCharacter()) return;
    const state = dataManager.state;
    const { activeIds } = getSustainTracker(state.tiles || [], state.activeSustains);
    const next = new Set(activeIds);
    if (active) next.add(spellId); else next.delete(spellId);
    state.activeSustains = [...next];
    dataManager.saveState();
    renderSustainTracker();
}

function paySustain(spellId, resource) {
    if (!dataManager.canEditActiveCharacter()) return;
    const state = dataManager.state;
    const result = paySustainUpkeep(state, resource);
    if (!result.ok) {
        showAlert(result.reason);
        return;
    }
    state[result.key] = result.value;
    dataManager.saveState();
    if (renderAll) renderAll();
}

export function renderCondition() {
    if (!dataManager) return;
    renderStatusBadges();
    renderCritsDashboard();
    renderPressTracker();
    const { movement, bulkyTiles } = getMovement();
    renderMovementSummary(movement);
    renderMovementTracker(movement, bulkyTiles);
    renderSustainTracker();
}

/** @param {{dataManager: ConditionDataManager, renderAll: () => void}} deps */
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
        const target = e.target instanceof Element ? e.target : null;
        const critStep = target?.closest('.crit-step');
        if (critStep instanceof HTMLButtonElement) {
            adjustCrit(critStep.dataset.crit, toInt(critStep.dataset.step));
            return;
        }
        const pressButton = target?.closest('.btn-press');
        if (pressButton instanceof HTMLButtonElement) {
            executePress(pressButton.dataset.pressKind);
            return;
        }
        if (target?.closest('#btn-clear-fast-crits')) {
            clearFastCrits();
            return;
        }
        if (target?.closest('#btn-press-haywire')) {
            bumpPressCount(1);
            return;
        }
        if (target?.closest('#btn-press-reset')) {
            resetPressCount();
            return;
        }
        if (target?.closest('#btn-dash-slow')) {
            // "Take a SLOW Crit after Dashing." (p.35)
            adjustCrit('slow', 1);
            return;
        }
        const sustainPay = target?.closest('.btn-sustain-pay');
        if (sustainPay instanceof HTMLButtonElement) {
            paySustain(sustainPay.dataset.spellId || '', sustainPay.dataset.resource || '');
        }
    });

    els.conditionPanelBody?.addEventListener('change', (e) => {
        if (!(e.target instanceof HTMLInputElement)) return;
        if (['press-repeat', 'press-fast', 'press-recoil', 'press-reticle'].includes(e.target.id)) {
            renderPressTracker();
            return;
        }
        if (e.target.classList.contains('bulky-in-use')) {
            const id = e.target.dataset.tileId || '';
            if (e.target.checked) bulkyInUseIds.add(id); else bulkyInUseIds.delete(id);
            const { movement, bulkyTiles } = getMovement();
            renderMovementSummary(movement);
            renderMovementTracker(movement, bulkyTiles);
            return;
        }
        if (e.target.classList.contains('sustain-active')) {
            setSustainActive(e.target.dataset.spellId || '', e.target.checked);
        }
    });
}
