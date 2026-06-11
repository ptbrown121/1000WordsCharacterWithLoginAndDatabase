// Stranger panel (v5.02 pp.61-63): While X form switching, the Celestial
// Aural/Astral aspect, and the Bestial pace/resource notes. Hidden entirely
// for characters with no Stranger features.
import { els } from '../els.js';
import {
    applyFormToTiles,
    calculateBestialTileCount,
    calculateCelestialRank,
    escapeHtml,
    getCelestialAspectSummary,
    getCharacterForms,
    getTileWhileForms,
    tileHasBestialTag,
    tileTagList
} from '../pool.js';

let dataManager;
let renderAll;

function hasBestialResourceChoice(tile) {
    return tileTagList(tile).some(tag => /^(?:build\s*:|detail\s*:)?\s*bestial\s*:?\s*(hp|health|en|energy|rx|reflex)/i.test(String(tag).trim()));
}

function setCurrentForm(formName) {
    if (!dataManager.canEditActiveCharacter()) return;
    const state = dataManager.state;
    state.currentForm = String(formName || '');
    applyFormToTiles(state.tiles || [], state.currentForm);
    dataManager.saveState();
    if (renderAll) renderAll();
}

function renderFormSection(forms) {
    if (!els.strangerFormSection) return;
    if (forms.length === 0) {
        els.strangerFormSection.style.display = 'none';
        return;
    }

    els.strangerFormSection.style.display = '';
    const state = dataManager.state;
    const current = String(state.currentForm || '').toLowerCase();
    els.strangerFormSelect.innerHTML = '<option value="">No form (all While tiles buried)</option>' + forms.map(form => {
        const selected = form.toLowerCase() === current ? ' selected' : '';
        return `<option value="${escapeHtml(form)}"${selected}>${escapeHtml(form)}</option>`;
    }).join('');

    const whileTiles = (state.tiles || []).filter(tile => getTileWhileForms(tile).length > 0);
    const active = whileTiles.filter(tile => !tile.isBuried).map(tile => tile.name).filter(Boolean);
    const dormant = whileTiles.filter(tile => tile.isBuried).map(tile => tile.name).filter(Boolean);
    const parts = [];
    if (active.length) parts.push(`In play: ${active.join(', ')}`);
    if (dormant.length) parts.push(`Buried: ${dormant.join(', ')}`);
    els.strangerFormDetail.textContent = parts.join(' · ') || 'No While X tiles yet.';
}

function renderCelestialSection(rank) {
    if (!els.strangerCelestialSection) return;
    if (rank <= 0) {
        els.strangerCelestialSection.style.display = 'none';
        return;
    }

    els.strangerCelestialSection.style.display = '';
    const aspect = dataManager.state.celestialAspect || '';
    if (els.celestialAspectSelect.value !== aspect) els.celestialAspectSelect.value = aspect;
    els.celestialAspectDetail.textContent = getCelestialAspectSummary(rank, aspect);
}

function renderBestialNote(bestialCount) {
    if (!els.strangerBestialNote) return;
    if (bestialCount <= 0) {
        els.strangerBestialNote.style.display = 'none';
        return;
    }

    const tiles = dataManager.state.tiles || [];
    const unallocated = tiles
        .filter(tile => !tile.isBuried && tileHasBestialTag(tile) && !hasBestialResourceChoice(tile))
        .length;
    const parts = [
        `Bestial: Pace equals Walk. ${bestialCount} Bestial tile${bestialCount === 1 ? '' : 's'} grant${bestialCount === 1 ? 's' : ''} +1 resource each (set via Bestial: HP/EN/RX tags).`
    ];
    if (unallocated > 0) {
        parts.push(`${unallocated} tile${unallocated === 1 ? ' has' : 's have'} no resource chosen yet.`);
    }
    els.strangerBestialNote.style.display = 'block';
    els.strangerBestialNote.textContent = parts.join(' ');
}

export function renderStranger() {
    if (!dataManager || !els.strangerPanel) return;
    const tiles = dataManager.state.tiles || [];
    const forms = getCharacterForms(tiles);
    const celestialRank = calculateCelestialRank(tiles);
    const bestialCount = calculateBestialTileCount(tiles);

    if (forms.length === 0 && celestialRank <= 0 && bestialCount <= 0) {
        els.strangerPanel.hidden = true;
        return;
    }

    els.strangerPanel.hidden = false;
    const summary = [];
    if (forms.length > 0) summary.push(dataManager.state.currentForm ? `Form: ${dataManager.state.currentForm}` : 'No form');
    if (celestialRank > 0) {
        const aspect = dataManager.state.celestialAspect;
        summary.push(aspect ? `${aspect === 'aural' ? 'Aural' : 'Astral'} ${Math.min(7, celestialRank)}` : `Celestial ${celestialRank}`);
    }
    if (bestialCount > 0) summary.push(`Bestial ×${bestialCount}`);
    els.strangerSummary.textContent = summary.join(' · ');

    renderFormSection(forms);
    renderCelestialSection(celestialRank);
    renderBestialNote(bestialCount);
}

export function init(deps) {
    dataManager = deps.dataManager;
    renderAll = deps.renderAll;

    if (els.btnStrangerToggle && els.strangerPanelBody) {
        els.btnStrangerToggle.addEventListener('click', () => {
            const isOpening = els.strangerPanelBody.hidden;
            els.strangerPanelBody.hidden = !isOpening;
            els.btnStrangerToggle.setAttribute('aria-expanded', String(isOpening));
            els.btnStrangerToggle.textContent = isOpening ? 'Hide' : 'Show';
        });
    }

    els.strangerFormSelect?.addEventListener('change', (e) => {
        setCurrentForm(e.target.value);
    });

    els.celestialAspectSelect?.addEventListener('change', (e) => {
        if (!dataManager.canEditActiveCharacter()) return;
        dataManager.state.celestialAspect = ['aural', 'astral'].includes(e.target.value) ? e.target.value : '';
        dataManager.saveState();
        renderStranger();
    });
}
