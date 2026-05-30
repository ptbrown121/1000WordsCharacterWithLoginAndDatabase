import { uiState } from '../state.js';
import { els } from '../els.js';

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

    if (els.charRosterSelect) {
        els.charRosterSelect.addEventListener('change', async (e) => {
            await dataManager.switchCharacter(e.target.value);
            uiState.callTile = null;
            uiState.hitchCallTiles = [];
            uiState.burnTiles = [];
            renderAll();
        });
    }

    if (els.btnDelChar) {
        els.btnDelChar.addEventListener('click', async () => {
            if (confirm("WARNING: Are you sure you want to delete this character permanently?")) {
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
        const name = prompt("Enter a name for your new character:");
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
            const overwrite = confirm("Do you want to overwrite your current character? (Click 'Cancel' to import as a new character slot)");
            if (await dataManager.importState(ev.target.result, overwrite)) {
                uiState.callTile = null;
                uiState.hitchCallTiles = [];
                uiState.burnTiles = [];
                renderAll();
            } else {
                alert("Failed to import invalid file.");
            }
            els.fileImport.value = '';
        };
        reader.readAsText(file);
    });
}

export function renderRosterSelect() {
    if (!els.charRosterSelect) return;
    els.charRosterSelect.innerHTML = '';
    const groups = new Map();
    dataManager.roster.forEach(r => {
        const groupName = r.group || (r.source === 'cloud' ? 'My Characters' : 'Local Characters');
        if (!groups.has(groupName)) {
            const group = document.createElement('optgroup');
            group.label = groupName;
            groups.set(groupName, group);
            els.charRosterSelect.appendChild(group);
        }
        const opt = document.createElement('option');
        opt.value = r.id;
        const suffix = r.readOnly ? ' (view only)' : (r.campaignName ? ` (${r.campaignName})` : '');
        opt.textContent = `${r.name || 'Unnamed'}${suffix}`;
        if (r.id === dataManager.activeCharId) opt.selected = true;
        groups.get(groupName).appendChild(opt);
    });
}
