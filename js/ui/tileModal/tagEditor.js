// Tag-list state and the pending-tag flow for the tile modal. The
// "pending" tag is whatever the picker row currently describes but has
// not been added; saving the tile asks about it instead of silently
// dropping it.
import {
    formatTagLimitStatus,
    getDiceValidationMessage,
    parseDiceInput
} from '../../pool.js';
import { els } from '../../els.js';
import { showPendingTagDialog } from '../modalWidgets.js';
import { getFormSpecialIdentity } from './formFields.js';

let poolEngine;
let syncDiceChips = () => {};

// Modal-local: tags being edited in the tile modal.
export let currentFormTags = [];

// Imported bindings are read-only, so reassignment goes through here.
export function setFormTags(tags) {
    currentFormTags = tags;
}

export function addMissingTemplateTags(tags) {
    let changed = false;
    tags.forEach(tag => {
        if (!currentFormTags.includes(tag)) {
            currentFormTags.push(tag);
            changed = true;
        }
    });
    if (changed) renderFormTags();
}

export function initTagEditor(deps) {
    poolEngine = deps.poolEngine;
    syncDiceChips = deps.syncDiceChips;

    els.tagSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        const motorizedStat = document.getElementById('tag-motorized-stat');
        const hitchValue = document.getElementById('tag-hitch-value');
        if (val === 'Custom' || val === 'Chain' || val === 'World' || val === 'While') {
            els.tagCustomInput.style.display = 'inline-block';
            els.tagCustomInput.placeholder = val === 'Custom' ? 'Custom Tag Name' : val === 'While' ? 'Form name (e.g. Werewolf)' : 'Tile Name to Link';
            els.tagCustomInput.focus();
            motorizedStat.style.display = 'none';
            hitchValue.style.display = 'none';
        } else if (val === 'Motorized') {
            els.tagCustomInput.style.display = 'none';
            motorizedStat.style.display = 'block';
            hitchValue.style.display = 'none';
        } else if (val === 'Hitch') {
            els.tagCustomInput.style.display = 'none';
            motorizedStat.style.display = 'none';
            hitchValue.style.display = 'block';
        } else {
            els.tagCustomInput.style.display = 'none';
            motorizedStat.style.display = 'none';
            hitchValue.style.display = 'none';
        }
    });

    els.btnAddTag.addEventListener('click', () => addPendingTileTag({ showAlert: true }));
}

export function renderFormTags() {
    els.tagsContainer.innerHTML = '';
    currentFormTags.forEach((tag, index) => {
        const div = document.createElement('div');
        div.className = 'badge';
        div.style.background = 'rgba(255,255,255,0.2)';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '0.3rem';

        const tagText = document.createElement('span');
        tagText.textContent = tag;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.style.cursor = 'pointer';
        removeBtn.style.color = '#ff3333';
        removeBtn.style.fontWeight = 'bold';
        removeBtn.style.background = 'transparent';
        removeBtn.style.border = 'none';
        removeBtn.style.padding = '0';
        removeBtn.addEventListener('click', () => {
            currentFormTags.splice(index, 1);
            renderFormTags();
        });

        div.appendChild(tagText);
        div.appendChild(removeBtn);
        els.tagsContainer.appendChild(div);
    });

    renderTileTagLimitStatus();
}

export function renderTagLimitStatus(el, diceStr, tagsArray, limitOptions = {}) {
    if (!el) return null;

    el.classList.remove('valid', 'invalid');

    const isAmmo = document.getElementById('tile-type')?.value === 'Gear'
        && document.getElementById('gear-subtype')?.value === 'Ammo';
    if (isAmmo && !diceStr.trim()) {
        const tagLimit = poolEngine.calculateTagLimit([], tagsArray, limitOptions);
        el.textContent = `Ammo has no dice. Countable tags: ${tagLimit.count}/0.`;
        el.classList.add(tagLimit.valid ? 'valid' : 'invalid');
        return tagLimit;
    }

    if (!diceStr.trim()) {
        el.textContent = 'Enter dice to check the tag limit.';
        return null;
    }

    const { dice, invalid } = parseDiceInput(diceStr);
    if (invalid.length > 0) {
        el.textContent = getDiceValidationMessage('Dice');
        el.classList.add('invalid');
        return null;
    }

    const tagLimit = poolEngine.calculateTagLimit(dice, tagsArray, limitOptions);
    el.textContent = formatTagLimitStatus(tagLimit);
    el.classList.add(tagLimit.valid ? 'valid' : 'invalid');
    return tagLimit;
}

