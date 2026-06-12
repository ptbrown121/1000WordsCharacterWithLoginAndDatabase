import {
    formatWeaponTemplateDetails,
    getWeaponTemplateById,
    getWeaponTemplatesByCategory,
    normalizeExoticSkill,
    parseDiceInput,
    getDiceValidationMessage,
    formatTagLimitStatus,
    tagLimitErrorMessage,
    calculateHitchRebateTotal,
    escapeHtml,
    getTileBoxes,
    getTileColorsFromBoxes,
    serializeTileBoxes,
    validateShadowTags,
    ARMOR_COVERAGE_SOAK,
    ARMOR_MATERIALS,
    HINDER_TYPES
} from '../pool.js';
import {
    AMMO_FUNCTION_TIERS,
    calculateAmmoBuildTotal,
    formatReagentDescription,
    getReagentTemplateById,
    getReagentTemplatesBySource,
    suggestAmmoSplit
} from '../ammo-rules.js';
import { uiState } from '../state.js';
import { els } from '../els.js';
import { renderArmorSoak } from './armorSoak.js';
import { renderCards } from './cards.js';
import { updatePoolPreview } from './pool.js';
import { updateXpTracker } from './stats.js';
import { renderRulesReview } from './rulesReview.js';

let dataManager;
let poolEngine;

// Modal-local: tags being edited in the tile modal.
export let currentFormTags = [];

function resetTileModalScroll() {
    const modalContent = els.modal.querySelector('.modal-content');
    if (!modalContent) return;
    modalContent.scrollTop = 0;
    requestAnimationFrame(() => {
        modalContent.scrollTop = 0;
    });
}

function getTileDiceTokens() {
    return els.tileDice.value
        .split(',')
        .map(token => token.trim())
        .filter(Boolean);
}

function setTileDiceTokens(tokens) {
    els.tileDice.value = tokens.join(', ');
    els.tileDice.dispatchEvent(new Event('input', { bubbles: true }));
}

function syncTileDiceButtons() {
    if (!els.tileDiceSelected) return;
    els.tileDiceSelected.innerHTML = '';
    const tokens = getTileDiceTokens();
    tokens.forEach((die, index) => {
        const chip = document.createElement('span');
        chip.className = 'dice-selected-chip';

        const label = document.createElement('span');
        label.textContent = die;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'dice-remove-btn';
        removeBtn.textContent = '\u00d7';
        removeBtn.title = `Remove ${die}`;
        removeBtn.setAttribute('aria-label', `Remove ${die}`);
        removeBtn.addEventListener('click', () => {
            const nextTokens = getTileDiceTokens();
            nextTokens.splice(index, 1);
            setTileDiceTokens(nextTokens);
        });

        chip.appendChild(label);
        chip.appendChild(removeBtn);
        els.tileDiceSelected.appendChild(chip);
    });
}

function addTileDie(die) {
    setTileDiceTokens([...getTileDiceTokens(), die]);
}

export function formatArmorBase(armorType) {
    if (!armorType || !ARMOR_MATERIALS.has(armorType.material) || !(armorType.coverage in ARMOR_COVERAGE_SOAK)) {
        return '';
    }
    const soak = ARMOR_COVERAGE_SOAK[armorType.coverage];
    return `${armorType.coverage} ${armorType.material} Armor · Base Soak +${soak}`;
}

export function getFormArmorType() {
    if (document.getElementById('tile-type').value !== 'Gear') return null;
    if (document.getElementById('gear-subtype').value !== 'Armor') return null;
    const material = document.getElementById('armor-material').value;
    const coverage = document.getElementById('armor-coverage').value;
    if (ARMOR_MATERIALS.has(material) && coverage in ARMOR_COVERAGE_SOAK) {
        return { material, coverage };
    }
    return null;
}

export function formatWeaponBase(weapon) {
    if (!weapon) return '';
    const parts = [weapon.category, weapon.range, weapon.skill].filter(Boolean);
    return parts.length ? `${parts.join(' · ')}` : '';
}

export function formatAmmoBase(ammo) {
    if (!ammo) return '';
    const target = ammo.targetName ? `for ${ammo.targetName}` : 'unlinked';
    const supply = `${ammo.currentSupply ?? 0}/${ammo.maxSupply ?? 0}`;
    const replaces = ammo.replacesTag ? ` · replaces ${ammo.replacesTag}` : '';
    return `Ammo ${target} · Supply ${supply}${replaces}`;
}

