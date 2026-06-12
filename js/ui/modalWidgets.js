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
