// GM-side NPC tracker panel (v5.02 p.71). NPCs are independent of player
// characters. They live either in this browser's localStorage or - when a
// signed-in GM picks one of their campaigns in the "Stored in" selector -
// in the campaign_npcs table, so a campaign keeps one shared NPC roster.
import { els } from '../els.js';
import { escapeHtml } from '../pool.js';
import {
    NPC_RANK_EXAMPLES,
    getDescriptorDie,
    getNpcBudgets,
    normalizeNpc,
    normalizeNpcBlastZone,
    normalizeNpcList,
    reviewNpcBuild,
    rollNpcAttack,
    rollNpcDefense,
    rollNpcStat
} from '../npc-rules.js';

const STORAGE_KEY = '1000words_npcs';
const LOCAL_STORAGE_ID = 'local';

let dataManager;
let poolEngine;
let npcs = [];
let storageId = LOCAL_STORAGE_ID;
let loading = false;
let storageError = '';
let storageOptionsSnapshot = '';

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value));

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
    storageError = error?.message || fallback;
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
    storageId = nextId;
    storageError = '';
    if (!isCampaignStorage()) {
        npcs = readLocalNpcs();
        renderNpcs();
        return;
    }

    npcs = [];
    loading = true;
    renderNpcs();
    try {
        npcs = normalizeNpcList(await dataManager.cloudStore.listCampaignNpcs(storageId));
    } catch (error) {
        storageId = LOCAL_STORAGE_ID;
        npcs = readLocalNpcs();
        storageError = error?.message || 'Could not load campaign NPCs; showing this browser instead.';
    }
    loading = false;
    renderNpcs();
}

