// @ts-check
// Keep the comma-separated value consumed by resolution rules behind a
// tap-only picker. Repeated tags remain separate entries for Shield matching.
import { escapeHtml } from '../pool.js';
import { parseCritList } from '../resolution-rules.js';
import { CRIT_DASHBOARD } from '../status-rules.js';
import { requiredEditorElement } from './editorDom.js';

function renderSelectedCrits(value) {
    const counts = new Map();
    parseCritList(value).forEach(crit => counts.set(crit, (counts.get(crit) || 0) + 1));
    if (!counts.size) return '<span class="hint-text">No Crit tags selected.</span>';
    return [...counts].map(([crit, count]) => {
        const label = escapeHtml(crit.toUpperCase());
        return `<span class="crit-picker-tag">
            <span>${label} ×${count}</span>
            <button type="button" data-crit="${escapeHtml(crit)}" data-crit-step="-1" aria-label="Remove one ${label}">−</button>
            <button type="button" data-crit="${escapeHtml(crit)}" data-crit-step="1" aria-label="Add one ${label}">+</button>
        </span>`;
    }).join('');
}

export function renderCritPicker(id, label, value) {
    return `<fieldset class="crit-picker">
        <legend>${escapeHtml(label)}</legend>
        <input id="${escapeHtml(id)}" class="resolution-extra" type="hidden" value="${escapeHtml(value)}">
        <select class="crit-picker-select" aria-label="${escapeHtml(label)}: add a tag">
            <option value="">-- Add Crit tag --</option>
            ${CRIT_DASHBOARD.map(crit => `<option value="${crit.id}">${crit.label}</option>`).join('')}
        </select>
        <div class="crit-picker-selected" aria-live="polite">${renderSelectedCrits(value)}</div>
    </fieldset>`;
}

function updateCritPicker(picker, crit, step) {
    const input = requiredEditorElement(picker, 'input', HTMLInputElement);
    const crits = parseCritList(input.value);
    if (step > 0) {
        crits.push(crit);
    } else {
        const index = crits.indexOf(crit);
        if (index !== -1) crits.splice(index, 1);
    }
    input.value = crits.map(entry => entry.toUpperCase()).join(', ');
    requiredEditorElement(picker, '.crit-picker-selected', HTMLElement).innerHTML = renderSelectedCrits(input.value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** @param {HTMLInputElement|HTMLSelectElement} target */
export function handleCritPickerChange(target) {
    if (!(target instanceof HTMLSelectElement) || !target.classList.contains('crit-picker-select')) return false;
    const picker = target.closest('.crit-picker');
    if (picker && CRIT_DASHBOARD.some(crit => crit.id === target.value)) {
        updateCritPicker(picker, target.value, 1);
        target.value = '';
    }
    return true;
}

/** @param {HTMLElement} target */
export function handleCritPickerClick(target) {
    const button = target.closest('button[data-crit-step]');
    if (!(button instanceof HTMLButtonElement) || !button.dataset.crit) return false;
    const picker = button.closest('.crit-picker');
    if (!picker) return false;
    const crit = button.dataset.crit;
    const step = button.dataset.critStep === '1' ? 1 : -1;
    updateCritPicker(picker, crit, step);
    // Updating the chips replaces this button. Keep keyboard focus on the
    // corresponding control, or return to the picker after the last removal.
    const replacement = picker.querySelector(`button[data-crit="${CSS.escape(crit)}"][data-crit-step="${step}"]`);
    if (replacement instanceof HTMLButtonElement) replacement.focus({ preventScroll: true });
    else requiredEditorElement(picker, 'select', HTMLSelectElement).focus({ preventScroll: true });
    return true;
}
