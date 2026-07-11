// @ts-check
// App tab shell (UI tabs plan PR 1). Every section stays in the DOM and
// keeps rendering; switching tabs only toggles [hidden] on the tabpanels,
// so els.js lookups and the render loop are unaffected.
//
// The active tab is a per-device UI preference (localStorage), never part
// of character state or cloud saves. Deep links (#tab-play etc.) are
// read-only: the hash is never written, so Supabase auth callback
// fragments (#access_token=...) are left alone.

import { editorElements, optionalEditorElement, requiredEditorElement } from './editorDom.js';

const STORAGE_KEY = '1000words_active_tab';

export function init() {
    const nav = requiredEditorElement(document, '.app-tabs', HTMLElement);
    const tabs = editorElements(nav, '[role="tab"]', HTMLButtonElement);
    if (!tabs.length) return;

    /** @param {HTMLButtonElement} tab */
    const panelFor = (tab) => optionalEditorElement(document, `#${tab.getAttribute('aria-controls') || ''}`, HTMLElement);

    /** @param {HTMLButtonElement} tab @param {{focus?: boolean}} [options] */
    function activate(tab, { focus = false } = {}) {
        tabs.forEach(button => {
            const selected = button === tab;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
            const panel = panelFor(button);
            if (panel) panel.hidden = !selected;
        });
        if (focus) tab.focus();
        try {
            globalThis.localStorage?.setItem(STORAGE_KEY, tab.id);
        } catch {
            // Storage can be unavailable (private mode); tabs still work.
        }
    }

    nav.addEventListener('click', (e) => {
        const tab = e.target instanceof Element ? e.target.closest('[role="tab"]') : null;
        if (tab instanceof HTMLButtonElement) activate(tab);
    });

    nav.addEventListener('keydown', (e) => {
        const index = tabs.findIndex(tab => tab === document.activeElement);
        if (index === -1) return;
        /** @type {HTMLButtonElement|null|undefined} */
        let target = null;
        if (e.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length];
        else if (e.key === 'ArrowLeft') target = tabs[(index - 1 + tabs.length) % tabs.length];
        else if (e.key === 'Home') target = tabs[0];
        else if (e.key === 'End') target = tabs[tabs.length - 1];
        if (target) {
            e.preventDefault();
            activate(target, { focus: true });
        }
    });

    const tabFromHash = () => tabs.find(tab => `#${tab.id}` === globalThis.location.hash) || null;
    globalThis.addEventListener('hashchange', () => {
        const tab = tabFromHash();
        if (tab) activate(tab);
    });

    let stored = null;
    try {
        stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    } catch {
        // ignore; fall through to the default tab
    }
    const initialTab = tabFromHash() || tabs.find(tab => tab.id === stored) || tabs[0];
    if (initialTab) activate(initialTab);
}
