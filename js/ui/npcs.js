// @ts-check
// GM-side NPC tracker panel (v5.02 p.71). NPCs are independent of player
// characters. They live either in this browser's localStorage or - when a
// signed-in GM picks one of their campaigns in the "Stored in" selector -
// in the campaign_npcs table, so a campaign keeps one shared NPC roster.
import { els } from '../els.js';
import { escapeHtml } from '../pool.js';
import { showAlert, showConfirm } from './dialogService.js';
import { requiredEditorElement } from './editorDom.js';
import {
    NPC_RANK_EXAMPLES,
    getDescriptorDie,
    normalizeNpc,
    normalizeNpcBlastZone,
    normalizeNpcList,
    reviewNpcBuild,
    rollNpcAttack,
    rollNpcDefense,
    rollNpcStatCheck
} from '../npc-rules.js';

const STORAGE_KEY = '1000words_npcs';
const LOCAL_STORAGE_ID = 'local';

/** @type {import('../data.js').DataManager} */
let dataManager;
/** @type {import('../pool.js').PoolEngine} */
let poolEngine;
/** @type {import('../types.js').Npc[]} */
let npcs = [];
let storageId = LOCAL_STORAGE_ID;
let loading = false;
let storageError = '';
let storageOptionsSnapshot = '';
let storageLoadVersion = 0;
let copying = false;

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));

const npcInput = (id) => requiredEditorElement(document, `#${id}`, HTMLInputElement);
const npcSelect = (id) => requiredEditorElement(document, `#${id}`, HTMLSelectElement);
const npcButton = (id) => requiredEditorElement(document, `#${id}`, HTMLButtonElement);
const npcElement = (id) => requiredEditorElement(document, `#${id}`, HTMLElement);

/** @param {unknown} error @param {string} fallback */
function getErrorMessage(error, fallback) {
    return error instanceof Error ? error.message : fallback;
}

function getGmCampaigns() {
    return (dataManager?.campaigns || []).filter(campaign => campaign.role === 'gm');
}

function isCampaignStorage() {
    return storageId !== LOCAL_STORAGE_ID;
}

function readLocalNpcs() {
    try {
        return normalizeNpcList(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '[]'));
    } catch {
        return [];
    }
}

function saveLocalNpcs() {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(npcs));
    } catch (e) {
        console.error('Failed to save NPCs', e);
    }
}

function reportStorageError(error, fallback) {
    storageError = getErrorMessage(error, fallback);
    renderNpcs();
}

// Persist one NPC to wherever the panel currently points. Cloud writes are
// optimistic: the list updates immediately and a failure surfaces in the
// storage note.
function persistNpc(npc) {
    storageError = '';
    if (!isCampaignStorage()) {
        saveLocalNpcs();
        return;
    }
    if (!isUuid(npc.id)) npc.id = crypto.randomUUID();
    dataManager.cloudStore?.saveCampaignNpc(storageId, npc)
        .catch(error => reportStorageError(error, `Could not save ${npc.name} to the campaign.`));
}

function removeNpc(npcId) {
    storageError = '';
    if (!isCampaignStorage()) {
        saveLocalNpcs();
        return;
    }
    dataManager.cloudStore?.deleteCampaignNpc(npcId)
        .catch(error => reportStorageError(error, 'Could not delete the NPC from the campaign.'));
}

async function switchStorage(nextId) {
    const version = ++storageLoadVersion;
    storageId = nextId;
    storageError = '';
    loading = false;
    if (!isCampaignStorage()) {
        npcs = readLocalNpcs();
        renderNpcs();
        return;
    }

    npcs = [];
    loading = true;
    renderNpcs();
    try {
        const loaded = await dataManager.cloudStore.listCampaignNpcs(nextId);
        if (version !== storageLoadVersion) return;
        npcs = normalizeNpcList(loaded);
    } catch (error) {
        if (version !== storageLoadVersion) return;
        storageId = LOCAL_STORAGE_ID;
        npcs = readLocalNpcs();
        storageError = `Showing this browser instead. ${getErrorMessage(error, 'Could not load campaign NPCs.')}`;
    } finally {
        if (version === storageLoadVersion) {
            loading = false;
            renderNpcs();
        }
    }
}

