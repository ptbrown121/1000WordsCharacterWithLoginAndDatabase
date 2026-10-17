// @ts-check
import { els } from '../els.js';

/** @typedef {{isSignedIn: boolean, campaigns: import('../types.js').CampaignSummary[]}} CampaignContext */
let pendingActions = 0;

/** @param {CampaignContext} manager */
export function getManagedCampaign(manager) {
    if (!manager?.isSignedIn) return null;
    return manager.campaigns.find(campaign => campaign.role === 'gm' && campaign.id === els.campaignManageSelect.value) || null;
}

export function isCampaignActionPending() {
    return pendingActions > 0;
}

// Keep a displayed destination stable until its reads or writes complete.
// Several panels load together, so each operation releases its own lock.
/** @param {CampaignContext} manager */
export function beginCampaignAction(manager) {
    pendingActions += 1;
    els.campaignManageSelect.disabled = true;
    return () => {
        pendingActions -= 1;
        els.campaignManageSelect.disabled = isCampaignActionPending() || !getManagedCampaign(manager);
    };
}
