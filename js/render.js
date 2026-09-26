// @ts-check
import { els } from './els.js';
import { renderArmorSoak } from './ui/armorSoak.js';
import { renderCards } from './ui/cards.js';
import { updatePoolPreview } from './ui/pool.js';
import { renderOptionalStatsVisibility, renderStatsSummary, updateXpTracker } from './ui/stats.js';
import { renderResourcePools, renderTempBadge, updateShadowMax } from './ui/vitals.js';
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
    renderResourcePools();
    els.valSh.value = String(dataManager.state.sh || 0);
    renderArmorSoak(dataManager.state.tiles || []);
    if (els.valAberration) els.valAberration.value = String(dataManager.state.aberration || 0);

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