function getFormWeapon() {
    if (document.getElementById('tile-type').value !== 'Gear') return null;
    if (document.getElementById('gear-subtype').value !== 'Weapon') return null;

    const templateId = document.getElementById('weapon-template').value;
    const category = document.getElementById('weapon-category').value.trim();
    const range = document.getElementById('weapon-range').value.trim();
    const skill = document.getElementById('weapon-skill').value.trim();

    if (!templateId && !category && !range && !skill) return null;

    return { templateId, category, range, skill };
}

function getFormAmmo() {
    if (document.getElementById('tile-type').value !== 'Gear') return null;
    if (document.getElementById('gear-subtype').value !== 'Ammo') return null;

    const targetSelect = document.getElementById('ammo-target');
    const targetTileId = targetSelect.value;
    const targetName = targetSelect.selectedOptions[0]?.dataset.weaponName || '';
    const maxSupply = Math.max(0, parseInt(document.getElementById('ammo-max-supply').value, 10) || 0);
    const currentSupply = Math.min(maxSupply, Math.max(0, parseInt(document.getElementById('ammo-current-supply').value, 10) || 0));
    const replacesTag = document.getElementById('ammo-replaces-tag').value.trim();

    return { targetTileId, targetName, currentSupply, maxSupply, replacesTag };
}

function getFormGearSubtype() {
    if (document.getElementById('tile-type').value !== 'Gear') return '';
    return document.getElementById('gear-subtype').value || 'Custom';
}

function getFormExoticSkill() {
    if (document.getElementById('tile-type').value !== 'Skill') return null;
    return normalizeExoticSkill(document.getElementById('tile-exotic-skill').value);
}

function isShadowBoxValue(value) {
    return value === 'Qi' || value === 'Id';
}

function getFormSpecialIdentity() {
    return document.getElementById('tile-special-identity')?.value || null;
}

// Special identity tiles (Titan Identity / Homeworld) gain a third box;
// show or hide the Box 3 column and keep the picker label honest.
function syncSpecialIdentityVisibility() {
    const specialIdentity = getFormSpecialIdentity();
    const boxRow = document.querySelector('.tile-box-row[data-box-index="2"]');
    const label = document.getElementById('tile-box-editor-label');
    if (boxRow) boxRow.style.display = specialIdentity ? '' : 'none';
    if (label) label.textContent = specialIdentity ? 'Tile Boxes (Pick 3)' : 'Tile Boxes (Pick 2)';
    if (!specialIdentity) setTileBoxValue(2, '');
}

function syncTileBoxResourceVisibility() {
    document.querySelectorAll('.tile-box-type').forEach(typeSelect => {
        const index = typeSelect.dataset.boxIndex;
        const resourceSelect = document.querySelector(`.tile-box-resource[data-box-index="${index}"]`);
        if (!resourceSelect) return;
        const isShadow = isShadowBoxValue(typeSelect.value);
        resourceSelect.style.display = isShadow ? 'block' : 'none';
        if (!isShadow) resourceSelect.value = '';
    });
    syncTileBoxButtons();
}

function syncTileBoxButtons() {
    document.querySelectorAll('.tile-box-button-grid').forEach(grid => {
        const index = grid.dataset.boxIndex;
        const selectedValue = document.querySelector(`.tile-box-type[data-box-index="${index}"]`)?.value || '';
        grid.querySelectorAll('.tile-box-option').forEach(button => {
            const isSelected = button.dataset.value === selectedValue;
            button.classList.toggle('active', isSelected);
            button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
        });
    });
}

function setTileBoxValue(index, value) {
    const typeInput = document.querySelector(`.tile-box-type[data-box-index="${index}"]`);
    if (!typeInput) return;
    typeInput.value = value;
    typeInput.dispatchEvent(new Event('change', { bubbles: true }));
}

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

