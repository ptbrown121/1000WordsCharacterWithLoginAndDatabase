// The tile-box editor: two box slots (three for special identity tiles),
// each either a call color or a Qi/Id shadow box tied to a resource.
import { serializeTileBoxes } from '../../pool.js';
import { getFormSpecialIdentity } from './formFields.js';

export function isShadowBoxValue(value) {
    return value === 'Qi' || value === 'Id';
}

// Special identity tiles (Titan Identity / Homeworld) gain a third box;
// show or hide the Box 3 column and keep the picker label honest.
export function syncSpecialIdentityVisibility() {
    const specialIdentity = getFormSpecialIdentity();
    const boxRow = document.querySelector('.tile-box-row[data-box-index="2"]');
    const label = document.getElementById('tile-box-editor-label');
    if (boxRow) boxRow.style.display = specialIdentity ? '' : 'none';
    if (label) label.textContent = specialIdentity ? 'Tile Boxes (Pick 3)' : 'Tile Boxes (Pick 2)';
    if (!specialIdentity) setTileBoxValue(2, '');
}

export function syncTileBoxResourceVisibility() {
    document.querySelectorAll('.tile-box-type').forEach(typeSelect => {
        const index = typeSelect.dataset.boxIndex;
        const resourceSelect = document.querySelector(`.tile-box-resource[data-box-index="${index}"]`);
        if (!resourceSelect) return;
        const isShadow = isShadowBoxValue(typeSelect.value);
        resourceSelect.style.display = isShadow ? 'block' : 'none';
        if (!isShadow) resourceSelect.value = '';
    });
    syncTileBoxButtons();
}

function syncTileBoxButtons() {
    document.querySelectorAll('.tile-box-button-grid').forEach(grid => {
        const index = grid.dataset.boxIndex;
        const selectedValue = document.querySelector(`.tile-box-type[data-box-index="${index}"]`)?.value || '';
        grid.querySelectorAll('.tile-box-option').forEach(button => {
            const isSelected = button.dataset.value === selectedValue;
            button.classList.toggle('active', isSelected);
            button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });
    });
}

export function setTileBoxValue(index, value) {
    const typeInput = document.querySelector(`.tile-box-type[data-box-index="${index}"]`);
    if (!typeInput) return;
    typeInput.value = value;
    typeInput.dispatchEvent(new Event('change', { bubbles: true }));
}

export function getFormBoxes() {
    return Array.from(document.querySelectorAll('.tile-box-type')).map(typeSelect => {
        const value = typeSelect.value;
        const index = typeSelect.dataset.boxIndex;
        const resource = document.querySelector(`.tile-box-resource[data-box-index="${index}"]`)?.value || '';
        if (isShadowBoxValue(value)) return { type: 'shadow', kind: value, resource };
        if (value) return { type: 'color', color: value };
        return null;
    }).filter(Boolean);
}

export function setFormBoxes(boxes = []) {
    const normalized = serializeTileBoxes(boxes, 3);
    document.querySelectorAll('.tile-box-type').forEach(typeSelect => {
        const index = parseInt(typeSelect.dataset.boxIndex, 10);
        const box = normalized[index] || null;
        typeSelect.value = box ? (box.type === 'shadow' ? box.kind : box.color) : '';
        const resourceSelect = document.querySelector(`.tile-box-resource[data-box-index="${index}"]`);
        if (resourceSelect) resourceSelect.value = box?.type === 'shadow' ? box.resource || '' : '';
    });
    syncTileBoxResourceVisibility();
}
