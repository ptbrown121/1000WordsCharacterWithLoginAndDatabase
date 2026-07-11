// @ts-check
// Persistent storage-error banner.
//
// data.js dispatches `window.dispatchEvent(new CustomEvent('storage-error',
// { detail: { error, operation } }))` whenever a localStorage write fails
// (quota exceeded, private mode, blocked, etc). Before this module existed
// the event had no listener, so users would silently lose every edit they
// made after the first failure. This module surfaces the failure with a
// persistent banner and a one-click "Export now" escape hatch.
//
// Banner stays up until the user dismisses it - if storage is broken, the
// follow-up saves are ALSO failing silently, so we don't auto-hide.
//
// Notes:
// - Uses textContent for the operation detail to avoid any HTML injection
//   from error messages, even though they come from the platform.
// - Listener registers once at module load. There is no de-listen path
//   because the app is a single SPA and never tears down.

import { els } from '../els.js';

/** @typedef {{exportState: () => void}} NotificationDataManager */
/** @type {NotificationDataManager} */
let dataManager;
let dismissed = false;

/** @type {Object<string, string>} */
const OPERATION_LABELS = {
    saveState: 'saving your character',
    saveRoster: 'saving your character roster',
    loadRoster: 'migrating an older save'
};

/** @param {{operation?: string}|null|undefined} detail */
function showBanner(detail) {
    const banner = els.storageErrorBanner;
    if (!banner) return;

    const detailEl = els.storageErrorBannerDetail;
    if (detailEl) {
        const op = detail?.operation;
        const label = op ? OPERATION_LABELS[op] || 'using browser storage' : 'using browser storage';
        // textContent is safe against any HTML in error.message.
        detailEl.textContent = ` Browser storage is unavailable while ${label}.`;
    }

    banner.hidden = false;
}

function hideBanner() {
    const banner = els.storageErrorBanner;
    if (banner) banner.hidden = true;
}

/** @param {{dataManager: NotificationDataManager}} deps */
export function init(deps) {
    dataManager = deps.dataManager;

    // Listen for the storage-error CustomEvent fired by data.js.
    window.addEventListener('storage-error', (e) => {
        // Once dismissed, the user has acknowledged the situation; don't
        // re-pop on every subsequent failed write. They can refresh to reset.
        if (dismissed) return;
        showBanner(e instanceof CustomEvent ? e.detail : null);
    });

    els.btnStorageErrorDismiss.addEventListener('click', () => {
        dismissed = true;
        hideBanner();
    });

    els.btnStorageErrorExport.addEventListener('click', () => {
        // exportState builds a data: URL and triggers download. This
        // does NOT touch localStorage, so it works even when the
        // banner is up.
        try {
            dataManager.exportState();
        } catch (err) {
            // Last-ditch: if export itself fails (e.g. download blocked),
            // log so the user has something to copy from devtools.
            console.error('Export from storage-error banner failed', err);
        }
    });
}
