// The tile modal's gear-specific builder panels: weapon templates, the
// ammo builder (reagent templates + line calculator), and hinders.
import {
    formatWeaponTemplateDetails,
    getWeaponTemplateById,
    getWeaponTemplatesByCategory,
    HINDER_TYPES
} from '../../pool.js';
import {
    AMMO_FUNCTION_TIERS,
    calculateAmmoBuildTotal,
    formatReagentDescription,
    getReagentTemplateById,
    getReagentTemplatesBySource,
    suggestAmmoSplit
} from '../../ammo-rules.js';
import { els } from '../../els.js';
import { formatWeaponBase } from './formFields.js';
import { addMissingTemplateTags, renderFormTags, setFormTags } from './tagEditor.js';

export function populateWeaponTemplates() {
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

export function renderWeaponTemplatePreview(templateId) {
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

export function applyWeaponTemplate(templateId) {
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
        setFormTags([...(template.startingTags || [])]);
        renderFormTags();
    } else {
        addMissingTemplateTags(template.startingTags || []);
    }
}

export function populateAmmoTargets(tiles, selectedId = '', editingTileId = '') {
    const select = document.getElementById('ammo-target');
    if (!select) return;

    const previousValue = selectedId || select.value;
    select.innerHTML = '<option value="">-- Select weapon --</option>';
    const weaponTiles = (tiles || [])
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

export function syncAmmoNameFromTarget() {
    const nameInput = document.getElementById('tile-name');
    const selectedName = document.getElementById('ammo-target').selectedOptions[0]?.dataset.weaponName || '';
    if (selectedName && !nameInput.value.trim()) {
        nameInput.value = `${selectedName} Ammo`;
    }
}

export function populateHinderTypes() {
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

export function renderHinderAssaultDetail() {
    const detail = document.getElementById('hinder-assault-detail');
    const selected = HINDER_TYPES.find(type => type.id === document.getElementById('hinder-assault-type')?.value);
    if (!detail) return;
    detail.textContent = selected
        ? `${selected.skill} attack; injures ${selected.injures}; suggested tags: Range: ${selected.range === 'any' ? 'any range' : selected.range} and Crit ${selected.crit}. Defenders use Guile/Menace/Presence/Reason/Wiles, but not ${selected.skill}.`
        : 'Hinders are nonlethal verbal attacks that exhaust opponents (-3 XP rebate). Add the suggested Range and Crit as tags.';
}

export function populateReagentTemplates() {
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

export function applyReagentTemplate(templateId) {
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

export function recalcAmmoBuilder() {
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

export function applyAmmoSplit() {
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

export function resetAmmoBuilder() {
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
