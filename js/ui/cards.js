// @ts-check
import { escapeHtml, getExoticSkillLabel, getTileBoxes, getTileNormalCallColors, isGearTagsBroken, isHitchedTile, RESOURCE_LABELS, tileTagList } from '../pool.js';
import { COLOR_HEX } from '../data.js';
import { uiState } from '../state.js';
import { els } from '../els.js';
import { formatAmmoBase, formatArmorBase, formatWeaponBase } from './tileModal/formFields.js';
import { renderArmorSoak } from './armorSoak.js';
import { setCallColors, updatePoolPreview } from './pool.js';
import { updateShadowMax } from './vitals.js';
import { renderRulesReview } from './rulesReview.js';

/** @typedef {{tileId: string, startX: number, startY: number, lastX: number, lastY: number, targetId: string, scrollVelocity: number, active: boolean}} PointerDragState */
/** @type {import('../data.js').DataManager} */
let dataManager;
/** @type {import('../spellBuilder.js').SpellBuilder} */
let spellBuilder;
/** @type {(tile?: import('../types.js').Tile|null) => void} */
let openTileModalFn;
/** @type {string|null} */
let draggedTileId = null;
/** @type {PointerDragState|null} */
let pointerDragState = null;
let suppressCardClickUntil = 0;
let reorderMode = false;
/** @type {number|null} */
let autoScrollFrame = null;

const AUTO_SCROLL_EDGE_PX = 80;
const AUTO_SCROLL_MAX_PX = 18;

function clearDropTargets() {
    document.querySelectorAll('.tile-drop-target').forEach(card => {
        card.classList.remove('tile-drop-target');
    });
}

function clearDragClasses() {
    document.querySelectorAll('.tile-dragging, .tile-drop-target').forEach(card => {
        card.classList.remove('tile-dragging', 'tile-drop-target');
    });
}

/** @param {number} clientY */
function getAutoScrollVelocity(clientY) {
    if (!Number.isFinite(clientY)) return 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (viewportHeight <= 0) return 0;

    if (clientY < AUTO_SCROLL_EDGE_PX) {
        return -Math.ceil(AUTO_SCROLL_MAX_PX * (1 - Math.max(0, clientY) / AUTO_SCROLL_EDGE_PX));
    }
    if (clientY > viewportHeight - AUTO_SCROLL_EDGE_PX) {
        const distanceFromBottom = Math.max(0, viewportHeight - clientY);
        return Math.ceil(AUTO_SCROLL_MAX_PX * (1 - distanceFromBottom / AUTO_SCROLL_EDGE_PX));
    }
    return 0;
}

/** @param {number} clientX @param {number} clientY @param {string} sourceTileId */
function updateDropTargetAtPoint(clientX, clientY, sourceTileId) {
    clearDropTargets();
    const targetCard = document.elementFromPoint(clientX, clientY)?.closest?.('.tile-card');
    const targetId = targetCard instanceof HTMLElement ? targetCard.dataset.tileId || '' : '';
    if (targetCard instanceof HTMLElement && targetId && targetId !== sourceTileId) {
        targetCard.classList.add('tile-drop-target');
        return targetId;
    }
    return '';
}

function stopAutoScroll() {
    if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame);
    autoScrollFrame = null;
    if (pointerDragState) pointerDragState.scrollVelocity = 0;
}

/** @param {{shadow?: boolean}} [options] */
function refreshAfterTileStateChange({ shadow = false } = {}) {
    renderCards();
    updatePoolPreview();
    if (shadow) updateShadowMax();
    renderArmorSoak(dataManager.state.tiles || []);
    renderRulesReview();
}

function tickAutoScroll() {
    autoScrollFrame = null;
    if (!pointerDragState?.active || !pointerDragState.scrollVelocity) return;

    window.scrollBy({ top: pointerDragState.scrollVelocity, left: 0, behavior: 'auto' });
    pointerDragState.targetId = updateDropTargetAtPoint(
        pointerDragState.lastX,
        pointerDragState.lastY,
        pointerDragState.tileId
    );
    autoScrollFrame = requestAnimationFrame(tickAutoScroll);
}

