// @ts-check
// Barrel for the tile modal, split 2026-06-12 (same treatment as the
// pool.js split): importers keep using './modals.js' while the
// implementation lives in js/ui/tileModal/. Re-exports every name the
// pre-split module exported.
export { init, openModal, closeModal, saveTileFromForm } from './tileModal/modal.js';
export {
    currentFormTags,
    renderFormTags,
    renderTagLimitStatus,
    renderTileTagLimitStatus,
    renderXpEstimateNote
} from './tileModal/tagEditor.js';
export {
    formatAmmoBase,
    formatArmorBase,
    formatWeaponBase,
    getFormArmorType
} from './tileModal/formFields.js';
