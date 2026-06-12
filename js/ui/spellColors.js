// DOM controls for the spell wizard's color/box selection. The spell
// modal is a singleton, so these operate on the document directly; the
// pure pricing rules live in js/spell-rules.js.
import { getTileBoxes, serializeTileBoxes } from '../pool.js';
import {
    SPELL_NORMAL_COLORS,
    SPELL_SHADOW_KINDS,
    getColorBuildFlags,
    getDefaultSpellBoxes
} from '../spell-rules.js';

export function isCustomColorMode() {
    const school = document.getElementById('spell-school').value;
    return school === 'Divergent' || Boolean(document.getElementById('spell-custom-colors')?.checked);
}

export function resetSpellColorControls() {
    const customColors = document.getElementById('spell-custom-colors');
    if (customColors) {
        customColors.checked = false;
        customColors.disabled = false;
    }
    document.querySelectorAll('.spell-color-cb').forEach(cb => {
        cb.checked = false;
    });
    document.querySelectorAll('.spell-shadow-resource').forEach(select => {
        select.value = '';
    });
    syncColorCustomizationControls();
}

export function applyDefaultSpellBoxes() {
    const school = document.getElementById('spell-school').value;
    const boxes = getDefaultSpellBoxes(school);
    document.querySelectorAll('.spell-color-cb').forEach(cb => {
        cb.checked = boxes.some(box => box.type === 'color' && box.color === cb.value);
    });
    document.querySelectorAll('.spell-shadow-resource').forEach(select => {
        select.value = '';
    });
    syncShadowResourceControls();
}

export function syncColorCustomizationControls(options = {}) {
    const school = document.getElementById('spell-school').value;
    const customColors = document.getElementById('spell-custom-colors');
    const colorsGroup = document.getElementById('spell-colors-group');
    const forcedCustom = school === 'Divergent';
    if (customColors) {
        customColors.disabled = forcedCustom;
        customColors.checked = forcedCustom || Boolean(customColors.checked);
    }

    const customMode = isCustomColorMode();
    if (colorsGroup) colorsGroup.style.display = customMode ? 'block' : 'none';

    if (!options.preserveSelection) {
        if (customMode && school !== 'Divergent') {
            applyDefaultSpellBoxes();
        } else if (!customMode) {
            document.querySelectorAll('.spell-color-cb').forEach(cb => {
                cb.checked = false;
            });
            document.querySelectorAll('.spell-shadow-resource').forEach(select => {
                select.value = '';
            });
            syncShadowResourceControls();
        }
    }

    syncShadowResourceControls();
    renderColorCostNote();
}

export function syncShadowResourceControls() {
    document.querySelectorAll('.spell-shadow-resource-row').forEach(row => {
        const kind = row.dataset.shadowKind;
        const cb = document.querySelector(`.spell-color-cb[value="${kind}"]`);
        const isChecked = Boolean(cb?.checked);
        row.style.display = isChecked ? 'block' : 'none';
        if (!isChecked) {
            const select = row.querySelector('.spell-shadow-resource');
            if (select) select.value = '';
        }
    });
    syncSpellBoxButtons();
}

function syncSpellBoxButtons() {
    document.querySelectorAll('.spell-box-option').forEach(button => {
        const cb = document.querySelector(`.spell-color-cb[value="${button.dataset.value}"]`);
        const active = Boolean(cb?.checked);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

export function toggleSpellBoxButton(value) {
    const cb = document.querySelector(`.spell-color-cb[value="${value}"]`);
    if (!cb) return;
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
}

export function restoreSpellBoxes(tile) {
    const boxes = getTileBoxes(tile);
    document.querySelectorAll('.spell-color-cb').forEach(cb => {
        cb.checked = boxes.some(box => box.type === 'shadow' ? box.kind === cb.value : box.color === cb.value);
    });
    document.querySelectorAll('.spell-shadow-resource').forEach(select => {
        const box = boxes.find(candidate => candidate.type === 'shadow' && candidate.kind === select.dataset.shadowKind);
        select.value = box?.resource || '';
    });
    syncShadowResourceControls();
}

export function getSpellBoxSelection() {
    const school = document.getElementById('spell-school').value;
    if (!isCustomColorMode()) {
        return { boxes: getDefaultSpellBoxes(school), error: null };
    }

    const boxes = [];
    document.querySelectorAll('.spell-color-cb:checked').forEach(cb => {
        if (SPELL_NORMAL_COLORS.has(cb.value)) {
            boxes.push({ type: 'color', color: cb.value });
        } else if (SPELL_SHADOW_KINDS.has(cb.value)) {
            const resource = document.querySelector(`.spell-shadow-resource[data-shadow-kind="${cb.value}"]`)?.value || '';
            boxes.push({ type: 'shadow', kind: cb.value, resource });
        }
    });

    if (boxes.length !== 2) {
        return { boxes, error: 'Custom Shadow/Divergent spells must select exactly 2 color boxes.' };
    }

    const missingResource = boxes.find(box => box.type === 'shadow' && !box.resource);
    if (missingResource) {
        return { boxes, error: `${missingResource.kind} spell boxes must choose Health, Energy, or Reflex.` };
    }

    return { boxes: serializeTileBoxes(boxes), error: null };
}

export function getColorBuildFlagsFromForm(boxes = getSpellBoxSelection().boxes) {
    return getColorBuildFlags({
        school: document.getElementById('spell-school').value,
        customMode: isCustomColorMode(),
        boxes
    });
}

export function renderColorCostNote() {
    const note = document.getElementById('spell-color-cost-note');
    if (!note) return;

    if (!isCustomColorMode()) {
        note.textContent = 'Standard school colors.';
        return;
    }

    const selection = getSpellBoxSelection();
    const flags = getColorBuildFlagsFromForm(selection.boxes);
    const labels = [];
    if (flags.shadow) labels.push('Shadow +2 XP');
    if (flags.divergent) labels.push('Divergent +2 XP');
    note.textContent = labels.length > 0
        ? `Color build: ${labels.join(' + ')} = ${flags.xp} XP.`
        : 'Color build: standard school colors, 0 XP.';
}
