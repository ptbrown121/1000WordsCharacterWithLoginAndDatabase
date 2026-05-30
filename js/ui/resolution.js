import { escapeHtml } from '../pool.js';
import { uiState } from '../state.js';
import { els } from '../els.js';
import {
    RESOLUTION_MODES,
    RESOLUTION_PLUS_BUCKETS,
    getRollId,
    getDefaultResolutionAssignments,
    getAssignmentOptions,
    getResolutionBonusTotals,
    calculateAssignedTotals,
    calculateResolutionPlusUsage,
    getHealingAssignments
} from '../resolution-rules.js';

let dataManager;
let renderAll;

export function init(deps = {}) {
    dataManager = deps.dataManager;
    renderAll = deps.renderAll;

    els.resolutionControls.addEventListener('change', (e) => {
        if (!uiState.lastRollResult) return;

        if (e.target.id === 'resolution-mode') {
            uiState.currentResolutionMode = e.target.value;
            uiState.currentResolutionAssignments = getDefaultResolutionAssignments(uiState.lastRollResult, uiState.currentResolutionMode);
            renderResolution();
            return;
        }

        if (e.target.classList.contains('resolution-die-select')) {
            uiState.currentResolutionAssignments[e.target.dataset.rollId] = e.target.value;
            renderResolution();
            return;
        }

        if (e.target.classList.contains('ammo-die-select')) {
            uiState.ammoAssignments[e.target.dataset.ammoTileId] = e.target.value;
            renderResolution();
            return;
        }

        if (e.target.id === 'healing-in-combat') {
            uiState.healingInCombat = e.target.checked;
            renderResolutionDetails();
            return;
        }

        if (e.target.classList.contains('resolution-extra')) {
            renderResolutionDetails();
        }
    });

    els.resolutionControls.addEventListener('input', (e) => {
        if (!uiState.lastRollResult || !e.target.classList.contains('resolution-extra')) return;
        renderResolutionDetails();
    });

    els.resolutionControls.addEventListener('click', (e) => {
        if (!e.target.classList.contains('btn-resolve-ammo')) return;
        resolveAmmo(e.target.dataset.ammoTileId);
    });
}

export function getResolutionExtraValue(id) {
    return document.getElementById(id)?.value ?? '';
}

export function getResolutionNumber(id) {
    const value = parseInt(getResolutionExtraValue(id), 10);
    return Number.isFinite(value) ? value : null;
}

export function getResolutionText(id) {
    return getResolutionExtraValue(id).trim();
}

export function renderResolutionUsageFields(result, usedCount, adds) {
    if (!RESOLUTION_PLUS_BUCKETS[uiState.currentResolutionMode]) {
        return `
            <div class="resolution-field">
                <label>Dice Used</label>
                <div class="${usedCount > adds ? 'resolution-warning' : 'resolution-success'}">${usedCount}/${adds}</div>
            </div>
        `;
    }

    const plusUsage = calculateResolutionPlusUsage(result, uiState.currentResolutionMode, uiState.currentResolutionAssignments);
    const diceTotal = (result.originalRolls || []).length;

    return `
        <div class="resolution-field">
            <label>Dice Assigned</label>
            <div class="resolution-success">${usedCount}/${diceTotal}</div>
        </div>
        <div class="resolution-field">
            <label>Pluses Used</label>
            <div class="${plusUsage.used > plusUsage.budget ? 'resolution-warning' : 'resolution-success'}">${plusUsage.used}/${plusUsage.budget}</div>
        </div>
    `;
}

export function renderResolutionModeOptions() {
    return Object.entries(RESOLUTION_MODES).map(([value, mode]) => {
        const selected = value === uiState.currentResolutionMode ? ' selected' : '';
        return `<option value="${value}"${selected}>${mode.label}</option>`;
    }).join('');
}

