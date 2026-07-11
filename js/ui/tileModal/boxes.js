// @ts-check
// The tile-box editor: two box slots (three for special identity tiles),
// each either a call color or a Qi/Id shadow box tied to a resource.
import { serializeTileBoxes } from '../../pool.js';
import { editorElement, editorElements, optionalEditorElement } from '../editorDom.js';
import { getFormSpecialIdentity } from './formFields.js';

export function isShadowBoxValue(value) {
    return value === 'Qi' || value === 'Id';
}

// Special identity tiles (Titan Identity / Homeworld) gain a third box;
// show or hide the Box 3 column and keep the picker label honest.
export function syncSpecialIdentityVisibility() {
    const specialIdentity = getFormSpecialIdentity();
    const boxRow = optionalEditorElement(document, '.tile-box-row[data-box-index="2"]', HTMLElement);
    const label = editorElement('tile-box-editor-label');
    if (boxRow) boxRow.style.display = specialIdentity ? '' : 'none';
    if (label) label.textContent = specialIdentity ? 'Tile Boxes (Pick 3)' : 'Tile Boxes (Pick 2)';
    if (!specialIdentity) setTileBoxValue(2, '');
}

export function syncTileBoxResourceVisibility() {
    editorElements(document, '.tile-box-type', HTMLInputElement).forEach(typeSelect => {
        const index = typeSelect.dataset.boxIndex;
        const resourceSelect = optionalEditorElement(document, `.tile-box-resource[data-box-index="${index}"]`, HTMLSelectElement);
        if (!resourceSelect) return;
        const isShadow = isShadowBoxValue(typeSelect.value);
        resourceSelect.style.display = isShadow ? 'block' : 'none';
        if (!isShadow) resourceSelect.value = '';
    });
    syncTileBoxButtons();
}

function syncTileBoxButtons() {
    editorElements(document, '.tile-box-button-grid', HTMLElement).forEach(grid => {
        const index = grid.dataset.boxIndex;
        const selectedValue = optionalEditorElement(document, `.tile-box-type[data-box-index="${index}"]`, HTMLInputElement)?.value || '';
        editorElements(grid, '.tile-box-option', HTMLButtonElement).forEach(button => {
            const isSelected = button.dataset.value === selectedValue;
            button.classList.toggle('active', isSelected);
            button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });
    });
}

export function setTileBoxValue(index, value) {
    const typeInput = optionalEditorElement(document, `.tile-box-type[data-box-index="${index}"]`, HTMLInputElement);
    if (!typeInput) return;
    typeInput.value = value;
    typeInput.dispatchEvent(new Event('change', { bubbles: true }));
}

/** @returns {import('../../types.js').TileBox[]} */
export function getFormBoxes() {
    const boxes = editorElements(document, '.tile-box-type', HTMLInputElement).map(typeSelect => {
        const value = typeSelect.value;
        const index = typeSelect.dataset.boxIndex;
        const resource = optionalEditorElement(document, `.tile-box-resource[data-box-index="${index}"]`, HTMLSelectElement)?.value || '';
        if (isShadowBoxValue(value)) return { type: 'shadow', kind: value, resource };
        if (value) return { type: 'color', color: value };
        return null;
    }).filter(box => box !== null);
    return /** @type {import('../../types.js').TileBox[]} */ (serializeTileBoxes(boxes, 3));
}

export function setFormBoxes(boxes = []) {
    const normalized = serializeTileBoxes(boxes, 3);
    editorElements(document, '.tile-box-type', HTMLInputElement).forEach(typeSelect => {
        const index = parseInt(typeSelect.dataset.boxIndex || '', 10);
        const box = normalized[index] || null;
        typeSelect.value = box ? (box.type === 'shadow' ? box.kind || '' : box.color || '') : '';
        const resourceSelect = optionalEditorElement(document, `.tile-box-resource[data-box-index="${index}"]`, HTMLSelectElement);
        if (resourceSelect) resourceSelect.value = box?.type === 'shadow' ? box.resource || '' : '';
    });
    syncTileBoxResourceVisibility();
}
