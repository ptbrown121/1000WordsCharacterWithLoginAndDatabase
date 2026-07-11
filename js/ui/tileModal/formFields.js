// @ts-check
// Readers for the tile form's type-specific fields, plus the base-line
// formatters the mosaic cards reuse (via the js/ui/modals.js barrel).
import {
    ARMOR_COVERAGE_SOAK,
    ARMOR_MATERIALS,
    normalizeExoticSkill
} from '../../pool.js';
import { editorElement } from '../editorDom.js';

export function formatArmorBase(armorType) {
    if (!armorType || !ARMOR_MATERIALS.has(armorType.material) || !(armorType.coverage in ARMOR_COVERAGE_SOAK)) {
        return '';
    }
    const soak = ARMOR_COVERAGE_SOAK[armorType.coverage];
    return `${armorType.coverage} ${armorType.material} Armor · Base Soak +${soak}`;
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

export function getFormArmorType() {
    if (editorElement('tile-type').value !== 'Gear') return null;
    if (editorElement('gear-subtype').value !== 'Armor') return null;
    const material = editorElement('armor-material').value;
    const coverage = editorElement('armor-coverage').value;
    if (ARMOR_MATERIALS.has(material) && coverage in ARMOR_COVERAGE_SOAK) {
        return { material, coverage };
    }
    return null;
}

export function getFormWeapon() {
    if (editorElement('tile-type').value !== 'Gear') return null;
    if (editorElement('gear-subtype').value !== 'Weapon') return null;

    const templateId = editorElement('weapon-template').value;
    const category = editorElement('weapon-category').value.trim();
    const range = editorElement('weapon-range').value.trim();
    const skill = editorElement('weapon-skill').value.trim();

    if (!templateId && !category && !range && !skill) return null;

    return { templateId, category, range, skill };
}

export function getFormAmmo() {
    if (editorElement('tile-type').value !== 'Gear') return null;
    if (editorElement('gear-subtype').value !== 'Ammo') return null;

    const targetSelect = editorElement('ammo-target');
    const targetTileId = targetSelect.value;
    const targetName = targetSelect.selectedOptions[0]?.dataset.weaponName || '';
    const maxSupply = Math.max(0, parseInt(editorElement('ammo-max-supply').value, 10) || 0);
    const currentSupply = Math.min(maxSupply, Math.max(0, parseInt(editorElement('ammo-current-supply').value, 10) || 0));
    const replacesTag = editorElement('ammo-replaces-tag').value.trim();

    return { targetTileId, targetName, currentSupply, maxSupply, replacesTag };
}

export function getFormGearSubtype() {
    if (editorElement('tile-type').value !== 'Gear') return '';
    return editorElement('gear-subtype').value || 'Custom';
}

export function getFormExoticSkill() {
    if (editorElement('tile-type').value !== 'Skill') return null;
    return normalizeExoticSkill(editorElement('tile-exotic-skill').value);
}

export function getFormSpecialIdentity() {
    return editorElement('tile-special-identity')?.value || null;
}