export function renderTileTagLimitStatus() {
    syncDiceChips();
    return renderTagLimitStatus(els.tileTagLimitStatus, els.tileDice.value, currentFormTags, {
        specialIdentity: getFormSpecialIdentity()
    });
}

export function renderXpEstimateNote(unknownTags = []) {
    const el = els.tileXpEstimateNote;
    if (!el) return;
    if (!unknownTags.length) {
        el.textContent = '';
        el.style.display = 'none';
        return;
    }
    const list = unknownTags.join(', ');
    const noun = unknownTags.length === 1 ? 'tag was' : 'tags were';
    el.textContent = `⚠️ ${unknownTags.length} unknown ${noun} charged the default +2 XP each: ${list}. Check for typos.`;
    el.style.display = 'block';
}

function resetPendingTagControls() {
    els.tagSelect.value = '';
    // Notify the searchable picker wrapping this select that the value
    // changed under it, so its trigger label resets too.
    els.tagSelect.dispatchEvent(new Event('change', { bubbles: true }));
    els.tagCustomInput.value = '';
    els.tagCustomInput.style.display = 'none';
    const motorizedStat = document.getElementById('tag-motorized-stat');
    motorizedStat.style.display = 'none';
    motorizedStat.value = '';
    const hitchValue = document.getElementById('tag-hitch-value');
    hitchValue.style.display = 'none';
    hitchValue.value = '3';
    document.getElementById('tag-exempt').checked = false;
}

function getPendingTileTag() {
    const selVal = els.tagSelect.value;
    if (!selVal) return null;

    let finalTag = '';
    let reason = '';

    if (selVal === 'Custom') {
        finalTag = els.tagCustomInput.value.trim();
        if (!finalTag) reason = 'Custom needs a tag name.';
    } else if (selVal === 'Chain' || selVal === 'World') {
        const target = els.tagCustomInput.value.trim();
        if (target) {
            finalTag = `${selVal} ${target}`;
        } else {
            reason = `${selVal} needs a linked tile name.`;
        }
    } else if (selVal === 'While') {
        const form = els.tagCustomInput.value.trim();
        if (form) {
            finalTag = `While ${form}`;
        } else {
            reason = 'While needs a form name (e.g. Werewolf).';
        }
    } else if (selVal === 'Motorized') {
        const stat = document.getElementById('tag-motorized-stat').value;
        if (stat) {
            finalTag = `Motorized: ${stat}`;
        } else {
            reason = 'Motorized needs a stat.';
        }
    } else if (selVal === 'Hitch') {
        const rebate = Math.min(6, Math.max(1, parseInt(document.getElementById('tag-hitch-value').value, 10) || 3));
        finalTag = `Hitch ${rebate}`;
    } else {
        finalTag = selVal;
    }

    if (finalTag && document.getElementById('tag-exempt').checked) {
        finalTag = `${finalTag} (Exempt)`;
    }

    return {
        label: selVal,
        tag: finalTag,
        canAdd: Boolean(finalTag),
        reason
    };
}

export function addPendingTileTag({ showAlert = true } = {}) {
    const pending = getPendingTileTag();
    if (!pending) return false;
    if (!pending.canAdd) {
        if (showAlert) alert(pending.reason || 'Complete the selected tag before adding it.');
        return false;
    }

    currentFormTags.push(pending.tag);
    renderFormTags();
    resetPendingTagControls();
    return true;
}

export async function confirmPendingTagBeforeTileSave() {
    const pending = getPendingTileTag();
    if (!pending) return true;

    const choice = await showPendingTagDialog(pending, 'tile');
    if (choice === 'cancel') return false;
    if (choice === 'add') return addPendingTileTag({ showAlert: true });
    return true;
}
