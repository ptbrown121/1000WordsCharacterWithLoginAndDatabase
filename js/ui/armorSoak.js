// @ts-check
import { calculateArmorSoakDetails } from '../pool.js';
import { els } from '../els.js';

/** @param {import('../types.js').Tile[]} [tiles] */
export function renderArmorSoak(tiles = []) {
    if (!els.valArmorSoak || !els.armorSoakDetail) return;

    const armorSoak = calculateArmorSoakDetails(tiles || []);
    els.valArmorSoak.innerText = String(armorSoak.total);
    const armorDetails = armorSoak.sources.map(source => {
        const parts = [`${source.tileName}: ${source.coverage} ${source.material} +${source.baseSoak}`];
        if (source.ironcladSoak > 0) parts.push(`Ironclad +${source.ironcladSoak}`);
        return `${parts.join(', ')} = +${source.total}`;
    });
    els.armorSoakDetail.textContent = armorDetails.length
        ? `${armorDetails.join('; ')} — applies when the armor tile is called`
        : 'No active armor';
    els.armorSoakDetail.title = els.armorSoakDetail.textContent;
}
