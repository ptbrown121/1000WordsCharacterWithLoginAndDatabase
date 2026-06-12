// Readers for the tile form's type-specific fields, plus the base-line
// formatters the mosaic cards reuse (via the js/ui/modals.js barrel).
import {
    ARMOR_COVERAGE_SOAK,
    ARMOR_MATERIALS,
    normalizeExoticSkill
} from '../../pool.js';

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
    if (document.getElementById('tile-type').value !== 'Gear') return null;
    if (document.getElementById('gear-subtype').value !== 'Armor') return null;
    const material = document.getElementById('armor-material').value;
    const coverage = document.getElementById('armor-coverage').value;
    if (ARMOR_MATERIALS.has(material) && coverage in ARMOR_COVERAGE_SOAK) {
        return { material, coverage };
    }
    return null;
}

export function getFormWeapon() {
    if (document.getElementById('tile-type').value !== 'Gear') return null;
    if (document.getElementById('gear-subtype').value !== 'Weapon') return null;

    const templateId = document.getElementById('weapon-template').value;
    const category = document.getElementById('weapon-category').value.trim();
    const range = document.getElementById('weapon-range').value.trim();
    const skill = document.getElementById('weapon-skill').value.trim();

    if (!templateId && !category && !range && !skill) return null;

    return { templateId, category, range, skill };
}

export function getFormAmmo() {
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

export function getFormGearSubtype() {
    if (document.getElementById('tile-type').value !== 'Gear') return '';
    return document.getElementById('gear-subtype').value || 'Custom';
}

export function getFormExoticSkill() {
    if (document.getElementById('tile-type').value !== 'Skill') return null;
    return normalizeExoticSkill(document.getElementById('tile-exotic-skill').value);
}

export function getFormSpecialIdentity() {
    return document.getElementById('tile-special-identity')?.value || null;
}
