// Titan panel (v5.02 p.69). Titan max derives from Titan tags on tiles;
// abilities come from the Titan tags the character carries; the H/V tracker
// records Heroism (+) and Villainy (-), which the GM trades for Titan points
// at story beats. Hidden entirely for characters with no Titan tags.
import { els } from '../els.js';
import { getEffectiveMax } from '../data.js';
import { calculateTitanMax, escapeHtml, getTitanAbilities } from '../pool.js';

let dataManager;
let renderAll;

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

export function getTitanEffectiveMax(state) {
    return getEffectiveMax(state, 'titan', calculateTitanMax(state?.tiles || []));
}

function formatHvScore(score) {
    if (score > 0) return `Heroism ${score}`;
    if (score < 0) return `Villainy ${-score}`;
    return 'Balanced 0';
}

function spendTitanAbility(abilityId) {
    if (!dataManager.canEditActiveCharacter()) return;
    const state = dataManager.state;
    const current = toInt(state.titan);
    const ability = getTitanAbilities(state.tiles || []).find(entry => entry.id === abilityId);
    if (!ability) return;

    if (current <= 0 && !state.gmOverride) {
        alert('No Titan available to spend.');
        return;
    }

    const hvText = ability.hv === null
        ? ' Adjust H/V manually for the direction you chose.'
        : ability.hv !== 0
            ? ` ${ability.hv > 0 ? `+${ability.hv} Heroism` : `${-ability.hv} Villainy`} is recorded.`
            : '';
    if (!confirm(`Spend 1 Titan on ${ability.label}? (${ability.effect})${hvText}`)) return;

    state.titan = Math.max(0, current - 1);
    if (typeof ability.hv === 'number' && ability.hv !== 0) {
        state.titanHV = toInt(state.titanHV) + ability.hv;
    }
    if (abilityId === 'action hero') {
        state.pressCount = 0;
    }
    dataManager.saveState();
    if (renderAll) renderAll();
}

function adjustHv(step) {
    if (!dataManager.canEditActiveCharacter()) return;
    dataManager.state.titanHV = toInt(dataManager.state.titanHV) + step;
    dataManager.saveState();
    renderTitan();
}

// Story beat (p.69): "the GM can reset the score in exchange for some or all
// Titan points." The granted amount is GM-set; current Titan caps at max.
function tradeHvForTitan() {
    if (!dataManager.canEditActiveCharacter()) return;
    const state = dataManager.state;
    const score = toInt(state.titanHV);
    if (score === 0) {
        alert('No Heroism/Villainy score to trade.');
        return;
    }

    const granted = parseInt(prompt(`Story beat: the GM resets ${formatHvScore(score)} in exchange for Titan points. How many points are granted?`, String(Math.abs(score))), 10);
    if (!Number.isFinite(granted) || granted < 0) return;

    state.titanHV = 0;
    state.titan = Math.min(getTitanEffectiveMax(state), toInt(state.titan) + granted);
    dataManager.saveState();
    if (renderAll) renderAll();
}

export function renderTitan() {
    if (!dataManager || !els.titanPanel) return;
    const state = dataManager.state;
    const effectiveMax = getTitanEffectiveMax(state);

    if (effectiveMax <= 0) {
        els.titanPanel.hidden = true;
        return;
    }

    els.titanPanel.hidden = false;
    const current = toInt(state.titan);
    const score = toInt(state.titanHV);
    els.titanDisplay.textContent = `${current} / ${effectiveMax} · ${formatHvScore(score)}`;
    if (els.valTitan && document.activeElement !== els.valTitan) {
        els.valTitan.value = current;
    }

    if (els.titanHvTracker) {
        els.titanHvTracker.innerHTML = `
            <div class="press-tracker-row">
                <span class="press-count" title="Heroism cancels Villainy and vice versa">${escapeHtml(formatHvScore(score))}</span>
                <button type="button" class="btn btn-outline" id="btn-titan-hero" title="Record an act of Heroism (protect, heal, keep order)">+1 H</button>
                <button type="button" class="btn btn-outline" id="btn-titan-villain" title="Record an act of Villainy (injure, destroy, incite chaos)">+1 V</button>
                <button type="button" class="btn btn-outline" id="btn-titan-trade" title="Story beat: GM resets the score in exchange for Titan points">Trade for Titan</button>
            </div>
        `;
    }

    if (!els.titanAbilities) return;
    const abilities = getTitanAbilities(state.tiles || []);
    els.titanAbilities.innerHTML = abilities.length
        ? abilities.map(ability => {
            const hvMark = ability.hv === null ? ' [H/V]' : ability.hv > 0 ? ` [H+${ability.hv}]` : ability.hv < 0 ? ` [V+${-ability.hv}]` : '';
            return `
                <div class="core-ability-row">
                    <button type="button" class="btn btn-outline btn-titan-spend" data-ability="${ability.id}"${current <= 0 && !state.gmOverride ? ' disabled' : ''}>Spend 1</button>
                    <span><strong>${escapeHtml(ability.label)}</strong>${escapeHtml(hvMark)}: ${escapeHtml(ability.effect)} <small>(${escapeHtml(ability.sources.join(', '))})</small></span>
                </div>
            `;
        }).join('')
        : '<small>No Titan ability tags (Action Hero, Ground Zero, Zero In, ...) on any tile yet.</small>';
}

export function init(deps) {
    dataManager = deps.dataManager;
    renderAll = deps.renderAll;

    if (els.btnTitanToggle && els.titanPanelBody) {
        els.btnTitanToggle.addEventListener('click', () => {
            const isOpening = els.titanPanelBody.hidden;
            els.titanPanelBody.hidden = !isOpening;
            els.btnTitanToggle.setAttribute('aria-expanded', String(isOpening));
            els.btnTitanToggle.textContent = isOpening ? 'Hide' : 'Show';
        });
    }

    els.valTitan?.addEventListener('change', (e) => {
        if (!dataManager.canEditActiveCharacter()) return;
        dataManager.state.titan = Math.max(0, toInt(e.target.value));
        dataManager.saveState();
        renderTitan();
    });

    els.titanPanelBody?.addEventListener('click', (e) => {
        const spend = e.target.closest('.btn-titan-spend');
        if (spend) {
            spendTitanAbility(spend.dataset.ability);
            return;
        }
        if (e.target.closest('#btn-titan-hero')) {
            adjustHv(1);
            return;
        }
        if (e.target.closest('#btn-titan-villain')) {
            adjustHv(-1);
            return;
        }
        if (e.target.closest('#btn-titan-trade')) {
            tradeHvForTitan();
        }
    });
}
