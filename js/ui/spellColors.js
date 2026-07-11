// @ts-check
// DOM controls for the spell wizard's color/box selection. The spell
// modal is a singleton, so these operate on the document directly; the
// pure pricing rules live in js/spell-rules.js.
import { getTileBoxes, serializeTileBoxes } from '../pool.js';
import { editorElement, editorElements, optionalEditorElement } from './editorDom.js';
import { syncOptionGrids } from './modalWidgets.js';
import {
    SPELL_NORMAL_COLORS,
    SPELL_SHADOW_KINDS,
    getColorBuildFlags,
    getDefaultSpellBoxes
} from '../spell-rules.js';

export function isCustomColorMode() {
    const school = editorElement('spell-school').value;
    return school === 'Divergent' || Boolean(editorElement('spell-custom-colors')?.checked);
}

export function resetSpellColorControls() {
    const customColors = editorElement('spell-custom-colors');
    if (customColors) {
        customColors.checked = false;
        customColors.disabled = false;
    }
    editorElements(document, '.spell-color-cb', HTMLInputElement).forEach(cb => {
        cb.checked = false;
    });
    editorElements(document, '.spell-shadow-resource', HTMLSelectElement).forEach(select => {
        select.value = '';
    });
    syncColorCustomizationControls();
}

export function applyDefaultSpellBoxes() {
    const school = editorElement('spell-school').value;
    const boxes = getDefaultSpellBoxes(school);
    editorElements(document, '.spell-color-cb', HTMLInputElement).forEach(cb => {
        cb.checked = boxes.some(box => box.type === 'color' && box.color === cb.value);
    });
    editorElements(document, '.spell-shadow-resource', HTMLSelectElement).forEach(select => {
        select.value = '';
    });
    syncShadowResourceControls();
}

export function syncColorCustomizationControls(options = {}) {
    const school = editorElement('spell-school').value;
    const customColors = editorElement('spell-custom-colors');
    const colorsGroup = editorElement('spell-colors-group');
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
            editorElements(document, '.spell-color-cb', HTMLInputElement).forEach(cb => {
                cb.checked = false;
            });
            editorElements(document, '.spell-shadow-resource', HTMLSelectElement).forEach(select => {
                select.value = '';
            });
            syncShadowResourceControls();
        }
    }

    syncShadowResourceControls();
    renderColorCostNote();
}

export function syncShadowResourceControls() {
    editorElements(document, '.spell-shadow-resource-row', HTMLElement).forEach(row => {
        const kind = row.dataset.shadowKind;
        const cb = optionalEditorElement(document, `.spell-color-cb[value="${kind}"]`, HTMLInputElement);
        const isChecked = Boolean(cb?.checked);
        row.style.display = isChecked ? 'block' : 'none';
        if (!isChecked) {
            const select = optionalEditorElement(row, '.spell-shadow-resource', HTMLSelectElement);
            if (select) select.value = '';
        }
    });
    syncSpellBoxButtons();
    // Every programmatic write to spell-school or a shadow-resource select
    // (form.reset, edit restore, default boxes) funnels through here, so
    // this one call keeps all the spell modal's button grids highlighted
    // correctly.
    syncOptionGrids(editorElement('spell-modal') || document);
}

function syncSpellBoxButtons() {
    editorElements(document, '.spell-box-option', HTMLButtonElement).forEach(button => {
        const cb = optionalEditorElement(document, `.spell-color-cb[value="${button.dataset.value}"]`, HTMLInputElement);
        const active = Boolean(cb?.checked);
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
}

export function toggleSpellBoxButton(value) {
    const cb = optionalEditorElement(document, `.spell-color-cb[value="${value}"]`, HTMLInputElement);
    if (!cb) return;
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
}

export function restoreSpellBoxes(tile) {
    const boxes = getTileBoxes(tile);
    editorElements(document, '.spell-color-cb', HTMLInputElement).forEach(cb => {
        cb.checked = boxes.some(box => box.type === 'shadow' ? box.kind === cb.value : box.color === cb.value);
    });
    editorElements(document, '.spell-shadow-resource', HTMLSelectElement).forEach(select => {
        const box = boxes.find(candidate => candidate.type === 'shadow' && candidate.kind === select.dataset.shadowKind);
        select.value = box?.resource || '';
    });
    syncShadowResourceControls();
}

/** @returns {{boxes: import('../types.js').TileBox[], error: string|null}} */
export function getSpellBoxSelection() {
    const school = editorElement('spell-school').value;
    if (!isCustomColorMode()) {
        return { boxes: getDefaultSpellBoxes(school), error: null };
    }

    /** @type {import('../types.js').TileBox[]} */
    const boxes = [];
    editorElements(document, '.spell-color-cb:checked', HTMLInputElement).forEach(cb => {
        if (SPELL_NORMAL_COLORS.has(/** @type {import('../types.js').NormalColor} */ (cb.value))) {
            boxes.push({ type: 'color', color: /** @type {import('../types.js').NormalColor} */ (cb.value) });
        } else if (SPELL_SHADOW_KINDS.has(/** @type {'Qi'|'Id'} */ (cb.value))) {
            const resource = optionalEditorElement(document, `.spell-shadow-resource[data-shadow-kind="${cb.value}"]`, HTMLSelectElement)?.value || '';
            boxes.push({
                type: 'shadow',
                kind: /** @type {'Qi'|'Id'} */ (cb.value),
                resource: /** @type {import('../types.js').ResourceKey|''} */ (resource)
            });
        }
    });

    if (boxes.length !== 2) {
        return { boxes, error: 'Custom Shadow/Divergent spells must select exactly 2 color boxes.' };
    }

    const missingResource = boxes.find(box => box.type === 'shadow' && !box.resource);
    if (missingResource) {
        return { boxes, error: `${missingResource.kind} spell boxes must choose Health, Energy, or Reflex.` };
    }

    return { boxes: /** @type {import('../types.js').TileBox[]} */ (serializeTileBoxes(boxes)), error: null };
}

/** @param {import('../types.js').TileBox[]} [boxes] */
export function getColorBuildFlagsFromForm(boxes = getSpellBoxSelection().boxes) {
    return getColorBuildFlags({
        school: editorElement('spell-school').value,
        customMode: isCustomColorMode(),
        boxes
    });
}

export function renderColorCostNote() {
    const note = editorElement('spell-color-cost-note');
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
