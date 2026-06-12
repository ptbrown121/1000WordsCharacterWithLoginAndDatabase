import { escapeHtml } from '../pool.js';
import { els } from '../els.js';

let dataManager;

export function init(deps) {
    dataManager = deps.dataManager;

    els.btnAddJournal.addEventListener('click', () => {
        if (!dataManager.state.journal) dataManager.state.journal = [];
        const title = prompt('Enter a title for this journal entry:', 'Session Notes');
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

        const header = div.querySelector('.journal-entry-header');
        const body = div.querySelector('.journal-entry-body');
        const toggleBtn = div.querySelector('.btn-toggle-journal');
        
        // Toggle expand/collapse
        header.addEventListener('click', (e) => {
            if (e.target.closest('.btn-rename-journal') || e.target.closest('.btn-delete-journal')) return;
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            toggleBtn.innerText = isOpen ? '▼' : '▲';
        });
        
        // Auto-save on typing
        const textarea = div.querySelector('textarea');
        textarea.addEventListener('input', () => {
            entry.content = textarea.value;
            dataManager.saveState();
        });
        
        // Rename
        div.querySelector('.btn-rename-journal').addEventListener('click', (e) => {
            e.stopPropagation();
            const newTitle = prompt('Rename this entry:', entry.title);
            if (newTitle) {
                entry.title = newTitle;
                dataManager.saveState();
                renderJournal();
            }
        });
        
        // Delete
        div.querySelector('.btn-delete-journal').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!confirm(`Delete journal entry "${entry.title}"?`)) return;
            dataManager.state.journal.splice(idx, 1);
            dataManager.saveState();
            renderJournal();
        });
        
        container.appendChild(div);
    });
}