async function copyLocalNpcsToCampaign() {
    const campaign = getGmCampaigns().find(entry => entry.id === storageId);
    if (!campaign || loading || copying) return;
    const locals = readLocalNpcs();
    if (locals.length === 0) return;
    if (!await showConfirm(`Copy ${locals.length} browser NPC${locals.length === 1 ? '' : 's'} into ${campaign.name}? The browser copies stay.`, { title: 'Copy browser NPCs?' })) return;
    if (storageId !== campaign.id) return;

    storageError = '';
    copying = true;
    renderStorageControls();
    try {
        for (const local of locals) {
            // Fresh ids let the browser NPC be copied into several campaigns.
            const copy = normalizeNpc({ ...local, id: crypto.randomUUID() });
            await dataManager.cloudStore.saveCampaignNpc(campaign.id, copy);
            if (storageId === campaign.id) npcs.push(copy);
        }
    } catch (error) {
        storageError = `Could not copy NPCs to ${campaign.name}. ${getErrorMessage(error, 'Please try again.')}`;
    } finally {
        copying = false;
        renderNpcs();
    }
}

function rollDie(die) {
    return poolEngine.rollDie(die);
}

function findNpc(id) {
    return npcs.find(npc => npc.id === id) || null;
}

function formatRolls(result) {
    // Blast-zone-pushed dice show as "d8→d10:7".
    return result.rolls.map(roll => `${roll.baseDie ? `${roll.baseDie}→` : ''}${roll.die}:${roll.val}`).join(' ');
}

function renderBudgetNote() {
    const note = npcElement('npc-budget-note');
    const draft = {
        rank: npcSelect('npc-rank').value,
        might: npcInput('npc-might').value,
        charm: npcInput('npc-charm').value,
        skill: npcInput('npc-skill').value,
        hpMax: npcInput('npc-hp').value,
        enMax: npcInput('npc-en').value,
        rxMax: npcInput('npc-rx').value,
        descriptors: npcInput('npc-descriptors').value
            .split(',')
            .map(part => part.trim())
            .filter(Boolean)
    };
    const review = reviewNpcBuild(draft);
    const poolText = `${review.poolTotal}/${review.budgets.resourcePoints} resource points`;
    const stepText = `${review.statSteps}/${review.budgets.statSteps} stat ▟`;
    const descriptorText = review.descriptorDelta > 0
        ? ` ${review.descriptorCount}/${review.budgets.descriptors} descriptors — over the Rank limit.`
        : '';
    note.textContent = `Budget: ${poolText}; ${stepText} (advisory).${descriptorText}`;
}

function applyRankExample() {
    const rank = toInt(npcSelect('npc-rank').value) || 3;
    const example = NPC_RANK_EXAMPLES[Math.min(5, Math.max(1, rank))];
    if (!example) return;
    npcInput('npc-might').value = example.might;
    npcInput('npc-charm').value = example.charm;
    npcInput('npc-skill').value = example.skill;
    npcInput('npc-hp').value = String(example.hp);
    npcInput('npc-en').value = String(example.en);
    npcInput('npc-rx').value = String(example.rx);
    renderBudgetNote();
}

function addNpcFromForm() {
    if (loading || copying) return;
    const name = npcInput('npc-name').value.trim();
    if (!name) {
        showAlert('Give the NPC a name.');
        return;
    }
    const descriptors = npcInput('npc-descriptors').value
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);

    const npc = normalizeNpc({
        name,
        rank: npcSelect('npc-rank').value,
        might: npcInput('npc-might').value,
        charm: npcInput('npc-charm').value,
        skill: npcInput('npc-skill').value,
        hpMax: npcInput('npc-hp').value,
        enMax: npcInput('npc-en').value,
        rxMax: npcInput('npc-rx').value,
        descriptors
    });
    npcs.push(npc);
    persistNpc(npc);
    npcInput('npc-name').value = '';
    npcInput('npc-descriptors').value = '';
    renderNpcs();
}

function setNpcNote(npc, text) {
    npc.notes = text;
}

