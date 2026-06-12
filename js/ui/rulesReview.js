import { escapeHtml } from '../pool.js';
import { buildRulesReviewItems } from '../rules-review.js';
import { els } from '../els.js';

let dataManager;
let poolEngine;

export function init(deps) {
    dataManager = deps.dataManager;
    poolEngine = deps.poolEngine;

    els.toggleGmOverride.addEventListener('change', (e) => {
        dataManager.state.gmOverride = e.target.checked;
        dataManager.saveState();
        renderRulesReview();
    });
}

export function renderRulesReview() {
    if (!els.rulesReviewStrip) return;
    if (!dataManager || !poolEngine) return;

    const items = buildRulesReviewItems(dataManager.state, poolEngine);
    const gmOverride = Boolean(dataManager.state.gmOverride);
    els.toggleGmOverride.checked = gmOverride;

    if (items.length === 0) {
        els.rulesReviewStrip.hidden = true;
        els.rulesReviewStrip.innerHTML = '';
        return;
    }

    els.rulesReviewStrip.hidden = false;
    els.rulesReviewStrip.classList.toggle('rules-review-overridden', gmOverride);

    const severityCounts = items.reduce((counts, item) => {
        counts[item.severity] = (counts[item.severity] || 0) + 1;
        return counts;
    }, {});
    const countText = ['high', 'medium', 'low']
        .filter(key => severityCounts[key])
        .map(key => `${severityCounts[key]} ${key}`)
        .join(', ');

    const summary = gmOverride
        ? `GM reviewed: ${items.length} quiet note${items.length === 1 ? '' : 's'}`
        : `Rules assist: ${items.length} GM review note${items.length === 1 ? '' : 's'}${countText ? ` (${countText})` : ''}`;

    const itemHtml = items.slice(0, 8).map(item => `
        <li class="rules-review-item rules-review-${escapeHtml(item.severity)}">
            <span>${escapeHtml(item.category)}</span>
            ${escapeHtml(item.message)}
        </li>
    `).join('');
    const remaining = items.length > 8 ? `<li class="rules-review-item">+${items.length - 8} more notes</li>` : '';

    els.rulesReviewStrip.innerHTML = `
        <details>
            <summary>${escapeHtml(summary)}</summary>
            <ul>${itemHtml}${remaining}</ul>
        </details>
    `;
}