export function renderResolutionExtraFields() {
    if (uiState.currentResolutionMode === 'attack') {
        return `
            <div class="resolution-extra-grid">
                <div class="resolution-field">
                    <label for="target-evasion">Target Evasion</label>
                    <input id="target-evasion" class="resolution-extra" type="text" inputmode="numeric" value="${escapeHtml(getResolutionExtraValue('target-evasion'))}">
                </div>
                <div class="resolution-field">
                    <label for="target-soak">Target Soak</label>
                    <input id="target-soak" class="resolution-extra" type="text" inputmode="numeric" value="${escapeHtml(getResolutionExtraValue('target-soak'))}">
                </div>
                <div class="resolution-field">
                    <label for="target-grit">Target Grit</label>
                    <input id="target-grit" class="resolution-extra" type="text" inputmode="numeric" value="${escapeHtml(getResolutionExtraValue('target-grit'))}">
                </div>
                <div class="resolution-field">
                    <label for="attack-crits">Crit Tags</label>
                    <input id="attack-crits" class="resolution-extra" type="text" value="${escapeHtml(getResolutionExtraValue('attack-crits'))}" placeholder="e.g. JOLT, DOWN">
                </div>
            </div>
        `;
    }

    if (uiState.currentResolutionMode === 'defense') {
        return `
            <div class="resolution-extra-grid">
                <div class="resolution-field">
                    <label for="incoming-attack">Incoming Attack</label>
                    <input id="incoming-attack" class="resolution-extra" type="text" inputmode="numeric" value="${escapeHtml(getResolutionExtraValue('incoming-attack'))}">
                </div>
                <div class="resolution-field">
                    <label for="incoming-impact">Incoming Impact</label>
                    <input id="incoming-impact" class="resolution-extra" type="text" inputmode="numeric" value="${escapeHtml(getResolutionExtraValue('incoming-impact'))}">
                </div>
                <div class="resolution-field">
                    <label for="defense-soak">Other Soak</label>
                    <input id="defense-soak" class="resolution-extra" type="text" inputmode="numeric" value="${escapeHtml(getResolutionExtraValue('defense-soak'))}">
                </div>
                <div class="resolution-field">
                    <label for="incoming-crits">Incoming Crit Tags</label>
                    <input id="incoming-crits" class="resolution-extra" type="text" value="${escapeHtml(getResolutionExtraValue('incoming-crits'))}" placeholder="e.g. BLEED, DOWN">
                </div>
            </div>
        `;
    }

    if (uiState.currentResolutionMode === 'healing') {
        return `
            <div class="resolution-extra-grid">
                <label class="resolution-field" style="justify-content: end;">
                    <span>During Combat</span>
                    <input id="healing-in-combat" type="checkbox"${uiState.healingInCombat ? ' checked' : ''}>
                </label>
            </div>
        `;
    }

    return '';
}

export function renderResolutionAssignments(result) {
    const options = getAssignmentOptions(uiState.currentResolutionMode);
    const validValues = new Set(options.map(option => option.value));

    return (result.originalRolls || []).map((roll, index) => {
        const rollId = getRollId(roll, index);
        const assignment = validValues.has(uiState.currentResolutionAssignments[rollId])
            ? uiState.currentResolutionAssignments[rollId]
            : 'unused';
        const optionHtml = options.map(option => {
            const selected = option.value === assignment ? ' selected' : '';
            return `<option value="${option.value}"${selected}>${option.label}</option>`;
        }).join('');

        return `
            <div class="resolution-die-row">
                <span class="resolution-die-main">
                    <span class="resolution-die-badge" title="${escapeHtml(roll.die)} rolled ${roll.val}">
                        <span class="resolution-die-type">${escapeHtml(roll.die)}</span>
                        <span class="resolution-die-label">rolled</span>
                        <span class="resolution-die-roll">${roll.val}</span>
                    </span>
                    <span class="resolution-die-source">${escapeHtml(roll.source)}</span>
                </span>
                <select class="resolution-die-select" data-roll-id="${rollId}">
                    ${optionHtml}
                </select>
            </div>
        `;
    }).join('');
}

