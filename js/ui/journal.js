// @ts-check
import { escapeHtml } from '../pool.js';
import { els } from '../els.js';
import { showConfirm, showPrompt } from './dialogService.js';
import { requiredEditorElement } from './editorDom.js';

/** @typedef {{state: import('../types.js').CharacterState, saveState: () => void}} JournalDataManager */
/** @type {JournalDataManager} */
let dataManager;

/** @param {{dataManager: JournalDataManager}} deps */
export function init(deps) {
    dataManager = deps.dataManager;

    els.btnAddJournal.addEventListener('click', async () => {
        if (!dataManager.state.journal) dataManager.state.journal = [];
        const title = await showPrompt('Enter a title for this journal entry:', { title: 'New journal entry', defaultValue: 'Session Notes' });
        if (!title) return;
        dataManager.state.journal.push({
            id: crypto.randomUUID(),
            title: title,
            content: ''
        });
        dataManager.saveState();
        renderJournal();
    });
}

export function renderJournal() {
    const container = els.journalContainer;
    const entries = dataManager.state.journal || [];
    
    if (entries.length === 0) {
        container.innerHTML = '<p class="empty-note">No journal entries yet. Click "+ New Entry" to get started.</p>';
        return;
    }
    
    container.innerHTML = '';
    entries.forEach((entry, idx) => {
        const div = document.createElement('div');
        div.className = 'journal-entry';
        div.innerHTML = `
            <div class="journal-entry-header">
                <h3>${escapeHtml(entry.title)}</h3>
                <div class="journal-actions">
                    <button class="btn-rename-journal" title="Rename">✏️</button>
                    <button class="btn-toggle-journal" title="Expand/Collapse">▼</button>
                    <button class="btn-delete-journal" title="Delete">🗑️</button>
                </div>
            </div>
            <div class="journal-entry-body" style="display: none;">
                <textarea placeholder="Write your notes here...">${escapeHtml(entry.content || '')}</textarea>
            </div>
        `;

        const header = requiredEditorElement(div, '.journal-entry-header', HTMLElement);
        const body = requiredEditorElement(div, '.journal-entry-body', HTMLElement);
        const toggleBtn = requiredEditorElement(div, '.btn-toggle-journal', HTMLButtonElement);
        
        // Toggle expand/collapse
        header.addEventListener('click', (e) => {
            const target = e.target instanceof Element ? e.target : null;
            if (target?.closest('.btn-rename-journal') || target?.closest('.btn-delete-journal')) return;
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            toggleBtn.innerText = isOpen ? '▼' : '▲';
        });
        
        // Auto-save on typing
        const textarea = requiredEditorElement(div, 'textarea', HTMLTextAreaElement);
        textarea.addEventListener('input', () => {
            entry.content = textarea.value;
            dataManager.saveState();
        });
        
        // Rename
        requiredEditorElement(div, '.btn-rename-journal', HTMLButtonElement).addEventListener('click', async (e) => {
            e.stopPropagation();
            const newTitle = await showPrompt('Rename this entry:', { title: 'Rename journal entry', defaultValue: entry.title });
            if (newTitle) {
                entry.title = newTitle;
                dataManager.saveState();
                renderJournal();
            }
        });
        
        // Delete
        requiredEditorElement(div, '.btn-delete-journal', HTMLButtonElement).addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!await showConfirm(`Delete journal entry "${entry.title}"?`, { title: 'Delete journal entry?', confirmLabel: 'Delete entry', danger: true })) return;
            entries.splice(idx, 1);
            dataManager.saveState();
            renderJournal();
        });
        
        container.appendChild(div);
    });
}