/** @param {number} clientX @param {number} clientY */
function updateAutoScroll(clientX, clientY) {
    if (!pointerDragState?.active) return;
    pointerDragState.lastX = clientX;
    pointerDragState.lastY = clientY;
    pointerDragState.scrollVelocity = getAutoScrollVelocity(clientY);
    if (pointerDragState.scrollVelocity && !autoScrollFrame) {
        autoScrollFrame = requestAnimationFrame(tickAutoScroll);
    } else if (!pointerDragState.scrollVelocity && autoScrollFrame) {
        stopAutoScroll();
    }
}

function restoreCustomSortControls() {
    if (els.sortTilesBy) els.sortTilesBy.value = 'default';
    if (els.btnSortDir) {
        els.btnSortDir.dataset.dir = 'asc';
        els.btnSortDir.innerHTML = '\u2193';
    }
}

function syncReorderButton() {
    if (!els.btnReorderTiles) return;
    els.btnReorderTiles.classList.toggle('active', reorderMode);
    els.btnReorderTiles.setAttribute('aria-pressed', reorderMode ? 'true' : 'false');
    els.btnReorderTiles.textContent = reorderMode ? 'Done' : 'Reorder';
}

/** @param {string[]} visibleTileIds @param {string} draggedId @param {string} targetId */
function updateCustomOrder(visibleTileIds, draggedId, targetId) {
    dataManager.reorderTilesByVisibleMove(visibleTileIds, draggedId, targetId);
    stopAutoScroll();
    restoreCustomSortControls();
    renderCards();
}

/** @param {string[]} visibleTileIds @param {string} tileId @param {number} step */
function moveTileByStep(visibleTileIds, tileId, step) {
    const currentIndex = visibleTileIds.indexOf(tileId);
    const targetId = visibleTileIds[currentIndex + step];
    if (!targetId) return;
    updateCustomOrder(visibleTileIds, tileId, targetId);
}

/** @param {import('../types.js').Tile} tile */
function seedCallColorsFromTile(tile) {
    if ((uiState.callColors || []).filter(Boolean).length > 0) return;
    const tileColors = getTileNormalCallColors(tile);
    if (tileColors.length > 0) setCallColors(tileColors);
}

/** @param {import('../types.js').AppDependencies} deps */
export function init(deps) {
    dataManager = deps.dataManager;
    openTileModalFn = deps.openTileModal;
    spellBuilder = deps.spellBuilder;

    // Search
    if (els.searchTiles) {
        els.searchTiles.addEventListener('input', () => renderCards());
        if (els.sortTilesBy) els.sortTilesBy.addEventListener('change', () => renderCards());
        if (els.btnReorderTiles) {
            els.btnReorderTiles.addEventListener('click', () => {
                reorderMode = !reorderMode;
                if (reorderMode) restoreCustomSortControls();
                syncReorderButton();
                renderCards();
            });
        }
        if (els.btnSortDir) {
            els.btnSortDir.addEventListener('click', () => {
                const dir = els.btnSortDir.dataset.dir === 'asc' ? 'desc' : 'asc';
                els.btnSortDir.dataset.dir = dir;
                els.btnSortDir.innerHTML = dir === 'asc' ? '\u2193' : '\u2191';
                renderCards();
            });
        }
    }

    // Auto-filter by call colors
    els.autoFilterCall.addEventListener('change', renderCards);
}

/** @param {import('../types.js').Tile} tile */
export function handleCardClick(tile) {
    if (tile.isBurnt || tile.isBuried || tile.gearSubtype === 'Ammo') {
        // Cannot select unavailable tiles.
        return;
    }
    
    if (uiState.callTile && uiState.callTile.id === tile.id) {
        // Deselect call
        uiState.callTile = null;
    } else if (uiState.hitchCallTiles.some(t => t.id === tile.id)) {
        // Deselect additional called Hitch tile
        uiState.hitchCallTiles = uiState.hitchCallTiles.filter(t => t.id !== tile.id);
    } else if (uiState.burnTiles.some(t => t.id === tile.id)) {
        // Deselect burn
        uiState.burnTiles = uiState.burnTiles.filter(t => t.id !== tile.id);
    } else {
        // Add to pool. If no call tile, make it call. Else make it burn.
        if (!uiState.callTile) {
            uiState.callTile = tile;
            seedCallColorsFromTile(tile);
        } else if (isHitchedTile(tile)) {
            uiState.hitchCallTiles.push(tile);
        } else {
            uiState.burnTiles.push(tile);
        }
    }
    renderCards();
    updatePoolPreview();
}