function getRollOptions(result, selectedId = '') {
    const empty = '<option value="">-- Assign die --</option>';
    const options = (result.originalRolls || []).map((roll, index) => {
        const rollId = getRollId(roll, index);
        const selected = rollId === selectedId ? ' selected' : '';
        return `<option value="${escapeHtml(rollId)}"${selected}>${escapeHtml(roll.source)} ${escapeHtml(roll.die)} rolled ${escapeHtml(roll.val)}</option>`;
    }).join('');
    return empty + options;
}

export function renderAmmoResolution(result) {
    const options = result.ammoOptions || [];
    if (options.length === 0) return '';

    const rows = options.map(option => {
        const selected = uiState.ammoAssignments[option.tileId] || '';
        const roll = (result.originalRolls || []).find((candidate, index) => getRollId(candidate, index) === selected);
        const status = roll
            ? (roll.val >= option.supply ? 'Retains on resolve' : 'Runs out on resolve')
            : (option.linked ? `Supply ${option.supply}` : `Unlinked · Supply ${option.supply}`);
        return `
            <div class="ammo-resolution-row">
                <span class="ammo-resolution-main">
                    <strong>${escapeHtml(option.name)}</strong>
                    <small>${escapeHtml(option.targetName || 'GM target')} · ${escapeHtml(option.currentSupply)}/${escapeHtml(option.supply)}</small>
                </span>
                <select class="ammo-die-select" data-ammo-tile-id="${escapeHtml(option.tileId)}">
                    ${getRollOptions(result, selected)}
                </select>
                <button class="btn-resolve-ammo" type="button" data-ammo-tile-id="${escapeHtml(option.tileId)}"${selected ? '' : ' disabled'}>Resolve</button>
                <span class="ammo-resolution-status">${escapeHtml(status)}</span>
            </div>
        `;
    }).join('');

    return `
        <div class="ammo-resolution-panel">
            <h3>Ammo Resolution</h3>
            <p class="hint-text">Assign a spare die to ammo. If the die is below Supply, the ammo is buried/runs out.</p>
            ${rows}
        </div>
    `;
}

function resolveAmmo(tileId) {
    if (!dataManager || !uiState.lastRollResult) return;
    const selectedRollId = uiState.ammoAssignments[tileId];
    const roll = (uiState.lastRollResult.originalRolls || [])
        .find((candidate, index) => getRollId(candidate, index) === selectedRollId);
    const tile = (dataManager.state.tiles || []).find(candidate => candidate.id === tileId);
    if (!roll || !tile?.ammo) return;

    const supply = Math.max(1, parseInt(tile.ammo.maxSupply, 10) || 1);
    const retained = roll.val >= supply;
    tile.ammo.currentSupply = Math.max(0, (parseInt(tile.ammo.currentSupply, 10) || 0) - 1);
    if (!retained) {
        tile.isBuried = true;
        tile.isBurnt = false;
        tile.ammo.currentSupply = 0;
    }

    dataManager.updateTile(tile);
    uiState.lastRollResult.ammoOptions = (uiState.lastRollResult.ammoOptions || [])
        .filter(option => option.tileId !== tileId);
    delete uiState.ammoAssignments[tileId];
    if (renderAll) renderAll();
    renderResolution();
}

export function renderBonusDetails(details) {
    if (!details.length) return '';
    return `<p><strong>Tag Bonuses:</strong><br>${details.map(detail => escapeHtml(detail)).join('<br>')}</p>`;
}

