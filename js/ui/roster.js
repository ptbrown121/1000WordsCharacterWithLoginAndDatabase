import { uiState } from '../state.js';
import { els } from '../els.js';
import { showAlert, showConfirm, showPrompt } from './dialogService.js';

let dataManager;
let renderAll;

export function init(deps) {
    dataManager = deps.dataManager;
    renderAll = deps.renderAll;

    // Character name blur
    els.charName.addEventListener('blur', (e) => {
        dataManager.updateName(e.target.value);
        renderRosterSelect();
    });

    if (els.charRosterList) {
        els.charRosterList.addEventListener('click', async (e) => {
            const button = e.target.closest('.char-roster-btn');
            if (!button || button.classList.contains('active')) return;
            await dataManager.switchCharacter(button.dataset.charId);
            uiState.callTile = null;
            uiState.hitchCallTiles = [];
            uiState.burnTiles = [];
            renderAll();
        });
    }

    if (els.btnDelChar) {
        els.btnDelChar.addEventListener('click', async () => {
            if (await showConfirm('Are you sure you want to delete this character permanently?', { title: 'Delete character?', confirmLabel: 'Delete permanently', danger: true })) {
                await dataManager.deleteCurrentCharacter();
                uiState.callTile = null;
                uiState.hitchCallTiles = [];
                uiState.burnTiles = [];
                renderAll();
            }
        });
    }

    // New Character Button
    els.btnNewChar.addEventListener('click', async () => {
        const name = await showPrompt('Enter a name for your new character:', { title: 'New character', confirmLabel: 'Create character' });
        if (name) {
            await dataManager.createNewCharacter(name);
            uiState.callTile = null;
            uiState.hitchCallTiles = [];
            uiState.burnTiles = [];
            renderAll();
        }
    });

    // Export/Import
    els.btnExport.addEventListener('click', () => dataManager.exportState());
    els.fileImport.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const overwrite = await showConfirm('Choose where to import this character.', { title: 'Import character', confirmLabel: 'Overwrite current', cancelLabel: 'Create new slot' });
            if (await dataManager.importState(ev.target.result, overwrite)) {
                uiState.callTile = null;
                uiState.hitchCallTiles = [];
                uiState.burnTiles = [];
                renderAll();
            } else {
                showAlert('Failed to import invalid file.');
            }
            els.fileImport.value = '';
        };
        reader.readAsText(file);
    });
}

// One button per roster entry, grouped like the old dropdown's optgroups,
// with the active character highlighted.
export function renderRosterSelect() {
    if (!els.charRosterList) return;
    els.charRosterList.innerHTML = '';
    const groups = new Map();
    dataManager.roster.forEach(r => {
        const groupName = r.group || (r.source === 'cloud' ? 'My Characters' : 'Local Characters');
        if (!groups.has(groupName)) {
            const group = document.createElement('div');
            group.className = 'char-roster-group';
            const label = document.createElement('span');
            label.className = 'char-roster-group-label';
            label.textContent = groupName;
            group.appendChild(label);
            groups.set(groupName, group);
            els.charRosterList.appendChild(group);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'char-roster-btn';
        button.dataset.charId = r.id;
        const suffix = r.readOnly ? ' (view only)' : (r.campaignName ? ` (${r.campaignName})` : '');
        button.textContent = `${r.name || 'Unnamed'}${suffix}`;
        const isActive = r.id === dataManager.activeCharId;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        groups.get(groupName).appendChild(button);
    });
    // A lone group's label ("Local Characters") is just noise.
    if (groups.size === 1) {
        els.charRosterList.querySelector('.char-roster-group-label')?.remove();
    }
}