async function handleNpcAction(npcId, action, payload) {
    const npc = findNpc(npcId);
    if (!npc) return;

    if (action === 'delete') {
        if (!await showConfirm(`Delete ${npc.name}?`, { title: 'Delete NPC?', confirmLabel: 'Delete NPC', danger: true })) return;
        npcs = npcs.filter(entry => entry.id !== npcId);
        removeNpc(npcId);
        renderNpcs();
        return;
    }

    if (action === 'pool') {
        const { pool, step } = payload;
        npc[pool] = Math.max(0, toInt(npc[pool]) + step);
    } else if (action === 'set-static') {
        const attack = rollNpcAttack(npc, rollDie);
        const defense = rollNpcDefense(npc, rollDie);
        npc.attackStatic = attack.total;
        npc.defenseStatic = defense.total;
        setNpcNote(npc, `Static set - Attack ${attack.total} (${formatRolls(attack)} + Rank ${npc.rank}), Defense ${defense.total} (${formatRolls(defense)} + Rank ${npc.rank}).`);
    } else if (action === 'roll-might') {
        const result = rollNpcStatCheck(npc, 'might', rollDie);
        setNpcNote(npc, `Might (injury): ${result.total} (${formatRolls(result)}).`);
    } else if (action === 'check') {
        const stat = payload.stat;
        const result = rollNpcStatCheck(npc, stat, rollDie);
        setNpcNote(npc, `${stat.charAt(0).toUpperCase()}${stat.slice(1)} check: ${result.total} (${formatRolls(result)}).`);
    } else if (action === 'forced-burn') {
        if (npc.rank <= 1) {
            setNpcNote(npc, 'Rank is already 1; a further forced burn takes this NPC out (GM call).');
        } else {
            npc.rank -= 1;
            npc.attackStatic = null;
            npc.defenseStatic = null;
            setNpcNote(npc, `Forced burn: Rank drops to ${npc.rank}. Re-set static Attack/Defense.`);
        }
    } else if (action === 'descriptor') {
        const descriptor = npc.descriptors[payload.index];
        if (descriptor) {
            descriptor.spent = !descriptor.spent;
            if (descriptor.spent) {
                setNpcNote(npc, `Spent "${descriptor.text}": freebie ${getDescriptorDie(npc.rank)} on a check, or another edge.`);
            }
        }
    } else if (action === 'blast-zone') {
        npc.blastZone = normalizeNpcBlastZone(payload.zone);
    }

    persistNpc(npc);
    renderNpcs();
}