export function calculateResolutionSummary(result) {
    const { totals, usedCount } = calculateAssignedTotals(result, uiState.currentResolutionAssignments);
    const bonusInfo = getResolutionBonusTotals(result, uiState.currentResolutionMode);
    const bonuses = bonusInfo.totals;
    const adds = result.adds ?? 2;
    const warnings = [];
    const plusUsage = RESOLUTION_PLUS_BUCKETS[uiState.currentResolutionMode]
        ? calculateResolutionPlusUsage(result, uiState.currentResolutionMode, uiState.currentResolutionAssignments)
        : null;
    const plusesAreLegal = !plusUsage || plusUsage.used <= plusUsage.budget;

    if (plusUsage && !plusesAreLegal) {
        if (uiState.currentResolutionMode === 'healing') {
            warnings.push(`Too many pluses used: ${plusUsage.used}/${plusUsage.budget}. Move dice out of combined diagnosis/resource totals or assign them to one-at-a-time healing options.`);
        } else {
            warnings.push(`Too many pluses used: ${plusUsage.used}/${plusUsage.budget}. Split dice across ${uiState.currentResolutionMode === 'attack' ? 'Attack/Impact' : 'Evasion/Grit'} differently or move dice to Unused.`);
        }
    } else if (!plusUsage && usedCount > adds) {
        warnings.push(`Too many dice assigned: ${usedCount}/${adds}. Move ${usedCount - adds} die${usedCount - adds === 1 ? '' : 's'} to Unused.`);
    }

    if (uiState.currentResolutionMode === 'attack') {
        const attackTotal = (totals.attack || 0) + bonuses.attack;
        const impactTotal = (totals.impact || 0) + bonuses.impact;
        const targetEvasion = getResolutionNumber('target-evasion');
        const targetSoak = getResolutionNumber('target-soak') || 0;
        const targetGrit = getResolutionNumber('target-grit') || 0;
        const crits = getResolutionText('attack-crits');
        const lines = [
            `<p><strong>Attack:</strong> ${attackTotal} (${totals.attack || 0} dice + ${bonuses.attack} bonus)</p>`,
            `<p><strong>Impact:</strong> ${impactTotal} HP (${totals.impact || 0} dice + ${bonuses.impact} bonus)</p>`,
            `<p><strong>Pluses Used:</strong> ${plusUsage.used}/${plusUsage.budget}</p>`
        ];

        if (!plusesAreLegal) {
            lines.push('<p class="resolution-warning">Reduce plus use before resolving attack.</p>');
        } else if (targetEvasion !== null) {
            const hit = attackTotal >= targetEvasion;
            lines.push(`<p class="${hit ? 'resolution-success' : 'resolution-warning'}">${hit ? 'Hit' : 'Miss'} vs target evasion ${targetEvasion}.</p>`);

            if (hit) {
                const hpLoss = Math.max(0, impactTotal - targetSoak);
                const critsApply = crits && hpLoss > targetGrit;
                lines.push(`<p><strong>After Soak:</strong> ${hpLoss} HP (${impactTotal} impact - ${targetSoak} soak).</p>`);
                lines.push(`<p><strong>Grit Check:</strong> ${targetGrit} grit ${hpLoss > targetGrit ? 'does not prevent crits' : 'prevents crits'}.</p>`);
                if (crits) lines.push(`<p><strong>Crits:</strong> ${escapeHtml(crits)} ${critsApply ? 'apply' : 'do not apply'}.</p>`);
            }
        }

        return {
            headline: `Attack ${attackTotal} / Impact ${impactTotal}`,
            html: lines.join('') + renderBonusDetails(bonusInfo.details),
            warnings
        };
    }

    if (uiState.currentResolutionMode === 'defense') {
        const evasionTotal = (totals.evasion || 0) + bonuses.evasion;
        const gritTotal = (totals.grit || 0) + bonuses.grit;
        const otherSoak = getResolutionNumber('defense-soak') || 0;
        const soakTotal = otherSoak + bonuses.soak;
        const incomingAttack = getResolutionNumber('incoming-attack');
        const incomingImpact = getResolutionNumber('incoming-impact') || 0;
        const incomingCrits = getResolutionText('incoming-crits');
        const lines = [
            `<p><strong>Evasion:</strong> ${evasionTotal} (${totals.evasion || 0} dice + ${bonuses.evasion} bonus)</p>`,
            `<p><strong>Grit:</strong> ${gritTotal} (${totals.grit || 0} dice + ${bonuses.grit} bonus)</p>`,
            `<p><strong>Soak:</strong> ${soakTotal} (${otherSoak} other + ${bonuses.soak} bonus)</p>`,
            `<p><strong>Pluses Used:</strong> ${plusUsage.used}/${plusUsage.budget}</p>`
        ];

        if (!plusesAreLegal) {
            lines.push('<p class="resolution-warning">Reduce plus use before resolving defense.</p>');
        } else if (incomingAttack !== null) {
            const missed = evasionTotal > incomingAttack;
            lines.push(`<p class="${missed ? 'resolution-success' : 'resolution-warning'}">${missed ? 'Attack misses' : 'Attack hits'} vs incoming attack ${incomingAttack}.</p>`);

            if (!missed) {
                const hpLoss = Math.max(0, incomingImpact - soakTotal);
                const critsApply = incomingCrits && hpLoss > gritTotal;
                lines.push(`<p><strong>After Soak:</strong> ${hpLoss} HP (${incomingImpact} impact - ${soakTotal} soak).</p>`);
                lines.push(`<p><strong>Grit Check:</strong> ${gritTotal} grit ${hpLoss > gritTotal ? 'does not prevent crits' : 'prevents crits'}.</p>`);
                if (incomingCrits) lines.push(`<p><strong>Crits:</strong> ${escapeHtml(incomingCrits)} ${critsApply ? 'apply' : 'do not apply'}.</p>`);
            }
        }

        return {
            headline: `Evasion ${evasionTotal} / Grit ${gritTotal}`,
            html: lines.join('') + renderBonusDetails(bonusInfo.details),
            warnings
        };
    }

    if (uiState.currentResolutionMode === 'healing') {
        const diagnosisTotal = (totals.diagnosis || 0) + bonuses.diagnosis;
        const healingAssignments = getHealingAssignments(result, uiState.currentResolutionAssignments);
        const healingEntries = Object.values(healingAssignments);
        const spareCount = healingEntries.reduce((sum, entry) => sum + entry.count, 0);
        const baseDifficulty = healingEntries.reduce((max, entry) => Math.max(max, entry.difficulty), 0);
        const difficulty = baseDifficulty + (spareCount * 2) + (uiState.healingInCombat ? 4 : 0);
        const succeeds = plusesAreLegal && spareCount > 0 && diagnosisTotal >= difficulty;
        const lines = [
            `<p><strong>Diagnosis:</strong> ${diagnosisTotal} (${totals.diagnosis || 0} dice + ${bonuses.diagnosis} bonus)</p>`,
            `<p><strong>Pluses Used:</strong> ${plusUsage.used}/${plusUsage.budget}</p>`
        ];

        if (spareCount === 0) {
            lines.push('<p>No treatment dice assigned.</p>');
        } else if (!plusesAreLegal) {
            lines.push('<p class="resolution-warning">Reduce plus use before resolving treatment.</p>');
        } else {
            lines.push(`<p><strong>Difficulty:</strong> ${difficulty} (${baseDifficulty} base + ${spareCount * 2} from ${spareCount} treatment dice${uiState.healingInCombat ? ' + 4 combat' : ''}).</p>`);
            lines.push(`<p class="${succeeds ? 'resolution-success' : 'resolution-warning'}">${succeeds ? 'Treatment succeeds' : 'Treatment fails'}.</p>`);
            healingEntries.forEach(entry => {
                if (entry.kind === 'resource') {
                    lines.push(`<p><strong>${entry.label}:</strong> restore ${entry.amount} if successful.</p>`);
                } else {
                    lines.push(`<p><strong>${entry.label}:</strong> restore/reduce ${entry.count} if successful.</p>`);
                }
            });
        }

        return {
            headline: `Diagnosis ${diagnosisTotal}`,
            html: lines.join('') + renderBonusDetails(bonusInfo.details),
            warnings
        };
    }

    const actionTotal = (totals.action || 0) + bonuses.action;
    return {
        headline: String(actionTotal),
        html: `<p><strong>Action Total:</strong> ${actionTotal} (${totals.action || 0} dice + ${bonuses.action} bonus)</p>${renderBonusDetails(bonusInfo.details)}`,
        warnings
    };
}

