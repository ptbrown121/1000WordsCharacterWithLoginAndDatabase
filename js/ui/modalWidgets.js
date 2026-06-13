// Form widgets shared by the tile modal and the spell builder (split
// 2026-06-12; these were duplicated verbatim in both files).
import { escapeHtml } from '../pool.js';

function isTextEditingElement(element) {
    if (!element) return false;
    if (element.tagName === 'TEXTAREA') return true;
    if (element.tagName !== 'INPUT') return false;
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'radio', 'range', 'reset', 'submit'].includes(element.type);
}

function dismissKeyboardPreservingScroll(button) {
    const active = document.activeElement;
    if (!isTextEditingElement(active)) return;
    if (!button.closest('.modal')?.contains(active)) return;

    const modalContent = button.closest('.modal-content');
    const modalScrollTop = modalContent?.scrollTop ?? 0;
    const windowScrollX = window.scrollX;
    const windowScrollY = window.scrollY;

    active.blur();

    const restoreScroll = () => {
        if (modalContent) modalContent.scrollTop = modalScrollTop;
        window.scrollTo(windowScrollX, windowScrollY);
    };
    requestAnimationFrame(restoreScroll);
    setTimeout(restoreScroll, 80);
    setTimeout(restoreScroll, 220);
}

// On iOS, tapping a button while a text input has focus dismisses the
// keyboard and can scroll the modal out from under the tap; handle the
// pointerdown ourselves and restore the scroll position.
export function bindStableTouchButton(button, handler) {
    let handledPointer = false;
    button.addEventListener('pointerdown', (e) => {
        handledPointer = true;
        e.preventDefault();
        dismissKeyboardPreservingScroll(button);
        handler(e);
    });
    button.addEventListener('click', (e) => {
        if (handledPointer) {
            handledPointer = false;
            e.preventDefault();
            return;
        }
        handler(e);
    });
}

// Button groups backed by a hidden control: each .tile-option-grid names
// its hidden input/select in data-target. Tapping a button writes the
// control's value and dispatches 'change', so existing readers and
// listeners keep working. syncOptionGrids re-derives the highlighted
// button from the control's value after programmatic writes (form.reset(),
// edit-mode population), which never fire 'change' on their own.
export function syncOptionGrids(root = document) {
    root.querySelectorAll('.tile-option-grid').forEach(grid => {
        const value = document.getElementById(grid.dataset.target || '')?.value || '';
        grid.querySelectorAll('.tile-box-option').forEach(button => {
            const isSelected = (button.dataset.value || '') === value;
            button.classList.toggle('active', isSelected);
            button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });
    });
}

// Scope `root` to the owning modal so two modals can bind independently
// without double-binding each other's grids.
export function bindOptionGrids(root = document) {
    root.querySelectorAll('.tile-option-grid').forEach(grid => {
        grid.querySelectorAll('.tile-box-option').forEach(button => {
            bindStableTouchButton(button, () => {
                const control = document.getElementById(grid.dataset.target || '');
                if (!control) return;
                control.value = button.dataset.value || '';
                control.dispatchEvent(new Event('change', { bubbles: true }));
                syncOptionGrids(root);
            });
        });
    });
}

// A native <select> upgraded into a tap-to-open panel whose first element
// is a filter box: the search field appears the moment the picker opens,
// instead of sitting beside the select where nobody discovers it. The
// select stays in the DOM (hidden) as the source of truth; picking an
// option sets its value and dispatches 'change', so existing listeners and
// programmatic .value writes keep working. The option list is rebuilt from
// the select on every open, so dynamically populated selects stay current.
export function createSearchableSelect(select, { searchPlaceholder = 'Type to filter...' } = {}) {
    if (!select) return { sync: () => {}, close: () => {} };

    const wrapper = document.createElement('div');
    wrapper.className = 'searchable-select';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'searchable-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const panel = document.createElement('div');
    panel.className = 'searchable-select-panel';
    panel.hidden = true;

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'searchable-select-search';
    search.placeholder = searchPlaceholder;
    search.autocomplete = 'off';
    search.setAttribute('aria-label', searchPlaceholder);

    const list = document.createElement('div');
    list.className = 'searchable-select-list';
    list.setAttribute('role', 'listbox');

    panel.append(search, list);
    wrapper.append(trigger, panel);
    select.insertAdjacentElement('afterend', wrapper);
    select.classList.add('searchable-select-native');

    function sync() {
        const option = select.options[select.selectedIndex];
        trigger.textContent = option?.textContent || ' ';
    }

    function appendOption(option, groupLabel, term) {
        if (term && !`${option.textContent} ${option.value} ${groupLabel}`.toLowerCase().includes(term)) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'searchable-select-option';
        button.setAttribute('role', 'option');
        if (option.value === select.value) button.classList.add('active');
        button.textContent = option.textContent;
        button.addEventListener('click', () => {
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            close();
        });
        list.appendChild(button);
    }

    function renderList() {
        const term = search.value.trim().toLowerCase();
        list.innerHTML = '';
        Array.from(select.children).forEach(node => {
            if (node instanceof HTMLOptGroupElement) {
                const label = document.createElement('div');
                label.className = 'searchable-select-group';
                label.textContent = node.label;
                list.appendChild(label);
                Array.from(node.children).forEach(option => appendOption(option, node.label, term));
                // Drop the label of a group the filter emptied out.
                if (list.lastChild === label) label.remove();
            } else if (node instanceof HTMLOptionElement) {
                appendOption(node, '', term);
            }
        });
        if (!list.children.length) {
            const empty = document.createElement('div');
            empty.className = 'searchable-select-empty';
            empty.textContent = 'No matches.';
            list.appendChild(empty);
        }
    }

    // Phone back button support: opening the panel pushes a history entry,
    // so pressing back pops it and closes the panel instead of leaving the
    // page. Closing any other way (pick, outside tap, Escape) consumes the
    // entry via history.back() to keep history balanced; the armed flag
    // makes sure we only ever consume our own entry.
    let historyEntryArmed = false;

    function open() {
        search.value = '';
        renderList();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        historyEntryArmed = true;
        history.pushState({ searchableSelect: select.id || true }, '');
        search.focus();
        // With the on-screen keyboard up only a slice of the page stays
        // visible. Pin the picker to the top of that slice and size the
        // list to the visual viewport so it gets the remaining space.
        // Re-assert after the keyboard animation: the browser's own
        // scroll-focused-input-into-view would otherwise win and leave
        // the picker near the keyboard with a few rows showing.
        const claimViewport = () => {
            if (panel.hidden) return;
            const viewportHeight = window.visualViewport?.height || window.innerHeight;
            // ~9rem reserved for the trigger, search box, and breathing room.
            list.style.maxHeight = `${Math.max(150, Math.min(viewportHeight - 145, 384))}px`;
            wrapper.scrollIntoView({ block: 'start' });
        };
        requestAnimationFrame(claimViewport);
        setTimeout(claimViewport, 300);
    }

    function close() {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        sync();
        if (historyEntryArmed) {
            historyEntryArmed = false;
            history.back();
        }
    }

    window.addEventListener('popstate', () => {
        if (panel.hidden) return;
        // The back button already removed our entry; disarm before closing
        // so close() doesn't call history.back() a second time.
        historyEntryArmed = false;
        close();
    });

    trigger.addEventListener('click', () => {
        if (panel.hidden) open(); else close();
    });
    search.addEventListener('input', renderList);
    search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            // Enter takes the first visible match.
            e.preventDefault();
            list.querySelector('.searchable-select-option')?.click();
        } else if (e.key === 'Escape') {
            close();
        }
    });
    document.addEventListener('click', (e) => {
        if (!panel.hidden && e.target instanceof Node && !wrapper.contains(e.target)) close();
    });
    select.addEventListener('change', sync);

    sync();
    return { sync, close };
}

