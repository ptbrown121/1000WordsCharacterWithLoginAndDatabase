// @ts-check
// Live sync over Supabase Realtime (Postgres Changes, RLS-checked):
// - the active cloud character reloads when another tab/device saves it,
//   so a GM watching a player's read-only sheet sees combat as it happens;
// - the selected GM campaign's recent-rolls list refreshes on new rolls.
//
// Local edits are never clobbered: if a local save is queued or in flight
// when a remote write lands, this module stays out of the way and the
// optimistic-concurrency guard (data.js queueCloudSave) resolves it via
// the conflict dialog. Self-originated writes are recognized by comparing
// the row's updated_at with the stamp from our own last save/load.
import { els } from '../els.js';
import { shouldApplyRemoteCharacterUpdate } from '../data.js';

/** @type {import('../data.js').DataManager} */
let dataManager;
/** @type {import('@supabase/supabase-js').SupabaseClient<any>|null} */
let supabaseClient = null;
/** @type {() => void} */
let renderAll;

/** @type {import('@supabase/supabase-js').RealtimeChannel|null} */
let characterChannel = null;
/** @type {string|null} */
let subscribedCharId = null;
/** @type {import('@supabase/supabase-js').RealtimeChannel|null} */
let rollChannel = null;
/** @type {string|null} */
let subscribedCampaignId = null;
let reloadingCharacter = false;
/** @type {ReturnType<typeof setTimeout>|null} */
let rollRefreshTimer = null;

/** @param {import('@supabase/supabase-js').RealtimeChannel|null} channel */
function removeChannel(channel) {
    if (channel && supabaseClient) supabaseClient.removeChannel(channel);
}

/** @param {string} charId @param {{announce: boolean}} options */
async function reloadActiveCharacter(charId, { announce }) {
    if (reloadingCharacter) return;
    reloadingCharacter = true;
    try {
        if (!dataManager.cloudStore) return;
        const loaded = await dataManager.cloudStore.loadCharacter(charId);
        // Re-checked after the load: the user may have switched characters
        // or started editing while it was in flight.
        if (!dataManager.applyRemoteCloudCharacter(charId, loaded)) return;
        if (announce) dataManager.setCloudStatus('saved', 'Updated from another device.');
        renderAll();
    } catch (error) {
        console.error('Live sync reload failed', error);
    } finally {
        reloadingCharacter = false;
    }
}

/** @param {{new?: {id?: string, updated_at?: string|null}}} payload */
async function handleCharacterUpdate(payload) {
    const charId = payload?.new?.id;
    if (!charId || charId !== dataManager.activeCharId || dataManager.activeStorage !== 'cloud') return;

    const apply = shouldApplyRemoteCharacterUpdate({
        remoteUpdatedAt: payload?.new?.updated_at || null,
        ownUpdatedAt: dataManager.cloudUpdatedAt,
        savePending: Boolean(dataManager.pendingSaveTimer) || dataManager.hasCloudDraft(charId),
        saveInFlight: Boolean(dataManager.cloudSaveInFlight)
    });
    if (!apply) return;

    // Status stays untouched for read-only viewers (the GM watching a
    // player's sheet keeps the read-only banner and status).
    await reloadActiveCharacter(charId, { announce: dataManager.canEditActiveCharacter() });
}

// New rolls can arrive in bursts (a player resolving a turn); collapse
// them into one refresh.
function handleRollInsert() {
    const campaignId = subscribedCampaignId;
    if (!campaignId) return;
    clearTimeout(rollRefreshTimer ?? undefined);
    rollRefreshTimer = setTimeout(async () => {
        try {
            await dataManager.loadCampaignMembers(campaignId);
            // cloud.js re-renders the campaign panel on this event.
            window.dispatchEvent(new CustomEvent('cloud-status-change'));
        } catch (error) {
            console.error('Live sync roll refresh failed', error);
        }
    }, 400);
}

function syncCharacterSubscription() {
    if (!supabaseClient) return;
    const wanted = (dataManager.isSignedIn && dataManager.activeStorage === 'cloud' && !document.hidden)
        ? dataManager.activeCharId
        : null;
    if (wanted === subscribedCharId) return;

    removeChannel(characterChannel);
    characterChannel = null;
    subscribedCharId = wanted;
    if (!wanted) return;

    characterChannel = supabaseClient
        .channel(`live-character-${wanted}`)
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'characters',
            filter: `id=eq.${wanted}`
        }, handleCharacterUpdate)
        .subscribe();
}

function syncRollLogSubscription() {
    if (!supabaseClient) return;
    // campaign-manage-select only lists campaigns the user GMs.
    const wanted = (dataManager.isSignedIn && !document.hidden)
        ? (els.campaignManageSelect?.value || null)
        : null;
    if (wanted === subscribedCampaignId) return;

    removeChannel(rollChannel);
    rollChannel = null;
    subscribedCampaignId = wanted;
    if (!wanted) return;

    rollChannel = supabaseClient
        .channel(`live-rolls-${wanted}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'roll_logs',
            filter: `campaign_id=eq.${wanted}`
        }, handleRollInsert)
        .subscribe();
}

function syncSubscriptions() {
    syncCharacterSubscription();
    syncRollLogSubscription();
}

// After the tab was hidden, realtime events may have been missed; pull
// fresh state once instead of trusting the subscription gap.
async function catchUpAfterResume() {
    const charId = dataManager.activeStorage === 'cloud' ? dataManager.activeCharId : null;
    if (charId && dataManager.cloudStore) {
        try {
            const loaded = await dataManager.cloudStore.loadCharacter(charId);
            if (dataManager.applyRemoteCloudCharacter(charId, loaded)) renderAll();
        } catch (error) {
            console.error('Live sync resume reload failed', error);
        }
    }
    if (subscribedCampaignId) handleRollInsert();
}

/** @param {import('../types.js').AppDependencies} deps */
export function init(deps) {
    dataManager = deps.dataManager;
    supabaseClient = deps.supabaseClient;
    renderAll = deps.renderAll;
    if (!supabaseClient) return;

    // Fires on sign-in/out, saves, and character switches; the sync
    // functions no-op when the wanted subscription hasn't changed.
    window.addEventListener('cloud-status-change', syncSubscriptions);
    window.addEventListener('readonly-character-change', syncSubscriptions);
    els.campaignManageSelect?.addEventListener('change', syncSubscriptions);
    document.addEventListener('visibilitychange', () => {
        syncSubscriptions();
        if (!document.hidden) catchUpAfterResume();
    });

    // initCloud may have restored a session before this module could listen.
    syncSubscriptions();
}
