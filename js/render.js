// @ts-check
import { getEffectiveMax } from './data.js';
import { els } from './els.js';
import { renderArmorSoak } from './ui/armorSoak.js';
import { renderCards } from './ui/cards.js';
import { updatePoolPreview } from './ui/pool.js';
import { renderOptionalStatsVisibility, renderStatsSummary, updateXpTracker } from './ui/stats.js';
import { renderTempBadge, updateShadowMax } from './ui/vitals.js';
import { renderCondition } from './ui/condition.js';
import { renderCore } from './ui/core.js';
import { renderTitan } from './ui/titan.js';
import { renderStranger } from './ui/stranger.js';
import { renderJournal } from './ui/journal.js';
import { renderRosterSelect } from './ui/roster.js';
import { renderRulesReview } from './ui/rulesReview.js';
import { renderCloudControls } from './ui/cloud.js';
import { renderAiCreation } from './ui/aiCreation.js';

/** @type {{state: import('./types.js').CharacterState}} */
let dataManager;

/** @param {{state: import('./types.js').CharacterState}} dm */
export function setDataManager(dm) {
    dataManager = dm;
}

export function renderAll() {
    els.charName.value = dataManager.state.name;
    els.valXpEarned.value = String(dataManager.state.xpEarned || 75);
    els.valStoryPointsSpent.value = String(dataManager.state.storyPointsSpent ?? 0);
    els.valStoryPointsEarned.value = String(dataManager.state.storyPointsEarned ?? dataManager.state.storyPoints ?? 0);
    els.valHp.value = String(dataManager.state.hp ?? 0);

    // Effective max = base max + perm + temp (see getEffectiveMax in data.js).
    els.valHpMax.innerText = String(getEffectiveMax(dataManager.state, 'hp'));
    els.valEn.value = String(dataManager.state.en ?? 0);
    els.valEnMax.innerText = String(getEffectiveMax(dataManager.state, 'en'));
    els.valRx.value = String(dataManager.state.rx ?? 0);
    els.valRxMax.innerText = String(getEffectiveMax(dataManager.state, 'rx'));
    els.valSh.value = String(dataManager.state.sh || 0);
    renderArmorSoak(dataManager.state.tiles || []);
    if (els.valAberration) els.valAberration.value = String(dataManager.state.aberration || 0);

    // Temp badges
    renderTempBadge(els.hpTempBadge, dataManager.state.hpTemp);
    renderTempBadge(els.enTempBadge, dataManager.state.enTemp);
    renderTempBadge(els.rxTempBadge, dataManager.state.rxTemp);
    renderTempBadge(els.shTempBadge, dataManager.state.shTemp);

    // Apply stat values; box border colors come from .stat-box[data-color]
    // rules in _layout.css.
    els.statSelects.forEach(sel => {
        sel.value = sel.dataset.stat ? dataManager.state.stats[sel.dataset.stat] || '' : '';
    });
    renderStatsSummary();

    renderOptionalStatsVisibility();
    renderCards();
    updatePoolPreview();
    updateXpTracker();
    updateShadowMax();
    renderCondition();
    renderCore();
    renderTitan();
    renderStranger();
    renderJournal();
    renderRosterSelect();
    renderRulesReview();
    renderCloudControls();
    renderAiCreation();
}