function renderNpcCard(npc) {
    const pools = ['hp', 'en', 'rx'].map(pool => `
        <span class="crit-counter" title="${pool.toUpperCase()} ${npc[pool]}/${npc[`${pool}Max`]}">
            <button type="button" class="crit-step" data-npc-id="${npc.id}" data-action="pool" data-pool="${pool}" data-step="-1" aria-label="Decrease ${pool.toUpperCase()}">-</button>
            <span class="crit-label">${pool.toUpperCase()} ${npc[pool]}/${npc[`${pool}Max`]}</span>
            <button type="button" class="crit-step" data-npc-id="${npc.id}" data-action="pool" data-pool="${pool}" data-step="1" aria-label="Increase ${pool.toUpperCase()}">+</button>
        </span>
    `).join('');

    const descriptorOverage = npc.descriptors.length > npc.rank
        ? `<span class="status-badge status-major" title="NPCs get up to Rank descriptors (advisory)">${npc.descriptors.length}/${npc.rank} over Rank</span>`
        : '';
    const descriptors = npc.descriptors.map((descriptor, index) => `
        <label class="filter-toggle" title="Spend for a freebie ${getDescriptorDie(npc.rank)} (Rank ▟) on a check, or another edge">
            <input type="checkbox" data-npc-id="${npc.id}" data-action="descriptor" data-index="${index}"${descriptor.spent ? ' checked' : ''}>
            ${escapeHtml(descriptor.text)}
        </label>
    `).join('') + descriptorOverage;

    const statics = npc.attackStatic !== null || npc.defenseStatic !== null
        ? `<strong>Attack ${npc.attackStatic ?? '—'} / Defense ${npc.defenseStatic ?? '—'}</strong> · `
        : '';

    return `
        <div class="npc-card" data-npc-id="${npc.id}">
            <div class="npc-card-header">
                <strong>${escapeHtml(npc.name)}</strong>
                <span class="status-badge status-major" title="Rank is Soak and Grit and adds to Attack/Defense">Rank ${npc.rank} (Soak/Grit ${npc.rank})</span>
                <button type="button" class="crit-step" data-npc-id="${npc.id}" data-action="delete" title="Delete NPC" aria-label="Delete ${escapeHtml(npc.name)}">×</button>
            </div>
            <div class="press-tracker-row">${pools}</div>
            <div class="press-tracker-row" style="font-size: 0.85rem;">
                <span>Might ${escapeHtml(npc.might)} · Charm ${escapeHtml(npc.charm)} · Skill ${escapeHtml(npc.skill)}</span>
                <label class="filter-toggle" title="Aberrant Blast Zone (p.59): rolls push this NPC's dice above d6 by 1 ▟ (GM-pending ruling)">
                    Blast zone
                    <select data-npc-id="${npc.id}" data-action="blast-zone">
                        <option value="">None</option>
                        <option value="risen"${npc.blastZone === 'risen' ? ' selected' : ''}>Risen (−1 ▟)</option>
                        <option value="fallen"${npc.blastZone === 'fallen' ? ' selected' : ''}>Fallen (+1 ▟)</option>
                    </select>
                </label>
            </div>
            <div class="press-tracker-row">
                <button type="button" class="btn btn-outline" data-npc-id="${npc.id}" data-action="set-static" title="Roll Skill + Rank and Charm + Rank once for the fight">Set Attack/Defense</button>
                <button type="button" class="btn btn-outline" data-npc-id="${npc.id}" data-action="roll-might" title="Might rolls when the NPC deals injury">Roll Impact</button>
                <button type="button" class="btn btn-outline" data-npc-id="${npc.id}" data-action="check" data-stat="might">M check</button>
                <button type="button" class="btn btn-outline" data-npc-id="${npc.id}" data-action="check" data-stat="charm">C check</button>
                <button type="button" class="btn btn-outline" data-npc-id="${npc.id}" data-action="check" data-stat="skill">S check</button>
                <button type="button" class="btn btn-outline" data-npc-id="${npc.id}" data-action="forced-burn" title="A forced burn reduces Rank by 1">Forced burn</button>
            </div>
            ${descriptors ? `<div class="press-tracker-row">${descriptors}</div>` : ''}
            <div class="npc-note">${statics}${escapeHtml(npc.notes || '')}</div>
        </div>
    `;
}

// The "Stored in" selector lists this browser plus every campaign the user
// GMs. It only rebuilds when that set changes (cloud status events fire on
// every save) and never while the dropdown has focus.
function renderStorageControls() {
    const row = npcElement('npc-storage-row');
    const select = npcSelect('npc-storage-select');
    const gmCampaigns = getGmCampaigns();
    const canUseCampaigns = Boolean(dataManager?.cloudStore && gmCampaigns.length);
    row.hidden = !canUseCampaigns;
    if (isCampaignStorage() && (!canUseCampaigns || !gmCampaigns.some(campaign => campaign.id === storageId))) {
        switchStorage(LOCAL_STORAGE_ID);
        return;
    }

    const snapshot = JSON.stringify(gmCampaigns.map(campaign => [campaign.id, campaign.name]));
    if (snapshot !== storageOptionsSnapshot && document.activeElement !== select) {
        storageOptionsSnapshot = snapshot;
        select.innerHTML = `<option value="${LOCAL_STORAGE_ID}">This browser</option>` + gmCampaigns.map(campaign =>
            `<option value="${escapeHtml(campaign.id)}">${escapeHtml(campaign.name)} (campaign)</option>`
        ).join('');
    }
    select.value = storageId;
    select.disabled = loading || copying;

    const campaign = gmCampaigns.find(entry => entry.id === storageId);
    const destination = campaign?.name || 'This browser';
    els.npcStorageDestination.textContent = `NPC storage: ${destination}`;
    els.npcStorageDestination.classList.toggle('npc-storage-campaign', Boolean(campaign));
    const addButton = npcButton('btn-npc-add');
    addButton.textContent = `Add NPC to ${destination}`;
    addButton.disabled = loading || copying;
    const copyButton = npcButton('btn-npc-copy-local');
    copyButton.hidden = !campaign || readLocalNpcs().length === 0;
    copyButton.textContent = `Copy browser NPCs to ${destination}`;
    copyButton.disabled = loading || copying;

    els.npcStorageNote.textContent = storageError || (loading
        ? `Loading NPCs from ${destination}...`
        : copying
            ? `Copying browser NPCs to ${destination}...`
            : campaign
                ? `Shared with all GMs of ${destination}. NPC storage is separate from Campaign to manage.`
                : canUseCampaigns
                    ? 'Only on this device. NPC storage is separate from Campaign to manage.'
                    : 'Only on this device. Sign in as a campaign GM to store NPCs with a campaign.');
}