async function copyLocalNpcsToCampaign() {
    if (!isCampaignStorage()) return;
    const locals = readLocalNpcs();
    if (locals.length === 0) return;
    if (!confirm(`Copy ${locals.length} browser NPC${locals.length === 1 ? '' : 's'} into this campaign? The browser copies stay.`)) return;

    storageError = '';
    for (const local of locals) {
        // Fresh ids: the same browser NPC may be copied into several
        // campaigns, and reusing the id would move it instead.
        const copy = normalizeNpc({ ...local, id: crypto.randomUUID() });
        try {
            await dataManager.cloudStore.saveCampaignNpc(storageId, copy);
            npcs.push(copy);
        } catch (error) {
            storageError = error?.message || `Could not copy ${copy.name} to the campaign.`;
            break;
        }
    }
    renderNpcs();
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
    const note = document.getElementById('npc-budget-note');
    if (!note) return;
    const draft = {
        rank: document.getElementById('npc-rank')?.value,
        might: document.getElementById('npc-might')?.value,
        charm: document.getElementById('npc-charm')?.value,
        skill: document.getElementById('npc-skill')?.value,
        hpMax: document.getElementById('npc-hp')?.value,
        enMax: document.getElementById('npc-en')?.value,
        rxMax: document.getElementById('npc-rx')?.value,
        descriptors: (document.getElementById('npc-descriptors')?.value || '')
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
    const rank = toInt(document.getElementById('npc-rank')?.value) || 3;
    const example = NPC_RANK_EXAMPLES[Math.min(5, Math.max(1, rank))];
    if (!example) return;
    document.getElementById('npc-might').value = example.might;
    document.getElementById('npc-charm').value = example.charm;
    document.getElementById('npc-skill').value = example.skill;
    document.getElementById('npc-hp').value = String(example.hp);
    document.getElementById('npc-en').value = String(example.en);
    document.getElementById('npc-rx').value = String(example.rx);
    renderBudgetNote();
}

function addNpcFromForm() {
    const name = document.getElementById('npc-name')?.value.trim();
    if (!name) {
        alert('Give the NPC a name.');
        return;
    }
    const descriptors = (document.getElementById('npc-descriptors')?.value || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);

    const npc = normalizeNpc({
        name,
        rank: document.getElementById('npc-rank')?.value,
        might: document.getElementById('npc-might')?.value,
        charm: document.getElementById('npc-charm')?.value,
        skill: document.getElementById('npc-skill')?.value,
        hpMax: document.getElementById('npc-hp')?.value,
        enMax: document.getElementById('npc-en')?.value,
        rxMax: document.getElementById('npc-rx')?.value,
        descriptors
    });
    npcs.push(npc);
    persistNpc(npc);
    document.getElementById('npc-name').value = '';
    document.getElementById('npc-descriptors').value = '';
    renderNpcs();
}

function setNpcNote(npc, text) {
    npc.notes = text;
}

function handleNpcAction(npcId, action, payload) {
    const npc = findNpc(npcId);
    if (!npc) return;

    if (action === 'delete') {
        if (!confirm(`Delete ${npc.name}?`)) return;
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
        const result = rollNpcStat(npc.might, rollDie);
        setNpcNote(npc, `Might (injury): ${result.total} (${formatRolls(result)}).`);
    } else if (action === 'check') {
        const stat = payload.stat;
        const result = rollNpcStat(npc[stat], rollDie);
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
    const row = document.getElementById('npc-storage-row');
    const select = document.getElementById('npc-storage-select');
    if (!row || !select) return;

    const gmCampaigns = getGmCampaigns();
    if (!dataManager?.cloudStore || gmCampaigns.length === 0) {
        row.hidden = true;
        if (isCampaignStorage()) switchStorage(LOCAL_STORAGE_ID);
        storageOptionsSnapshot = '';
        return;
    }

    row.hidden = false;
    const snapshot = JSON.stringify(gmCampaigns.map(campaign => [campaign.id, campaign.name]));
    if (snapshot !== storageOptionsSnapshot && document.activeElement !== select) {
        storageOptionsSnapshot = snapshot;
        select.innerHTML = `<option value="${LOCAL_STORAGE_ID}">This browser</option>` + gmCampaigns.map(campaign =>
            `<option value="${escapeHtml(campaign.id)}">${escapeHtml(campaign.name)} (campaign)</option>`
        ).join('');
    }
    if (isCampaignStorage() && !gmCampaigns.some(campaign => campaign.id === storageId)) {
        switchStorage(LOCAL_STORAGE_ID);
        return;
    }
    select.value = storageId;

    const copyButton = document.getElementById('btn-npc-copy-local');
    if (copyButton) copyButton.hidden = !isCampaignStorage() || readLocalNpcs().length === 0;

    const note = document.getElementById('npc-storage-note');
    if (note) {
        if (storageError) {
            note.textContent = storageError;
        } else if (loading) {
            note.textContent = 'Loading campaign NPCs...';
        } else {
            note.textContent = isCampaignStorage()
                ? 'Campaign NPCs are shared with every GM of this campaign.'
                : 'Browser NPCs stay on this device.';
        }
    }
}

export function renderNpcs() {
    const summary = document.getElementById('npc-summary');
    const list = document.getElementById('npc-list');
    if (summary) {
        summary.textContent = npcs.length === 0
            ? 'No NPCs'
            : npcs.map(npc => `${npc.name} R${npc.rank}`).join(' · ');
    }
    if (list) {
        const empty = loading
            ? '<small>Loading campaign NPCs...</small>'
            : '<small>No NPCs yet. Fill the form above (Use Rank example gives the printed stat block).</small>';
        list.innerHTML = npcs.map(renderNpcCard).join('') || empty;
    }
    renderStorageControls();
    renderBudgetNote();
}

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

    document.getElementById('btn-npc-example')?.addEventListener('click', applyRankExample);
    document.getElementById('btn-npc-add')?.addEventListener('click', addNpcFromForm);
    document.getElementById('npc-add-form')?.addEventListener('input', renderBudgetNote);
    document.getElementById('npc-storage-select')?.addEventListener('change', (e) => {
        switchStorage(e.target.value);
    });
    document.getElementById('btn-npc-copy-local')?.addEventListener('click', copyLocalNpcsToCampaign);

    // Campaigns load after sign-in (and vanish on sign-out), so refresh the
    // storage selector whenever the cloud state changes.
    window.addEventListener('cloud-status-change', renderStorageControls);

    els.npcList?.addEventListener('click', (e) => {
        const control = e.target.closest('[data-action]');
        // Descriptor checkboxes and the blast-zone select act on 'change'.
        if (!control || ['descriptor', 'blast-zone'].includes(control.dataset.action)) return;
        handleNpcAction(control.dataset.npcId, control.dataset.action, {
            pool: control.dataset.pool,
            step: toInt(control.dataset.step),
            stat: control.dataset.stat
        });
    });

    els.npcList?.addEventListener('change', (e) => {
        const control = e.target.closest('[data-action]');
        if (!control) return;
        if (control.dataset.action === 'descriptor') {
            handleNpcAction(control.dataset.npcId, 'descriptor', { index: toInt(control.dataset.index) });
        } else if (control.dataset.action === 'blast-zone') {
            handleNpcAction(control.dataset.npcId, 'blast-zone', { zone: control.value });
        }
    });

    renderNpcs();
}