function bindStableTouchButton(button, handler) {
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

function getFormBoxes() {
    return Array.from(document.querySelectorAll('.tile-box-type')).map(typeSelect => {
        const value = typeSelect.value;
        const index = typeSelect.dataset.boxIndex;
        const resource = document.querySelector(`.tile-box-resource[data-box-index="${index}"]`)?.value || '';
        if (isShadowBoxValue(value)) return { type: 'shadow', kind: value, resource };
        if (value) return { type: 'color', color: value };
        return null;
    }).filter(Boolean);
}

function setFormBoxes(boxes = []) {
    const normalized = serializeTileBoxes(boxes, 3);
    document.querySelectorAll('.tile-box-type').forEach(typeSelect => {
        const index = parseInt(typeSelect.dataset.boxIndex, 10);
        const box = normalized[index] || null;
        typeSelect.value = box ? (box.type === 'shadow' ? box.kind : box.color) : '';
        const resourceSelect = document.querySelector(`.tile-box-resource[data-box-index="${index}"]`);
        if (resourceSelect) resourceSelect.value = box?.type === 'shadow' ? box.resource || '' : '';
    });
    syncTileBoxResourceVisibility();
}

function populateHinderTypes() {
    const select = document.getElementById('hinder-assault-type');
    if (!select || select.dataset.populated === 'true') return;

    HINDER_TYPES.forEach(type => {
        const option = document.createElement('option');
        option.value = type.id;
        option.textContent = `${type.assault} (${type.skill})`;
        select.appendChild(option);
    });
    select.dataset.populated = 'true';
}

function renderHinderAssaultDetail() {
    const detail = document.getElementById('hinder-assault-detail');
    const selected = HINDER_TYPES.find(type => type.id === document.getElementById('hinder-assault-type')?.value);
    if (!detail) return;
    detail.textContent = selected
        ? `${selected.skill} attack; injures ${selected.injures}; suggested tags: Range: ${selected.range === 'any' ? 'any range' : selected.range} and Crit ${selected.crit}. Defenders use Guile/Menace/Presence/Reason/Wiles, but not ${selected.skill}.`
        : 'Hinders are nonlethal verbal attacks that exhaust opponents (-3 XP rebate). Add the suggested Range and Crit as tags.';
}

function populateReagentTemplates() {
    const select = document.getElementById('ammo-reagent-template');
    if (!select || select.dataset.populated === 'true') return;

    getReagentTemplatesBySource().forEach(group => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.source;
        group.templates.forEach(template => {
            const option = document.createElement('option');
            option.value = template.id;
            option.textContent = `${template.name} (${template.xp} XP / Supply ${template.supply})`;
            optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
    });
    select.dataset.populated = 'true';
}

function applyReagentTemplate(templateId) {
    const detail = document.getElementById('ammo-reagent-detail');
    const template = getReagentTemplateById(templateId);
    if (!template) {
        if (detail) detail.textContent = '';
        return;
    }

    document.getElementById('tile-name').value = template.name;
    document.getElementById('tile-description').value = formatReagentDescription(template);
    document.getElementById('ammo-max-supply').value = String(template.supply);
    document.getElementById('ammo-current-supply').value = String(template.supply);
    document.getElementById('ammo-replaces-tag').value = template.replacesTag || '';
    els.tileXp.value = template.xp;
    if (detail) {
        detail.textContent = `For ${template.use}: ${template.lines.join(' ')} "Supply" effects use the 🞧 value (${template.supply}).`;
    }
}

function readAmmoBuilderLines() {
    return Array.from(document.querySelectorAll('#ammo-calculator .ammo-line-row')).map(row => ({
        trigger: row.querySelector('.ammo-line-trigger')?.value || '',
        x: row.querySelector('.ammo-line-x')?.value,
        tagOnTheFly: Boolean(row.querySelector('.ammo-line-tagfly')?.checked),
        sticky: Boolean(row.querySelector('.ammo-line-sticky')?.checked),
        restriction: Boolean(row.querySelector('.ammo-line-restriction')?.checked),
        repeat: Boolean(row.querySelector('.ammo-line-repeat')?.checked)
    }));
}

function recalcAmmoBuilder() {
    const result = document.getElementById('ammo-calc-result');
    const applyBtn = document.getElementById('btn-ammo-apply-split');
    const functionsNote = document.getElementById('ammo-x-functions');
    if (!result) return;

    const build = calculateAmmoBuildTotal({
        multiTool: Boolean(document.getElementById('ammo-multi-tool')?.checked),
        lines: readAmmoBuilderLines()
    });

    if (build.lineCount === 0) {
        result.textContent = 'Turn on a line trigger to price this ammo.';
        if (applyBtn) applyBtn.style.display = 'none';
        if (functionsNote) functionsNote.textContent = '';
        return;
    }

    const split = suggestAmmoSplit(build.total);
    result.textContent = `Lines: ${build.lineCosts.join(' + ')} → total ${build.total}. Balanced split: ${split.xp} XP 🞮 / Supply ${split.supply} 🞧 (shift points either way; both minimum 1; higher XP = sustainable, higher Supply = cheap but runs out).`;
    if (applyBtn) applyBtn.style.display = 'inline-block';
    if (functionsNote) {
        const usedX = [...new Set(readAmmoBuilderLines().filter(line => line.trigger).map(line => Math.min(5, Math.max(1, parseInt(line.x, 10) || 1))))].sort();
        functionsNote.textContent = usedX.map(x => `X=${x}: ${AMMO_FUNCTION_TIERS[x]}`).join('  ·  ');
    }
}

function applyAmmoSplit() {
    const build = calculateAmmoBuildTotal({
        multiTool: Boolean(document.getElementById('ammo-multi-tool')?.checked),
        lines: readAmmoBuilderLines()
    });
    if (build.lineCount === 0) return;

    const split = suggestAmmoSplit(build.total);
    els.tileXp.value = split.xp;
    document.getElementById('ammo-max-supply').value = String(split.supply);
    document.getElementById('ammo-current-supply').value = String(split.supply);
    recalcAmmoBuilder();
}

function resetAmmoBuilder() {
    const templateSelect = document.getElementById('ammo-reagent-template');
    if (templateSelect) templateSelect.value = '';
    const detail = document.getElementById('ammo-reagent-detail');
    if (detail) detail.textContent = '';
    document.querySelectorAll('#ammo-calculator .ammo-line-row').forEach(row => {
        row.querySelector('.ammo-line-trigger').value = '';
        row.querySelector('.ammo-line-x').value = '2';
        ['.ammo-line-tagfly', '.ammo-line-sticky', '.ammo-line-restriction', '.ammo-line-repeat'].forEach(selector => {
            const box = row.querySelector(selector);
            if (box) box.checked = false;
        });
    });
    const multiTool = document.getElementById('ammo-multi-tool');
    if (multiTool) multiTool.checked = false;
    recalcAmmoBuilder();
}

function populateWeaponTemplates() {
    const select = document.getElementById('weapon-template');
    if (!select || select.dataset.populated === 'true') return;

    getWeaponTemplatesByCategory().forEach(group => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = group.category;
        group.templates.forEach(template => {
            const option = document.createElement('option');
            option.value = template.id;
            option.textContent = template.name;
            optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
    });

    select.dataset.populated = 'true';
}

function populateAmmoTargets(selectedId = '', editingTileId = '') {
    const select = document.getElementById('ammo-target');
    if (!select) return;

    const previousValue = selectedId || select.value;
    select.innerHTML = '<option value="">-- Select weapon --</option>';
    const weaponTiles = (dataManager?.state?.tiles || [])
        .filter(tile => tile.id !== editingTileId)
        .filter(tile => tile.type === 'Gear' && tile.gearSubtype === 'Weapon' && tile.weapon);

    weaponTiles.forEach(tile => {
        const option = document.createElement('option');
        option.value = tile.id;
        option.textContent = `${tile.name} (${formatWeaponBase(tile.weapon)})`;
        option.dataset.weaponName = tile.name;
        select.appendChild(option);
    });

    const hasPreviousValue = Boolean(previousValue)
        && Array.from(select.options).some(option => option.value === previousValue);
    if (hasPreviousValue) {
        select.value = previousValue;
    } else if (!previousValue && weaponTiles.length === 1) {
        select.value = weaponTiles[0].id;
    } else {
        select.value = '';
    }
}

function syncAmmoNameFromTarget() {
    const nameInput = document.getElementById('tile-name');
    const selectedName = document.getElementById('ammo-target').selectedOptions[0]?.dataset.weaponName || '';
    if (selectedName && !nameInput.value.trim()) {
        nameInput.value = `${selectedName} Ammo`;
    }
}

function syncTileTypeSections() {
    const type = document.getElementById('tile-type').value;
    const gearSubtype = document.getElementById('gear-subtype').value || 'Custom';
    const isAmmo = type === 'Gear' && gearSubtype === 'Ammo';

    document.getElementById('spellcast-skill-container').style.display = type === 'Skill' ? 'block' : 'none';
    document.getElementById('exotic-skill-container').style.display = type === 'Skill' ? 'block' : 'none';
    document.getElementById('gear-subtype-container').style.display = type === 'Gear' ? 'block' : 'none';
    document.getElementById('gear-break-container').style.display = type === 'Gear' ? 'block' : 'none';
    document.getElementById('weapon-builder-container').style.display = type === 'Gear' && gearSubtype === 'Weapon' ? 'block' : 'none';
    document.getElementById('armor-base-container').style.display = type === 'Gear' && gearSubtype === 'Armor' ? 'block' : 'none';
    document.getElementById('ammo-builder-container').style.display = isAmmo ? 'block' : 'none';
    document.getElementById('hinder-builder-container').style.display = type === 'Gear' && gearSubtype === 'Hinder' ? 'block' : 'none';

    const diceInput = document.getElementById('tile-dice');
    const diceNote = document.getElementById('tile-dice-note');
    diceInput.required = !isAmmo;
    diceInput.placeholder = isAmmo ? 'Ammo has no dice' : 'd4';
    diceNote.textContent = isAmmo ? 'Ammo gear is saved without dice and does not contribute to resource pools.' : '';
    if (isAmmo) {
        populateAmmoTargets(document.getElementById('ammo-target').value, document.getElementById('tile-id').value);
        syncAmmoNameFromTarget();
    }
    renderTileTagLimitStatus();
}

function addMissingTemplateTags(tags) {
    let changed = false;
    tags.forEach(tag => {
        if (!currentFormTags.includes(tag)) {
            currentFormTags.push(tag);
            changed = true;
        }
    });
    if (changed) renderFormTags();
}

function renderWeaponTemplatePreview(templateId) {
    const preview = document.getElementById('weapon-template-preview');
    if (!preview) return;
    const template = getWeaponTemplateById(templateId);
    if (!template) {
        preview.textContent = '';
        return;
    }

    const chips = formatWeaponTemplateDetails(template).split(' · ');
    preview.innerHTML = chips.map(chip => `<span class="template-preview-chip">${chip}</span>`).join('');
}

function applyWeaponTemplate(templateId) {
    const template = getWeaponTemplateById(templateId);
    renderWeaponTemplatePreview(templateId);
    if (!template) return;

    const nameInput = document.getElementById('tile-name');
    if (!nameInput.value.trim()) {
        nameInput.value = template.name;
    }

    document.getElementById('weapon-category').value = template.category || '';
    document.getElementById('weapon-range').value = template.range || '';
    document.getElementById('weapon-skill').value = template.skill || '';
    const tagMode = document.getElementById('weapon-template-mode').value;
    if (tagMode === 'replace') {
        currentFormTags = [...(template.startingTags || [])];
        renderFormTags();
    } else {
        addMissingTemplateTags(template.startingTags || []);
    }
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
    syncTileDiceButtons();
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
    el.textContent = `\u26a0\ufe0f ${unknownTags.length} unknown ${noun} charged the default +2 XP each: ${list}. Check for typos.`;
    el.style.display = 'block';
}

function resetPendingTagControls() {
    els.tagSelect.value = '';
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

function addPendingTileTag({ showAlert = true } = {}) {
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

function showPendingTagDialog(pending, subjectLabel) {
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

async function confirmPendingTagBeforeTileSave() {
    const pending = getPendingTileTag();
    if (!pending) return true;

    const choice = await showPendingTagDialog(pending, 'tile');
    if (choice === 'cancel') return false;
    if (choice === 'add') return addPendingTileTag({ showAlert: true });
    return true;
}

export function init(deps) {
    dataManager = deps.dataManager;
    poolEngine = deps.poolEngine;
    populateWeaponTemplates();
    populateHinderTypes();
    populateReagentTemplates();

    // Info Modal
    els.btnInfo.addEventListener('click', () => els.infoModal.classList.add('active'));
    els.btnInfoClose.addEventListener('click', () => els.infoModal.classList.remove('active'));
    els.infoModal.addEventListener('click', (e) => {
        if (e.target === els.infoModal) els.infoModal.classList.remove('active');
    });

    // Modal
    els.btnAddTile.addEventListener('click', () => openModal());
    els.btnCancel.addEventListener('click', closeModal);
    els.btnDelete.addEventListener('click', () => {
        const id = document.getElementById('tile-id').value;
        if (id) {
            dataManager.deleteTile(id);
            if (uiState.callTile && uiState.callTile.id === id) uiState.callTile = null;
            uiState.hitchCallTiles = uiState.hitchCallTiles.filter(t => t.id !== id);
            uiState.burnTiles = uiState.burnTiles.filter(t => t.id !== id);
            closeModal();
            renderCards();
            updatePoolPreview();
            renderRulesReview();
        }
    });

    // Tags UI
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

    els.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveTileFromForm();
    });

    els.tileDice.addEventListener('input', renderTileTagLimitStatus);
    els.tileDiceButtons?.addEventListener('click', (e) => {
        const button = e.target.closest('.dice-add-btn');
        if (!button || !els.tileDiceButtons.contains(button)) return;
        addTileDie(button.dataset.die);
    });
    document.getElementById('tile-type').addEventListener('change', syncTileTypeSections);
    document.getElementById('tile-special-identity').addEventListener('change', () => {
        syncSpecialIdentityVisibility();
        renderTileTagLimitStatus();
    });
    document.getElementById('gear-subtype').addEventListener('change', syncTileTypeSections);
    document.getElementById('hinder-assault-type').addEventListener('change', renderHinderAssaultDetail);
    document.getElementById('ammo-reagent-template').addEventListener('change', (e) => {
        applyReagentTemplate(e.target.value);
    });
    document.getElementById('ammo-calculator').addEventListener('change', recalcAmmoBuilder);
    document.getElementById('btn-ammo-apply-split').addEventListener('click', applyAmmoSplit);
    document.getElementById('tile-exotic-skill').addEventListener('change', (e) => {
        if (e.target.value.startsWith('arcana-')) {
            document.getElementById('tile-is-spellcast').checked = true;
        }
    });
    document.getElementById('weapon-template').addEventListener('change', (e) => {
        applyWeaponTemplate(e.target.value);
    });
    document.getElementById('weapon-template-mode').addEventListener('change', () => {
        renderWeaponTemplatePreview(document.getElementById('weapon-template').value);
    });
    document.getElementById('ammo-target').addEventListener('change', () => {
        syncAmmoNameFromTarget();
    });
    document.getElementById('ammo-max-supply').addEventListener('input', () => {
        const maxSupply = Math.max(0, parseInt(document.getElementById('ammo-max-supply').value, 10) || 0);
        const currentInput = document.getElementById('ammo-current-supply');
        const currentSupply = Math.max(0, parseInt(currentInput.value, 10) || 0);
        if (currentSupply > maxSupply) currentInput.value = String(maxSupply);
    });

    // XP Estimation
    els.btnEstimateXp.addEventListener('click', () => {
        const diceStr = document.getElementById('tile-dice').value.trim();
        const { dice: diceArray, invalid } = parseDiceInput(diceStr);
        if (invalid.length > 0) {
            alert(getDiceValidationMessage('Tile dice'));
            return;
        }
        const { xp, unknownTags } = poolEngine.estimateTileXpDetails(diceArray, currentFormTags, getFormArmorType(), {
            weapon: getFormWeapon(),
            exoticSkill: getFormExoticSkill(),
            boxes: getFormBoxes(),
            tileType: document.getElementById('tile-type')?.value,
            specialIdentity: getFormSpecialIdentity(),
            gearSubtype: document.getElementById('tile-type')?.value === 'Gear' ? getFormGearSubtype() : null
        });
        els.tileXp.value = xp;
        renderXpEstimateNote(unknownTags);
    });

    document.querySelectorAll('.tile-box-type').forEach(select => {
        select.addEventListener('change', () => {
            syncTileBoxResourceVisibility();
            renderRulesReview();
        });
    });
    document.querySelectorAll('.tile-box-option').forEach(button => {
        bindStableTouchButton(button, () => {
            setTileBoxValue(button.dataset.boxIndex, button.dataset.value || '');
        });
    });
    document.querySelectorAll('.tile-box-resource').forEach(select => {
        select.addEventListener('change', renderRulesReview);
    });
}

export function openModal(tile = null) {
    els.modal.classList.add('active');
    els.form.reset();
    setFormBoxes([]);
    currentFormTags = [];
    els.tagCustomInput.style.display = 'none';
    const hitchValue = document.getElementById('tag-hitch-value');
    if (hitchValue) {
        hitchValue.style.display = 'none';
        hitchValue.value = '3';
    }
    renderXpEstimateNote([]);

    const armorMaterial = document.getElementById('armor-material');
    const armorCoverage = document.getElementById('armor-coverage');
    const gearSubtype = document.getElementById('gear-subtype');
    const weaponTemplate = document.getElementById('weapon-template');
    const weaponTemplateMode = document.getElementById('weapon-template-mode');
    const weaponCategory = document.getElementById('weapon-category');
    const weaponRange = document.getElementById('weapon-range');
    const weaponSkill = document.getElementById('weapon-skill');
    const ammoTarget = document.getElementById('ammo-target');
    const ammoCurrentSupply = document.getElementById('ammo-current-supply');
    const ammoMaxSupply = document.getElementById('ammo-max-supply');
    const ammoReplacesTag = document.getElementById('ammo-replaces-tag');
    const exoticSkill = document.getElementById('tile-exotic-skill');
    const gearBroken = document.getElementById('gear-broken');

    if (tile) {
        document.getElementById('modal-title').innerText = 'Edit Tile';
        document.getElementById('tile-id').value = tile.id;
        const tileType = tile.type || 'Skill';
        document.getElementById('tile-type').value = tileType;
        gearSubtype.value = tile.gearSubtype || (tile.ammo ? 'Ammo' : tile.weapon ? 'Weapon' : tile.armorType ? 'Armor' : 'Custom');
        weaponTemplate.value = tile.weapon?.templateId || '';
        weaponTemplateMode.value = 'add';
        weaponCategory.value = tile.weapon?.category || '';
        weaponRange.value = tile.weapon?.range || '';
        weaponSkill.value = tile.weapon?.skill || '';
        populateAmmoTargets(tile.ammo?.targetTileId || '', tile.id);
        ammoTarget.value = tile.ammo?.targetTileId || '';
        ammoCurrentSupply.value = tile.ammo?.currentSupply ?? 0;
        ammoMaxSupply.value = tile.ammo?.maxSupply ?? 1;
        ammoReplacesTag.value = tile.ammo?.replacesTag || 'Reload';
        armorMaterial.value = tile.armorType?.material || '';
        armorCoverage.value = tile.armorType?.coverage || '';
        gearBroken.checked = !!tile.gearBroken;
        document.getElementById('tile-is-spellcast').checked = !!tile.isSpellcastSkill;
        exoticSkill.value = tile.exoticSkill?.id || '';
        document.getElementById('tile-special-identity').value = tile.specialIdentity || '';
        document.getElementById('tile-name').value = tile.name;
        document.getElementById('tile-description').value = tile.description || '';
        document.getElementById('tile-dice').value = (tile.dice || []).join(', ');
        if (Array.isArray(tile.tags)) {
            currentFormTags = tile.tags.map(t => String(t).trim()).filter(Boolean);
        } else if (tile.tags) {
            // Legacy comma-string fallback (older exports).
            currentFormTags = String(tile.tags).split(',').map(t => t.trim()).filter(Boolean);
        }
        
        setFormBoxes(getTileBoxes(tile));
        els.tileXp.value = tile.xpCost || 0;
        els.btnDelete.style.display = 'inline-block';
    } else {
        document.getElementById('modal-title').innerText = 'Add Tile';
        document.getElementById('tile-id').value = '';
        document.getElementById('tile-type').value = 'Skill';
        gearSubtype.value = 'Custom';
        weaponTemplate.value = '';
        weaponTemplateMode.value = 'add';
        weaponCategory.value = '';
        weaponRange.value = '';
        weaponSkill.value = '';
        populateAmmoTargets();
        ammoTarget.value = '';
        ammoCurrentSupply.value = '0';
        ammoMaxSupply.value = '1';
        ammoReplacesTag.value = 'Reload';
        armorMaterial.value = '';
        armorCoverage.value = '';
        gearBroken.checked = false;
        document.getElementById('tile-is-spellcast').checked = false;
        exoticSkill.value = '';
        document.getElementById('tile-special-identity').value = '';
        document.getElementById('tile-description').value = '';
        setFormBoxes([]);
        els.tileXp.value = 0;
        els.btnDelete.style.display = 'none';
    }

    renderWeaponTemplatePreview(weaponTemplate.value);
    syncTileTypeSections();
    syncSpecialIdentityVisibility();
    resetAmmoBuilder();
    renderFormTags();
    resetTileModalScroll();
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
        removeBtn.textContent = '\u00d7';
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

export function closeModal() {
    els.modal.classList.remove('active');
}

export async function saveTileFromForm() {
    if (!await confirmPendingTagBeforeTileSave()) return;

    const id = document.getElementById('tile-id').value;
    const type = document.getElementById('tile-type').value;
    const isSpellcastSkill = type === 'Skill' && document.getElementById('tile-is-spellcast').checked;
    const name = document.getElementById('tile-name').value.trim();
    const description = document.getElementById('tile-description').value.trim();
    const diceStr = document.getElementById('tile-dice').value.trim();
    const tags = [...currentFormTags];
    const xpCost = parseInt(els.tileXp.value, 10) || 0;
    const gearSubtype = getFormGearSubtype();
    const isAmmo = type === 'Gear' && gearSubtype === 'Ammo';
    const gearBroken = type === 'Gear' && document.getElementById('gear-broken').checked;
    const specialIdentity = getFormSpecialIdentity();

    const boxes = getFormBoxes();
    const checkedColors = getTileColorsFromBoxes(boxes);
    const requiredBoxes = specialIdentity ? 3 : 2;

    if (!isAmmo && boxes.length !== requiredBoxes) {
        alert(`Please select exactly ${requiredBoxes} tile boxes${specialIdentity ? ' (special identity tiles gain a third box)' : ''}.`);
        return;
    }
    if (isAmmo && ![0, 2].includes(boxes.length)) {
        alert('Ammo can have no boxes or exactly 2 boxes.');
        return;
    }
    if (specialIdentity === 'homeworld' && type !== 'Story') {
        alert('Homeworld is a Story tile (p.63).');
        return;
    }
    if (specialIdentity === 'titan-identity' && !['Gear', 'Story'].includes(type)) {
        alert('Titan Identity is a Gear or Story tile (p.69).');
        return;
    }
    const missingShadowResource = boxes.find(box => box.type === 'shadow' && !box.resource);
    if (missingShadowResource) {
        alert(`${missingShadowResource.kind} boxes must choose Health, Energy, or Reflex.`);
        return;
    }

    const { dice: diceArray, invalid } = parseDiceInput(diceStr);
    if (invalid.length > 0 || (!isAmmo && diceArray.length === 0)) {
        alert(getDiceValidationMessage('Tile dice'));
        return;
    }
    if (isAmmo && diceArray.length > 0) {
        alert('Ammo gear does not use dice. Leave the Dice field blank.');
        return;
    }

    const tagLimit = poolEngine.calculateTagLimit(diceArray, currentFormTags, { specialIdentity });
    renderTileTagLimitStatus();
    if (!tagLimit.valid) {
        alert(tagLimitErrorMessage('This tile', tagLimit));
        return;
    }

    const armorType = getFormArmorType();
    const weapon = getFormWeapon();
    const ammo = getFormAmmo();
    const exoticSkill = getFormExoticSkill();

    const existingTile = id ? dataManager.state.tiles.find(t => t.id === id) : null;
    const tile = {
        id: id || null,
        type,
        name,
        description,
        colors: checkedColors,
        dice: isAmmo ? [] : diceArray,
        tags,
        xpCost,
        isSpellcastSkill,
        exoticSkill,
        gearSubtype,
        weapon,
        ammo,
        armorType,
        gearBroken,
        specialIdentity,
        isBurnt: existingTile?.isBurnt || false,
        isBuried: existingTile?.isBuried || false
    };
    tile.boxes = boxes;

    const shadowTagIssues = validateShadowTags(tile);
    if (shadowTagIssues.length > 0) {
        alert(shadowTagIssues.map(issue => issue.message).join('\n'));
        return;
    }

    const currentHitchTotal = calculateHitchRebateTotal(dataManager.state.tiles || []);
    const nextTiles = id
        ? (dataManager.state.tiles || []).map(t => t.id === id ? tile : t)
        : [...(dataManager.state.tiles || []), tile];
    const nextHitchTotal = calculateHitchRebateTotal(nextTiles);
    if (nextHitchTotal > 6 && nextHitchTotal > currentHitchTotal) {
        alert(`Hitch rebates are capped at 6 XP per sheet. This would make ${nextHitchTotal} XP of Hitch rebates.`);
        return;
    }

    if (id) {
        dataManager.updateTile(tile);
        // Update pool selections if modified
        if (uiState.callTile && uiState.callTile.id === id) uiState.callTile = tile;
        uiState.hitchCallTiles = uiState.hitchCallTiles.map(t => t.id === id ? tile : t);
        uiState.burnTiles = uiState.burnTiles.map(t => t.id === id ? tile : t);
    } else {
        dataManager.addTile(tile);
    }

    closeModal();
    renderCards();
    updatePoolPreview();
    updateXpTracker();
    renderArmorSoak(dataManager.state.tiles || []);
    renderRulesReview();
}