export function renderRollGroups(result) {
    const groups = {};
    (result.originalRolls || []).forEach(r => {
        if (!groups[r.source]) groups[r.source] = [];
        groups[r.source].push(`<strong>${escapeHtml(r.die)}:</strong> ${r.val}`);
    });

    return Object.entries(groups).map(([source, rolls]) => {
        return `<div style="margin-top: 4px; padding-left: 10px; border-left: 2px solid var(--glass-border);"><em>${escapeHtml(source)}</em>: ${rolls.join(' | ')}</div>`;
    }).join('');
}

export function renderResolutionDetails() {
    if (!uiState.lastRollResult) return;

    const result = uiState.lastRollResult;
    const summary = calculateResolutionSummary(result);
    const notices = [];
    if (result.isTestRoll) {
        notices.push('<div class="result-notice">TEST ROLL: this roll was not saved to campaign history.</div>');
    }
    if (result.isHaywire) {
        notices.push('<div class="result-notice result-notice-haywire">HAYWIRE! More than half the dice rolled 1.</div>');
    }
    els.resultNotices.innerHTML = notices.join('');

    els.resultTotal.innerText = summary.headline;
    els.resultDetails.innerHTML = `
        <div style="margin-bottom: 0.5rem; color: #a0aab5;">
            <p style="margin: 0; text-decoration: underline;">All Rolls by Source:</p>
            ${renderRollGroups(result)}
        </div>
        <div class="resolution-summary">
            ${summary.html}
        </div>
    `;
}

