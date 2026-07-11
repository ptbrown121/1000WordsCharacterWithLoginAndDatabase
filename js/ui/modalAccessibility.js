const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

const modalState = new WeakMap();

function isVisible(element) {
    return element instanceof HTMLElement
        && !element.hidden
        && element.getClientRects().length > 0;
}

function focusableElements(modal) {
    return [...modal.querySelectorAll(FOCUSABLE_SELECTOR)].filter(isVisible);
}

function openModals() {
    return [...document.querySelectorAll('.modal.active')].filter(isVisible);
}

function focusModal(modal) {
    const preferred = modal.dataset.initialFocus
        ? modal.querySelector(modal.dataset.initialFocus)
        : null;
    const target = isVisible(preferred) ? preferred : focusableElements(modal)[0] || modal;
    target.focus({ preventScroll: true });
}

function syncModal(modal) {
    const state = modalState.get(modal);
    if (!state) return;
    const isOpen = modal.classList.contains('active');
    if (isOpen === state.isOpen) return;
    state.isOpen = isOpen;
    modal.setAttribute('aria-hidden', String(!isOpen));

    if (isOpen) {
        const active = document.activeElement;
        state.returnFocus = active instanceof HTMLElement && !modal.contains(active) ? active : null;
        requestAnimationFrame(() => {
            if (modal.classList.contains('active')) focusModal(modal);
        });
        return;
    }

    const returnFocus = state.returnFocus;
    state.returnFocus = null;
    requestAnimationFrame(() => {
        if (openModals().length === 0 && returnFocus?.isConnected) {
            returnFocus.focus({ preventScroll: true });
        }
    });
}

function registerModal(modal) {
    if (!(modal instanceof HTMLElement) || modalState.has(modal)) return;
    modalState.set(modal, {
        isOpen: modal.classList.contains('active'),
        returnFocus: null
    });
    modal.setAttribute('aria-hidden', String(!modal.classList.contains('active')));
    new MutationObserver(() => syncModal(modal)).observe(modal, {
        attributes: true,
        attributeFilter: ['class']
    });
    if (modal.classList.contains('active')) focusModal(modal);
}

function closeFromKeyboard(modal) {
    const selector = modal.dataset.modalClose;
    if (!selector) return false;
    const closeButton = modal.querySelector(selector);
    if (closeButton instanceof HTMLElement) {
        closeButton.click();
        return true;
    }
    return false;
}

function trapTab(modal, event) {
    const focusable = focusableElements(modal);
    if (focusable.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!modal.contains(active)) {
        event.preventDefault();
        first.focus();
    } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
}

export function initModalAccessibility() {
    document.querySelectorAll('.modal').forEach(registerModal);

    new MutationObserver(records => {
        records.forEach(record => {
            record.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;
                if (node.matches('.modal')) registerModal(node);
                node.querySelectorAll?.('.modal').forEach(registerModal);
            });
        });
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('keydown', event => {
        const modal = openModals().at(-1);
        if (!modal) return;
        if (event.key === 'Escape' && closeFromKeyboard(modal)) {
            event.preventDefault();
            event.stopPropagation();
        } else if (event.key === 'Tab') {
            trapTab(modal, event);
        }
    }, true);
}