export function renderNpcs() {
    const summary = npcElement('npc-summary');
    const list = els.npcList;
    {
        summary.textContent = npcs.length === 0
            ? 'No NPCs'
            : npcs.map(npc => `${npc.name} R${npc.rank}`).join(' · ');
    }
    {
        const empty = loading
            ? '<small>Loading campaign NPCs...</small>'
            : '<small>No NPCs yet. Fill the form above (Use Rank example gives the printed stat block).</small>';
        list.innerHTML = npcs.map(renderNpcCard).join('') || empty;
    }
    renderStorageControls();
    renderBudgetNote();
}

/** @param {{dataManager: import('../data.js').DataManager, poolEngine: import('../pool.js').PoolEngine}} deps */
export function init(deps) {
    dataManager = deps.dataManager;
    poolEngine = deps.poolEngine;
    npcs = readLocalNpcs();

    if (els.btnNpcToggle && els.npcPanelBody) {
        els.btnNpcToggle.addEventListener('click', () => {
            const isOpening = els.npcPanelBody.hidden;
            els.npcPanelBody.hidden = !isOpening;
            els.btnNpcToggle.setAttribute('aria-expanded', String(isOpening));
            els.btnNpcToggle.textContent = isOpening ? 'Hide' : 'Show';
        });
    }

    npcButton('btn-npc-example').addEventListener('click', applyRankExample);
    npcButton('btn-npc-add').addEventListener('click', addNpcFromForm);
    npcElement('npc-add-form').addEventListener('input', renderBudgetNote);
    const storageSelect = npcSelect('npc-storage-select');
    storageSelect.addEventListener('change', () => {
        switchStorage(storageSelect.value);
    });
    npcButton('btn-npc-copy-local').addEventListener('click', copyLocalNpcsToCampaign);

    // Campaigns load after sign-in (and vanish on sign-out), so refresh the
    // storage selector whenever the cloud state changes.
    window.addEventListener('cloud-status-change', renderStorageControls);

    els.npcList.addEventListener('click', (e) => {
        const control = e.target instanceof Element ? e.target.closest('[data-action]') : null;
        // Descriptor checkboxes and the blast-zone select act on 'change'.
        if (!(control instanceof HTMLElement) || ['descriptor', 'blast-zone'].includes(control.dataset.action || '')) return;
        if (!control.dataset.npcId || !control.dataset.action) return;
        handleNpcAction(control.dataset.npcId, control.dataset.action, {
            pool: control.dataset.pool,
            step: toInt(control.dataset.step),
            stat: control.dataset.stat
        });
    });

    els.npcList.addEventListener('change', (e) => {
        const control = e.target instanceof Element ? e.target.closest('[data-action]') : null;
        if (!(control instanceof HTMLElement) || !control.dataset.npcId) return;
        if (control.dataset.action === 'descriptor') {
            handleNpcAction(control.dataset.npcId, 'descriptor', { index: toInt(control.dataset.index) });
        } else if (control.dataset.action === 'blast-zone' && control instanceof HTMLSelectElement) {
            handleNpcAction(control.dataset.npcId, 'blast-zone', { zone: control.value });
        }
    });

    renderNpcs();
}
