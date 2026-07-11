// Tile modal main flow: open/close, type-section visibility, validation,
// and save. Field readers live in formFields.js, the box editor in
// boxes.js, tag editing in tagEditor.js, and the gear builder panels in
// gearBuilders.js; js/ui/modals.js re-exports the public surface.
import {
    calculateHitchRebateTotal,
    getDiceValidationMessage,
    getTileBoxes,
    getTileColorsFromBoxes,
    parseDiceInput,
    tagLimitErrorMessage,
    validateShadowTags
} from '../../pool.js';
import { uiState } from '../../state.js';
import { els } from '../../els.js';
import { renderArmorSoak } from '../armorSoak.js';
import { renderCards } from '../cards.js';
import { updatePoolPreview } from '../pool.js';
import { updateXpTracker } from '../stats.js';
import { renderRulesReview } from '../rulesReview.js';
import { bindOptionGrids, bindStableTouchButton, createDiceTokenEditor, createSearchableSelect, syncOptionGrids } from '../modalWidgets.js';
import { showAlert } from '../dialogService.js';
import {
    getFormArmorType,
    getFormAmmo,
    getFormExoticSkill,
    getFormGearSubtype,
    getFormSpecialIdentity,
    getFormWeapon
} from './formFields.js';
import {
    getFormBoxes,
    setFormBoxes,
    setTileBoxValue,
    syncSpecialIdentityVisibility,
    syncTileBoxResourceVisibility
} from './boxes.js';
import {
    confirmPendingTagBeforeTileSave,
    currentFormTags,
    initTagEditor,
    renderFormTags,
    renderTileTagLimitStatus,
    renderXpEstimateNote,
    setFormTags
} from './tagEditor.js';
import {
    applyAmmoSplit,
    applyReagentTemplate,
    applyWeaponTemplate,
    populateAmmoTargets,
    populateHinderTypes,
    populateReagentTemplates,
    populateWeaponTemplates,
    recalcAmmoBuilder,
    renderHinderAssaultDetail,
    renderWeaponTemplatePreview,
    resetAmmoBuilder,
    syncAmmoNameFromTarget
} from './gearBuilders.js';

let dataManager;
let poolEngine;
let tileDiceEditor;
let tagPicker;
let reagentPicker;

function resetTileModalScroll() {
    const modalContent = els.modal.querySelector('.modal-content');
    if (!modalContent) return;
    modalContent.scrollTop = 0;
    requestAnimationFrame(() => {
        modalContent.scrollTop = 0;
    });
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
        populateAmmoTargets(dataManager?.state?.tiles || [], document.getElementById('ammo-target').value, document.getElementById('tile-id').value);
        syncAmmoNameFromTarget();
    }
    syncOptionGrids(els.modal);
    renderTileTagLimitStatus();
}

export function init(deps) {
    dataManager = deps.dataManager;
    poolEngine = deps.poolEngine;
    tileDiceEditor = createDiceTokenEditor({
        input: els.tileDice,
        chipsContainer: els.tileDiceSelected,
        buttonsContainer: els.tileDiceButtons
    });
    initTagEditor({ poolEngine, syncDiceChips: () => tileDiceEditor.syncChips() });
    populateWeaponTemplates();
    populateHinderTypes();
    populateReagentTemplates();

    // Long catalogs get a filter that appears on opening the picker.
    tagPicker = createSearchableSelect(els.tagSelect, { searchPlaceholder: 'Type to filter tags...' });
    reagentPicker = createSearchableSelect(document.getElementById('ammo-reagent-template'), { searchPlaceholder: 'Type to filter templates...' });

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

    els.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveTileFromForm();
    });

    els.tileDice.addEventListener('input', renderTileTagLimitStatus);
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
            showAlert(getDiceValidationMessage('Tile dice'));
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
    document.querySelectorAll('.tile-box-button-grid .tile-box-option').forEach(button => {
        bindStableTouchButton(button, () => {
            setTileBoxValue(button.dataset.boxIndex, button.dataset.value || '');
        });
    });
    bindOptionGrids(els.modal);
    document.querySelectorAll('.tile-box-resource').forEach(select => {
        select.addEventListener('change', renderRulesReview);
    });
}

export function openModal(tile = null) {
    els.modal.classList.add('active');
    els.form.reset();
    setFormBoxes([]);
    setFormTags([]);
    els.tagCustomInput.style.display = 'none';
    // form.reset() above changed select values without firing 'change';
    // re-sync the searchable pickers' trigger labels.
    tagPicker?.sync();
    reagentPicker?.sync();
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
        populateAmmoTargets(dataManager?.state?.tiles || [], tile.ammo?.targetTileId || '', tile.id);
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
            setFormTags(tile.tags.map(t => String(t).trim()).filter(Boolean));
        } else if (tile.tags) {
            // Legacy comma-string fallback (older exports).
            setFormTags(String(tile.tags).split(',').map(t => t.trim()).filter(Boolean));
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
        populateAmmoTargets(dataManager?.state?.tiles || []);
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
        showAlert(`Please select exactly ${requiredBoxes} tile boxes${specialIdentity ? ' (special identity tiles gain a third box)' : ''}.`);
        return;
    }
    if (isAmmo && ![0, 2].includes(boxes.length)) {
        showAlert('Ammo can have no boxes or exactly 2 boxes.');
        return;
    }
    if (specialIdentity === 'homeworld' && type !== 'Story') {
        showAlert('Homeworld is a Story tile (p.63).');
        return;
    }
    if (specialIdentity === 'titan-identity' && !['Gear', 'Story'].includes(type)) {
        showAlert('Titan Identity is a Gear or Story tile (p.69).');
        return;
    }
    const missingShadowResource = boxes.find(box => box.type === 'shadow' && !box.resource);
    if (missingShadowResource) {
        showAlert(`${missingShadowResource.kind} boxes must choose Health, Energy, or Reflex.`);
        return;
    }

    const { dice: diceArray, invalid } = parseDiceInput(diceStr);
    if (invalid.length > 0 || (!isAmmo && diceArray.length === 0)) {
        showAlert(getDiceValidationMessage('Tile dice'));
        return;
    }
    if (isAmmo && diceArray.length > 0) {
        showAlert('Ammo gear does not use dice. Leave the Dice field blank.');
        return;
    }

    const tagLimit = poolEngine.calculateTagLimit(diceArray, currentFormTags, { specialIdentity });
    renderTileTagLimitStatus();
    if (!tagLimit.valid) {
        showAlert(tagLimitErrorMessage('This tile', tagLimit));
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
        showAlert(shadowTagIssues.map(issue => issue.message).join('\n'));
        return;
    }

    const currentHitchTotal = calculateHitchRebateTotal(dataManager.state.tiles || []);
    const nextTiles = id
        ? (dataManager.state.tiles || []).map(t => t.id === id ? tile : t)
        : [...(dataManager.state.tiles || []), tile];
    const nextHitchTotal = calculateHitchRebateTotal(nextTiles);
    if (nextHitchTotal > 6 && nextHitchTotal > currentHitchTotal) {
        showAlert(`Hitch rebates are capped at 6 XP per sheet. This would make ${nextHitchTotal} XP of Hitch rebates.`);
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