export function renderResolution() {
    if (!uiState.lastRollResult) return;

    const result = uiState.lastRollResult;
    const { usedCount } = calculateAssignedTotals(result, uiState.currentResolutionAssignments);
    const adds = result.adds ?? 2;
    const summary = calculateResolutionSummary(result);
    const warningHtml = summary.warnings.map(warning => `<p class="resolution-warning">${escapeHtml(warning)}</p>`).join('');

    els.resolutionControls.innerHTML = `
        <div class="resolution-toolbar">
            <div class="resolution-field">
                <label for="resolution-mode">Resolution</label>
                <select id="resolution-mode">${renderResolutionModeOptions()}</select>
            </div>
            ${renderResolutionUsageFields(result, usedCount, adds)}
        </div>
        ${renderResolutionExtraFields()}
        <div class="resolution-assignments">
            <label>Assign Rolled Dice</label>
            ${renderResolutionAssignments(result)}
        </div>
        ${renderAmmoResolution(result)}
        ${warningHtml}
    `;

    renderResolutionDetails();
}

export function showResults(result) {
    uiState.lastRollResult = result;
    uiState.currentResolutionMode = 'action';
    uiState.currentResolutionAssignments = getDefaultResolutionAssignments(result, uiState.currentResolutionMode);
    uiState.ammoAssignments = {};
    uiState.healingInCombat = false;
    els.rollResults.style.display = 'block';
    renderResolution();
    
    setTimeout(() => {
        const dash = document.getElementById('action-dashboard');
        if (dash && window.getComputedStyle(dash).overflowY === 'auto') {
            dash.scrollTo({ top: dash.scrollHeight, behavior: 'smooth' });
        } else {
            els.rollResults.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, 50);
}