// Dice entry: a comma-separated text input mirrored as removable chips,
// plus a grid of "+d6"-style add buttons. The input element stays the
// source of truth; setTokens dispatches 'input' so the existing listeners
// (tag-limit status, XP recalc) re-run and re-sync the chips.
export function createDiceTokenEditor({ input, chipsContainer, buttonsContainer }) {
    function getTokens() {
        return input.value
            .split(',')
            .map(token => token.trim())
            .filter(Boolean);
    }

    function setTokens(tokens) {
        input.value = tokens.join(', ');
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function addDie(die) {
        setTokens([...getTokens(), die]);
    }

    function syncChips() {
        if (!chipsContainer) return;
        chipsContainer.innerHTML = '';
        getTokens().forEach((die, index) => {
            const chip = document.createElement('span');
            chip.className = 'dice-selected-chip';

            const label = document.createElement('span');
            label.textContent = die;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'dice-remove-btn';
            removeBtn.textContent = '×';
            removeBtn.title = `Remove ${die}`;
            removeBtn.setAttribute('aria-label', `Remove ${die}`);
            removeBtn.addEventListener('click', () => {
                const nextTokens = getTokens();
                nextTokens.splice(index, 1);
                setTokens(nextTokens);
            });

            chip.appendChild(label);
            chip.appendChild(removeBtn);
            chipsContainer.appendChild(chip);
        });
    }

    buttonsContainer?.addEventListener('click', (e) => {
        const button = e.target.closest('.dice-add-btn');
        if (!button || !buttonsContainer.contains(button)) return;
        addDie(button.dataset.die);
    });

    return { getTokens, setTokens, addDie, syncChips };
}

// "You selected a tag but haven't added it" confirm dialog shown on save.
// Resolves with 'cancel', 'save', or 'add'.
export function showPendingTagDialog(pending, subjectLabel) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'modal active pending-tag-dialog';
        overlay.innerHTML = `
            <div class="modal-content glass-panel pending-tag-dialog-content" role="dialog" aria-modal="true" aria-labelledby="pending-tag-title">
                <h2 id="pending-tag-title">Add selected tag?</h2>
                <p>You selected <strong>${escapeHtml(pending.label)}</strong> for this ${subjectLabel}, but it has not been added yet.</p>
                ${pending.canAdd
                    ? `<p class="pending-tag-preview">Pending tag: <strong>${escapeHtml(pending.tag)}</strong></p>`
                    : `<p class="pending-tag-warning">${escapeHtml(pending.reason || 'Finish the tag details before adding it.')}</p>`}
                <div class="pending-tag-actions">
                    <button type="button" class="btn btn-outline" data-choice="cancel">Cancel</button>
                    <button type="button" class="btn btn-outline" data-choice="save">Save without tag</button>
                    ${pending.canAdd ? '<button type="button" class="btn btn-action" data-choice="add">Add tag and save</button>' : ''}
                </div>
            </div>
        `;

        const close = (choice) => {
            overlay.remove();
            resolve(choice);
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close('cancel');
            const button = e.target.closest('button[data-choice]');
            if (button && overlay.contains(button)) close(button.dataset.choice);
        });
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close('cancel');
        });
        document.body.appendChild(overlay);
        overlay.querySelector('button[data-choice="cancel"]')?.focus();
    });
}
