// GM-side NPC tracker panel (v5.02 p.71). NPCs are independent of player
// characters: stored locally in this browser under their own key, not in
// character state or cloud saves.
import { els } from '../els.js';
import { escapeHtml } from '../pool.js';
import {
    NPC_RANK_EXAMPLES,
    getDescriptorDie,
    getNpcBudgets,
    normalizeNpc,
    normalizeNpcList,
    reviewNpcBuild,
    rollNpcAttack,
    rollNpcDefense,
    rollNpcStat
} from '../npc-rules.js';

const STORAGE_KEY = '1000words_npcs';

let poolEngine;
let npcs = [];

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

function loadNpcs() {
    try {
        npcs = normalizeNpcList(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '[]'));
    } catch {
        npcs = [];
    }
}

function saveNpcs() {
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(npcs));
    } catch (e) {
        console.error('Failed to save NPCs', e);
    }
}

function rollDie(die) {
    return poolEngine.rollDie(die);
}

function findNpc(id) {
    return npcs.find(npc => npc.id === id) || null;
}

function formatRolls(result) {
    return result.rolls.map(roll => `${roll.die}:${roll.val}`).join(' ');
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
        rxMax: document.getElementById('npc-rx')?.value
    };
    const review = reviewNpcBuild(draft);
    const poolText = `${review.poolTotal}/${review.budgets.resourcePoints} resource points`;
    const stepText = `${review.statSteps}/${review.budgets.statSteps} stat ▟`;
    note.textContent = `Budget: ${poolText}; ${stepText} (advisory).`;
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

    npcs.push(normalizeNpc({
        name,
        rank: document.getElementById('npc-rank')?.value,
        might: document.getElementById('npc-might')?.value,
        charm: document.getElementById('npc-charm')?.value,
        skill: document.getElementById('npc-skill')?.value,
        hpMax: document.getElementById('npc-hp')?.value,
        enMax: document.getElementById('npc-en')?.value,
        rxMax: document.getElementById('npc-rx')?.value,
        descriptors
    }));
    saveNpcs();
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
    } else if (action === 'pool') {
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
    }

    saveNpcs();
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

    const descriptors = npc.descriptors.map((descriptor, index) => `
        <label class="filter-toggle" title="Spend for a freebie ${getDescriptorDie(npc.rank)} (Rank ▟) on a check, or another edge">
            <input type="checkbox" data-npc-id="${npc.id}" data-action="descriptor" data-index="${index}"${descriptor.spent ? ' checked' : ''}>
            ${escapeHtml(descriptor.text)}
        </label>
    `).join('');

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

export function renderNpcs() {
    const summary = document.getElementById('npc-summary');
    const list = document.getElementById('npc-list');
    if (summary) {
        summary.textContent = npcs.length === 0
            ? 'No NPCs'
            : npcs.map(npc => `${npc.name} R${npc.rank}`).join(' · ');
    }
    if (list) {
        list.innerHTML = npcs.map(renderNpcCard).join('') || '<small>No NPCs yet. Fill the form above (Use Rank example gives the printed stat block).</small>';
    }
    renderBudgetNote();
}

export function init(deps) {
    poolEngine = deps.poolEngine;
    loadNpcs();

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

    els.npcList?.addEventListener('click', (e) => {
        const control = e.target.closest('[data-action]');
        if (!control || control.dataset.action === 'descriptor') return;
        handleNpcAction(control.dataset.npcId, control.dataset.action, {
            pool: control.dataset.pool,
            step: toInt(control.dataset.step),
            stat: control.dataset.stat
        });
    });

    els.npcList?.addEventListener('change', (e) => {
        const control = e.target.closest('[data-action="descriptor"]');
        if (!control) return;
        handleNpcAction(control.dataset.npcId, 'descriptor', { index: toInt(control.dataset.index) });
    });

    renderNpcs();
}