export function renderCards() {
    els.cardContainer.innerHTML = '';
    syncReorderButton();
    els.cardContainer.classList.toggle('card-grid-reorder-mode', reorderMode);
    
    let searchTerm = '';
    if (els.searchTiles) {
        searchTerm = els.searchTiles.value.toLowerCase().trim();
    }
    
    let activeCallColors = [];
    if (els.autoFilterCall && els.autoFilterCall.checked) {
        activeCallColors = [...new Set((uiState.callColors || []).filter(Boolean))];
    }
    
    const filteredTiles = dataManager.state.tiles.filter(tile => {
        // Text Search
        if (searchTerm) {
            const tagsText = tileTagList(tile).join(' ');
            const searchableText = `${tile.name} ${(tile.colors || []).join(' ')} ${tile.type || 'Skill'} ${tile.gearSubtype || ''} ${tagsText} ${formatArmorBase(tile.armorType)} ${formatWeaponBase(tile.weapon)} ${formatAmmoBase(tile.ammo)} ${tile.description || ''}`.toLowerCase();
            if (!searchableText.includes(searchTerm)) return false;
        }
        
        // Auto-Filter by Call Colors
        if (activeCallColors.length > 0) {
            const hasMatchingColor = (tile.colors || []).some(c => activeCallColors.includes(c));
            if (!hasMatchingColor) return false;
        }
        
        return true;
    });

    let sortDir = els.btnSortDir ? els.btnSortDir.dataset.dir || 'asc' : 'asc';
    let sortVal = els.sortTilesBy ? els.sortTilesBy.value || 'default' : 'default';

    if (sortVal !== 'default') {
        filteredTiles.sort((a, b) => {
            let result = 0;
            if (sortVal === 'alpha') {
                result = a.name.localeCompare(b.name);
            } else if (sortVal === 'color') {
                const aColor = (a.colors && a.colors.length > 0) ? a.colors[0] : '';
                const bColor = (b.colors && b.colors.length > 0) ? b.colors[0] : '';
                result = aColor.localeCompare(bColor);
                if (result === 0) result = a.name.localeCompare(b.name);
            } else if (sortVal === 'type') {
                const aType = a.isSpell ? 'Spell' : (a.type || 'Skill');
                const bType = b.isSpell ? 'Spell' : (b.type || 'Skill');
                result = aType.localeCompare(bType);
                if (result === 0) result = a.name.localeCompare(b.name);
            }
            return sortDir === 'asc' ? result : -result;
        });
    } else {
        if (sortDir === 'desc') {
            filteredTiles.reverse();
        }
    }

    const visibleTileIds = filteredTiles.map(tile => tile.id);

    filteredTiles.forEach(tile => {
        const div = document.createElement('div');
        div.className = 'tile-card';
        div.draggable = false;
        div.dataset.tileId = tile.id;
        if (reorderMode) div.classList.add('tile-reorder-mode');
        const tileNameLabel = escapeHtml(tile.name);
        const armorLabel = formatArmorBase(tile.armorType);
        const weaponLabel = formatWeaponBase(tile.weapon);
        const ammoLabel = formatAmmoBase(tile.ammo);
        const isAmmo = tile.type === 'Gear' && tile.gearSubtype === 'Ammo';
        const isHitched = isHitchedTile(tile);
        const gearBroken = isGearTagsBroken(tile);
        const gearBreakButton = tile.type === 'Gear'
            ? `<button class="btn-toggle-gear-break" title="${gearBroken ? 'Repair' : 'Mark BREAK on'} ${tileNameLabel} gear tags" aria-label="${gearBroken ? 'Repair' : 'Mark BREAK on'} ${tileNameLabel} gear tags">${gearBroken ? 'Repair Tags' : 'Break Tags'}</button>`
            : '';
        const exoticLabel = getExoticSkillLabel(tile.exoticSkill);
        const linkedAmmoTiles = tile.weapon
            ? dataManager.state.tiles.filter(t => t.gearSubtype === 'Ammo' && t.ammo?.targetTileId === tile.id && !t.isBuried)
            : [];
        const needsAmmoLink = Boolean(tile.weapon)
            && tileTagList(tile).some(tag => String(tag).toLowerCase() === 'reload')
            && linkedAmmoTiles.length === 0;
        
        // Gradient background based on 2 colors
        const boxes = getTileBoxes(tile);
        let c1 = COLOR_HEX[(tile.colors || [])[0]] || '#444';
        let c2 = COLOR_HEX[(tile.colors || [])[1]] || c1;
        div.style.background = `linear-gradient(135deg, ${c1}44, ${c2}44)`;
        div.style.border = `1px solid ${c1}88`;

        if (uiState.callTile && uiState.callTile.id === tile.id) div.classList.add('selected-call');
        if (uiState.hitchCallTiles.some(t => t.id === tile.id)) div.classList.add('selected-hitch-call');
        if (uiState.burnTiles.some(t => t.id === tile.id)) div.classList.add('selected-burn');
        if (tile.isBurnt) div.classList.add('tile-burnt');
        if (tile.isBuried) div.classList.add('tile-buried');
        if (gearBroken) div.classList.add('tile-gear-broken');
        if (isAmmo) div.classList.add('tile-ammo-card');

        const actionButtons = tile.isBuried
            ? `<button class="btn-restore-tile" title="Restore ${tileNameLabel}" aria-label="Restore ${tileNameLabel}">Restore</button>`
            : isAmmo
                ? `<div class="tile-card-actions">
                    <button class="btn-use-ammo" ${tile.ammo?.currentSupply > 0 ? '' : 'disabled'} title="Use ammo from ${tileNameLabel}" aria-label="Use ammo from ${tileNameLabel}">Use</button>
                    <button class="btn-restock-ammo" title="Restock ${tileNameLabel}" aria-label="Restock ${tileNameLabel}">Restock</button>
                    ${gearBreakButton}
                    <button class="btn-bury-tile" title="Bury ${tileNameLabel}" aria-label="Bury ${tileNameLabel}">Bury</button>
                </div>`
            : tile.isBurnt
                ? `<div class="tile-card-actions">
                    <button class="btn-unburn" title="Un-burn ${tileNameLabel}" aria-label="Un-burn ${tileNameLabel}">Un-burn</button>
                    ${gearBreakButton}
                </div>`
                : `<div class="tile-card-actions">
                    ${isHitched ? '<span class="tile-hitch-note" title="Hitched tiles cost 1 EN when called and cannot be burned">Hitch: 1 EN</span>' : `<button class="btn-burn-instant" title="Burn ${tileNameLabel}" aria-label="Burn ${tileNameLabel}">Burn</button>`}
                    ${gearBreakButton}
                    <button class="btn-bury-tile" title="Bury ${tileNameLabel}" aria-label="Bury ${tileNameLabel}">Bury</button>
                </div>`;

        div.innerHTML = `
            <div class="tile-badges">
                ${reorderMode ? `<button class="tile-drag-handle" title="Drag ${tileNameLabel} to reorder" aria-label="Drag ${tileNameLabel} to reorder" type="button" draggable="true">Move</button>` : ''}
                ${boxes.map(box => {
                    const label = box.type === 'shadow'
                        ? `${box.kind} -> ${RESOURCE_LABELS[box.resource] || 'Resource'}`
                        : box.color;
                    const chipColor = box.type === 'shadow' ? COLOR_HEX[box.kind] : COLOR_HEX[box.color];
                    const textColor = ['Yellow', 'Qi'].includes(box.type === 'shadow' ? box.kind : box.color) ? 'black' : 'white';
                    return `<span class="badge" style="background:${chipColor}; color:${textColor}">${escapeHtml(label)}</span>`;
                }).join('')}
                ${tile.type ? `<span class="badge tile-type-badge" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3);">${escapeHtml(String(tile.type).toUpperCase())}</span>` : `<span class="badge tile-type-badge" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3);">SKILL</span>`}
                ${tile.gearSubtype ? `<span class="badge tile-subtype-badge" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.2);">${escapeHtml(String(tile.gearSubtype).toUpperCase())}</span>` : ''}
                ${gearBroken ? '<span class="badge gear-broken-badge" title="Gear tags are inactive until repaired">BREAK</span>' : ''}
                ${exoticLabel ? `<span class="badge exotic-skill-badge">${escapeHtml(exoticLabel)}</span>` : ''}
                ${tile.weapon?.category ? `<span class="badge weapon-category-badge" style="background: rgba(51, 153, 255, 0.2); color: #99ccff; border: 1px solid rgba(153,204,255,0.6);">${escapeHtml(tile.weapon.category)}</span>` : ''}
                <span class="badge" style="background: rgba(255, 215, 0, 0.2); color: #ffd700; border: 1px solid #ffd700; margin-left: auto;">${tile.xpCost !== undefined ? escapeHtml(tile.xpCost) : 0} XP</span>
            </div>
            <div class="tile-card-content">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div class="tile-name" style="margin-bottom: 0;">${escapeHtml(tile.name)}</div>
                </div>
                ${reorderMode ? `<div class="tile-reorder-controls" aria-label="Reorder ${tileNameLabel}">
                    <button type="button" class="btn-tile-move-up" aria-label="Move ${tileNameLabel} up">Up</button>
                    <button type="button" class="btn-tile-move-down" aria-label="Move ${tileNameLabel} down">Down</button>
                </div>` : ''}
                <div class="tile-tags${gearBroken ? ' tile-tags-inactive' : ''}">${gearBroken ? 'Inactive tags: ' : ''}${escapeHtml(tileTagList(tile).join(', '))}</div>
                ${armorLabel ? `<div class="tile-armor" style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">\ud83d\udee1\ufe0f ${escapeHtml(armorLabel)}</div>` : ''}
                ${weaponLabel ? `<div class="tile-weapon" style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">${escapeHtml(weaponLabel)}</div>` : ''}
                ${linkedAmmoTiles.length ? `<div class="tile-ammo-links" style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">Ammo: ${escapeHtml(linkedAmmoTiles.map(t => `${t.name} ${t.ammo?.currentSupply ?? 0}/${t.ammo?.maxSupply ?? 0}`).join(', '))}</div>` : ''}
                ${needsAmmoLink ? `<div class="tile-ammo-warning" style="font-size: 0.8rem; color: #ffd166; margin-top: 0.25rem;">Reload weapon has no linked ammo</div>` : ''}
                ${ammoLabel ? `<div class="tile-ammo" style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">${escapeHtml(ammoLabel)}</div>` : ''}
                <div class="tile-dice">${isAmmo ? 'No dice' : escapeHtml((tile.dice || []).join(', '))}</div>
                <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem;">
                    <button class="btn-edit-tile" aria-label="Edit ${tileNameLabel}">\u270f\ufe0f Edit</button>
                    ${tile.description ? `<button class="btn-details">Details \u25bc</button>` : ''}
                </div>
                ${tile.description ? `<div class="tile-description" style="display: none; margin-top: 0.5rem; font-size: 0.9rem; font-style: italic; color: var(--text-secondary); background: rgba(0,0,0,0.3); padding: 0.5rem; border-radius: 4px; white-space: pre-wrap;">${escapeHtml(tile.description)}</div>` : ''}
            </div>
            ${actionButtons}
        `;

        if (reorderMode) {
            const btnMoveUp = div.querySelector('.btn-tile-move-up');
            const btnMoveDown = div.querySelector('.btn-tile-move-down');
            if (btnMoveUp instanceof HTMLButtonElement) {
                btnMoveUp.disabled = visibleTileIds.indexOf(tile.id) === 0;
                btnMoveUp.addEventListener('click', (e) => {
                    e.stopPropagation();
                    moveTileByStep(visibleTileIds, tile.id, -1);
                });
            }
            if (btnMoveDown instanceof HTMLButtonElement) {
                btnMoveDown.disabled = visibleTileIds.indexOf(tile.id) === visibleTileIds.length - 1;
                btnMoveDown.addEventListener('click', (e) => {
                    e.stopPropagation();
                    moveTileByStep(visibleTileIds, tile.id, 1);
                });
            }

            const dragHandle = div.querySelector('.tile-drag-handle');
            if (dragHandle instanceof HTMLElement) {
                dragHandle.addEventListener('click', (e) => e.stopPropagation());
                dragHandle.addEventListener('pointerdown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    pointerDragState = {
                        tileId: tile.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        lastX: e.clientX,
                        lastY: e.clientY,
                        targetId: '',
                        scrollVelocity: 0,
                        active: false
                    };
                    dragHandle.setPointerCapture?.(e.pointerId);
                });
                dragHandle.addEventListener('pointermove', (e) => {
                    if (!pointerDragState || pointerDragState.tileId !== tile.id) return;
                    const distance = Math.hypot(e.clientX - pointerDragState.startX, e.clientY - pointerDragState.startY);
                    if (!pointerDragState.active && distance < 8) return;

                    pointerDragState.active = true;
                    suppressCardClickUntil = Date.now() + 600;
                    e.preventDefault();
                    e.stopPropagation();
                    clearDropTargets();
                    div.classList.add('tile-dragging');

                    pointerDragState.lastX = e.clientX;
                    pointerDragState.lastY = e.clientY;
                    pointerDragState.targetId = updateDropTargetAtPoint(e.clientX, e.clientY, tile.id);
                    updateAutoScroll(e.clientX, e.clientY);
                });
                dragHandle.addEventListener('pointerup', (e) => {
                    if (!pointerDragState || pointerDragState.tileId !== tile.id) return;
                    const targetId = pointerDragState.targetId;
                    const wasActive = pointerDragState.active;
                    pointerDragState = null;
                    stopAutoScroll();
                    dragHandle.releasePointerCapture?.(e.pointerId);
                    clearDragClasses();
                    if (wasActive) {
                        suppressCardClickUntil = Date.now() + 600;
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    if (wasActive && targetId) {
                        updateCustomOrder(visibleTileIds, tile.id, targetId);
                    }
                });
                dragHandle.addEventListener('pointercancel', () => {
                    pointerDragState = null;
                    stopAutoScroll();
                    clearDragClasses();
                });

                dragHandle.addEventListener('dragstart', (e) => {
                    e.stopPropagation();
                    draggedTileId = tile.id;
                    suppressCardClickUntil = Date.now() + 600;
                    div.classList.add('tile-dragging');
                    if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', tile.id);
                    }
                });
                dragHandle.addEventListener('dragend', () => {
                    draggedTileId = null;
                    stopAutoScroll();
                    suppressCardClickUntil = Date.now() + 600;
                    clearDragClasses();
                });
            }

            div.addEventListener('dragover', (e) => {
                const incomingId = draggedTileId || e.dataTransfer?.getData('text/plain');
                if (!incomingId || incomingId === tile.id) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                pointerDragState = {
                    tileId: incomingId,
                    startX: e.clientX,
                    startY: e.clientY,
                    lastX: e.clientX,
                    lastY: e.clientY,
                    targetId: tile.id,
                    scrollVelocity: getAutoScrollVelocity(e.clientY),
                    active: true
                };
                updateAutoScroll(e.clientX, e.clientY);
                div.classList.add('tile-drop-target');
            });

            div.addEventListener('dragleave', () => {
                div.classList.remove('tile-drop-target');
            });

            div.addEventListener('drop', (e) => {
                const incomingId = e.dataTransfer?.getData('text/plain') || draggedTileId;
                if (!incomingId || incomingId === tile.id) return;
                e.preventDefault();
                e.stopPropagation();
                draggedTileId = null;
                pointerDragState = null;
                stopAutoScroll();
                suppressCardClickUntil = Date.now() + 600;
                updateCustomOrder(visibleTileIds, incomingId, tile.id);
            });
        }

        if (tile.isBuried) {
            const btnRestore = /** @type {HTMLButtonElement} */ (div.querySelector('.btn-restore-tile'));
            btnRestore.addEventListener('click', (e) => {
                e.stopPropagation();
                tile.isBuried = false;
                dataManager.updateTile(tile);
                refreshAfterTileStateChange({ shadow: true });
            });
        } else {
            const btnToggleGearBreak = div.querySelector('.btn-toggle-gear-break');
            if (btnToggleGearBreak) {
                btnToggleGearBreak.addEventListener('click', (e) => {
                    e.stopPropagation();
                    tile.gearBroken = !tile.gearBroken;
                    dataManager.updateTile(tile);
                    if (uiState.callTile && uiState.callTile.id === tile.id) uiState.callTile = tile;
                    uiState.hitchCallTiles = uiState.hitchCallTiles.map(t => t.id === tile.id ? tile : t);
                    if (!isHitchedTile(tile)) {
                        uiState.hitchCallTiles = uiState.hitchCallTiles.filter(t => t.id !== tile.id);
                    }
                    uiState.burnTiles = uiState.burnTiles.map(t => t.id === tile.id ? tile : t);
                    refreshAfterTileStateChange({ shadow: true });
                });
            }
        }

        if (!tile.isBuried && isAmmo) {
            const btnUseAmmo = /** @type {HTMLButtonElement} */ (div.querySelector('.btn-use-ammo'));
            const btnRestockAmmo = /** @type {HTMLButtonElement} */ (div.querySelector('.btn-restock-ammo'));
            const btnBury = /** @type {HTMLButtonElement} */ (div.querySelector('.btn-bury-tile'));

            btnUseAmmo.addEventListener('click', (e) => {
                e.stopPropagation();
                tile.ammo = tile.ammo || { currentSupply: 0, maxSupply: 0, replacesTag: 'Reload' };
                tile.ammo.currentSupply = Math.max(0, (parseInt(tile.ammo.currentSupply, 10) || 0) - 1);
                dataManager.updateTile(tile);
                renderCards();
                renderRulesReview();
            });
            btnRestockAmmo.addEventListener('click', (e) => {
                e.stopPropagation();
                tile.ammo = tile.ammo || { currentSupply: 0, maxSupply: 0, replacesTag: 'Reload' };
                tile.ammo.currentSupply = Math.max(0, parseInt(tile.ammo.maxSupply, 10) || 0);
                dataManager.updateTile(tile);
                renderCards();
                renderRulesReview();
            });
            btnBury.addEventListener('click', (e) => {
                e.stopPropagation();
                tile.isBuried = true;
                tile.isBurnt = false;
                dataManager.updateTile(tile);
                refreshAfterTileStateChange({ shadow: true });
            });
        } else if (!tile.isBuried && tile.isBurnt) {
            const btnUnburn = /** @type {HTMLButtonElement} */ (div.querySelector('.btn-unburn'));
            btnUnburn.addEventListener('click', (e) => {
                e.stopPropagation();
                tile.isBurnt = false;
                dataManager.updateTile(tile);
                refreshAfterTileStateChange();
            });
        } else if (!tile.isBuried) {
            const btnBurn = div.querySelector('.btn-burn-instant');
            if (btnBurn) {
                btnBurn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    tile.isBurnt = true;
                    if (uiState.callTile && uiState.callTile.id === tile.id) uiState.callTile = null;
                    uiState.hitchCallTiles = uiState.hitchCallTiles.filter(t => t.id !== tile.id);
                    uiState.burnTiles = uiState.burnTiles.filter(t => t.id !== tile.id);
                    dataManager.updateTile(tile);
                    refreshAfterTileStateChange();
                });
            }
            const btnBury = /** @type {HTMLButtonElement} */ (div.querySelector('.btn-bury-tile'));
            btnBury.addEventListener('click', (e) => {
                e.stopPropagation();
                tile.isBuried = true;
                tile.isBurnt = false;
                if (uiState.callTile && uiState.callTile.id === tile.id) uiState.callTile = null;
                uiState.hitchCallTiles = uiState.hitchCallTiles.filter(t => t.id !== tile.id);
                uiState.burnTiles = uiState.burnTiles.filter(t => t.id !== tile.id);
                dataManager.updateTile(tile);
                refreshAfterTileStateChange({ shadow: true });
            });
        }

        const btnEdit = /** @type {HTMLButtonElement} */ (div.querySelector('.btn-edit-tile'));
        btnEdit.addEventListener('click', (e) => {
            e.stopPropagation();
            if (tile.isSpell) {
                spellBuilder.openWizard(tile);
            } else {
                openTileModalFn(tile);
            }
        });

        if (tile.description) {
            const btnDetails = /** @type {HTMLButtonElement} */ (div.querySelector('.btn-details'));
            const descDiv = /** @type {HTMLElement} */ (div.querySelector('.tile-description'));
            btnDetails.addEventListener('click', (e) => {
                e.stopPropagation();
                if (descDiv.style.display === 'none') {
                    descDiv.style.display = 'block';
                    btnDetails.innerText = 'Details \u25b2';
                } else {
                    descDiv.style.display = 'none';
                    btnDetails.innerText = 'Details \u25bc';
                }
            });
        }

        // Click to Select for Pool
        div.addEventListener('click', () => {
            if (reorderMode) return;
            if (Date.now() < suppressCardClickUntil) return;
            handleCardClick(tile);
        });
        
        // Long press or right click to Edit
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (tile.isSpell) {
                spellBuilder.openWizard(tile);
            } else {
                openTileModalFn(tile);
            }
        });

        els.cardContainer.appendChild(div);
    });
}
