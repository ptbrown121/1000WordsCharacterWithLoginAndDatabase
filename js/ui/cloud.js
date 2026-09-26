// @ts-check
import { els } from '../els.js';
import { SupabaseCharacterStore } from '../supabaseStore.js';
import { showConfirm } from './dialogService.js';

/** @type {import('../data.js').DataManager} */
let dataManager;
/** @type {import('@supabase/supabase-js').SupabaseClient<any>|null} */
let supabaseClient = null;
/** @type {() => void} */
let renderAll;

// Email a magic link was last sent to this page load. While set (and signed
// out), the code form is shown so the emailed OTP code can be typed in —
// for devices that can't open the link from their own inbox.
let pendingOtpEmail = '';

// Collapsed/expanded is a per-device UI preference, like the active tab.
const PANEL_COLLAPSED_KEY = '1000words_cloud_panel_collapsed';

function initPanelToggle() {
    if (!els.btnCloudToggle || !els.cloudPanelBody) return;
    /** @param {boolean} collapsed */
    const applyCollapsed = (collapsed) => {
        els.cloudPanelBody.hidden = collapsed;
        els.btnCloudToggle.setAttribute('aria-expanded', String(!collapsed));
        els.btnCloudToggle.textContent = collapsed ? 'Show' : 'Hide';
    };
    let collapsed = false;
    try {
        collapsed = globalThis.localStorage?.getItem(PANEL_COLLAPSED_KEY) === '1';
    } catch {
        // Storage can be unavailable (private mode); default to expanded.
    }
    applyCollapsed(collapsed);
    els.btnCloudToggle.addEventListener('click', () => {
        const next = !els.cloudPanelBody.hidden;
        applyCollapsed(next);
        try {
            globalThis.localStorage?.setItem(PANEL_COLLAPSED_KEY, next ? '1' : '0');
        } catch {
            // ignore; the toggle still works for this page load
        }
    });
}

/** @param {HTMLButtonElement|null|undefined} button @param {boolean} busy @param {string} [label] */
function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    if (label) button.textContent = busy ? 'Working...' : label;
}

function statusText() {
    if (!supabaseClient) return 'Cloud save is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel and local .env.';
    if (!dataManager.isSignedIn) return dataManager.cloudMessage || 'Sign in to use cloud saves and campaigns.';
    return dataManager.cloudMessage || 'Cloud save is ready.';
}

function renderCampaignOptions() {
    if (!els.characterCampaignSelect || !els.campaignManageSelect) return;

    const activeEntry = dataManager.activeRosterEntry;
    const canAssign = dataManager.isSignedIn && activeEntry?.source === 'cloud' && activeEntry.isMine;

    els.characterCampaignSelect.innerHTML = '<option value="">No campaign</option>';
    dataManager.campaigns.forEach(campaign => {
        const opt = document.createElement('option');
        opt.value = campaign.id;
        opt.textContent = `${campaign.name}${campaign.role === 'gm' ? ' (GM)' : ''}`;
        if (campaign.id === activeEntry?.campaignId) opt.selected = true;
        els.characterCampaignSelect.appendChild(opt);
    });
    els.characterCampaignSelect.disabled = !canAssign;

    const gmCampaigns = dataManager.campaigns.filter(campaign => campaign.role === 'gm');
    els.campaignManageSelect.innerHTML = '';
    if (gmCampaigns.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No GM campaigns';
        els.campaignManageSelect.appendChild(opt);
        els.campaignManageSelect.disabled = true;
        return;
    }

    gmCampaigns.forEach(campaign => {
        const opt = document.createElement('option');
        opt.value = campaign.id;
        opt.textContent = `${campaign.name} (${campaign.inviteCode})`;
        els.campaignManageSelect.appendChild(opt);
    });
    els.campaignManageSelect.disabled = false;
}

function renderCampaignMembers() {
    if (!els.campaignMemberList) return;
    els.campaignMemberList.innerHTML = '';
    if (!dataManager.isSignedIn || dataManager.campaignMembers.length === 0) {
        els.campaignMemberList.textContent = '';
        return;
    }

    dataManager.campaignMembers.forEach(member => {
        const row = document.createElement('div');
        row.className = 'campaign-member-row';

        const name = document.createElement('span');
        name.className = 'campaign-member-name';
        name.textContent = member.email || member.displayName || 'Player';

        const role = document.createElement('select');
        role.value = member.role;
        role.disabled = member.userId === dataManager.cloudUser?.id;
        ['player', 'gm'].forEach(value => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = value === 'gm' ? 'GM' : 'Player';
            if (value === member.role) opt.selected = true;
            role.appendChild(opt);
        });
        role.addEventListener('change', async () => {
            const campaignId = els.campaignManageSelect.value;
            await dataManager.setCampaignMemberRole(campaignId, member.userId, role.value);
            renderCloudControls();
        });

        row.append(name, role);
        els.campaignMemberList.appendChild(row);
    });
}

function renderRollLogs() {
    if (!els.rollLogList) return;
    els.rollLogList.innerHTML = '';
    if (!dataManager.isSignedIn || dataManager.rollLogs.length === 0) {
        return;
    }

    const heading = document.createElement('h3');
    heading.textContent = 'Recent campaign rolls';
    els.rollLogList.appendChild(heading);

    dataManager.rollLogs.forEach(log => {
        const row = document.createElement('div');
        row.className = 'roll-log-row';

        const main = document.createElement('div');
        main.className = 'roll-log-main';

        const name = document.createElement('strong');
        name.textContent = log.characterName || 'Unknown character';

        const meta = document.createElement('span');
        meta.className = 'roll-log-meta';
        const when = log.rolledAt ? new Date(log.rolledAt).toLocaleString() : '';
        meta.textContent = `${log.mode || 'roll'} · ${log.callColors?.join(', ') || 'No colors'}${log.haywire ? ' · Haywire' : ''}${when ? ` · ${when}` : ''}`;

        const tiles = document.createElement('span');
        tiles.className = 'roll-log-tiles';
        // Post-roll burns (p.24) get their own row, flagged per tile.
        tiles.textContent = `Called: ${(log.calledTiles || [])
            .map(tile => tile.name && tile.burnedAfterRoll ? `${tile.name} (burned after roll)` : tile.name)
            .filter(Boolean).join(', ') || 'No tiles'}`;

        const total = document.createElement('span');
        total.className = 'roll-log-total';
        total.textContent = `Total ${log.total}`;

        main.append(name, meta, tiles);
        row.append(main, total);
        els.rollLogList.appendChild(row);
    });
}

export function applyReadOnlyMode() {
    if (!dataManager) return;
    const readOnly = !dataManager.canEditActiveCharacter();
    document.body.classList.toggle('readonly-character', readOnly);
    if (els.readonlyBanner) els.readonlyBanner.hidden = !readOnly;

    const allowedIds = new Set([
        'btn-export',
        'btn-info',
        'btn-auth-send-link',
        'btn-auth-sign-out',
        'auth-email',
        'auth-code',
        'btn-auth-verify-code',
        'btn-upload-local',
        'campaign-name-input',
        'btn-create-campaign',
        'campaign-code-input',
        'btn-join-campaign',
        'character-campaign-select',
        'campaign-manage-select'
    ]);

    document.querySelectorAll('header input, header button, header select, main input, main button, main select, main textarea')
        .forEach(node => {
            if (allowedIds.has(node.id)) return;
            // Switching characters must always work, or a GM viewing a
            // read-only sheet couldn't get back to their own character.
            if (node.closest('#char-roster-list')) return;
            // The NPC tracker is GM-side and independent of the viewed
            // character; a GM browsing a player's read-only sheet still
            // needs to run their NPCs.
            if (node.closest('#npc-panel')) return;
            // Campaign management is campaign-level, not character-level.
            // Before the Campaign tab existed this markup sat outside
            // <main> and was never disabled; keep that behavior.
            if (node.closest('#campaign-section')) return;
            if (node instanceof HTMLInputElement || node instanceof HTMLButtonElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement) {
                node.disabled = readOnly;
            }
        });

    const importLabel = document.querySelector('label[for="file-import"]');
    if (importLabel) {
        importLabel.classList.toggle('readonly-disabled', readOnly);
        importLabel.setAttribute('aria-disabled', readOnly ? 'true' : 'false');
    }
}

export function renderCloudControls() {
    if (!dataManager) return;
    if (els.cloudModeLabel) {
        els.cloudModeLabel.textContent = dataManager.isSignedIn
            ? `Signed in as ${dataManager.cloudUser?.email || 'player'}`
            : 'Browser saves';
    }
    if (els.cloudStatusText) els.cloudStatusText.textContent = statusText();

    if (els.btnAuthGoogle) {
        els.btnAuthGoogle.hidden = Boolean(dataManager.isSignedIn);
        els.btnAuthGoogle.disabled = !supabaseClient;
    }
    if (els.authEmail) {
        els.authEmail.hidden = Boolean(dataManager.isSignedIn);
        els.authEmail.disabled = !supabaseClient;
    }
    if (els.btnAuthSendLink) {
        els.btnAuthSendLink.hidden = Boolean(dataManager.isSignedIn);
        els.btnAuthSendLink.disabled = !supabaseClient;
    }
    if (els.btnAuthSignOut) els.btnAuthSignOut.hidden = !dataManager.isSignedIn;
    if (els.authCodeForm) els.authCodeForm.hidden = Boolean(dataManager.isSignedIn) || !pendingOtpEmail;
    if (els.cloudActions) els.cloudActions.hidden = !dataManager.isSignedIn;
    if (els.campaignPanel) els.campaignPanel.hidden = !dataManager.isSignedIn;
    if (els.campaignSignedOutNote) els.campaignSignedOutNote.hidden = dataManager.isSignedIn;
    if (els.btnUploadLocal) els.btnUploadLocal.hidden = !dataManager.isSignedIn || !dataManager.hasLocalCharacters;
    if (els.campaignNameInput) els.campaignNameInput.hidden = !dataManager.isSignedIn || !dataManager.canCreateCampaign;
    if (els.btnCreateCampaign) els.btnCreateCampaign.hidden = !dataManager.isSignedIn || !dataManager.canCreateCampaign;

    renderCampaignOptions();
    renderCampaignMembers();
    renderRollLogs();
    applyReadOnlyMode();
}

async function loadSelectedCampaignMembers() {
    const campaignId = els.campaignManageSelect?.value;
    if (!campaignId) {
        dataManager.campaignMembers = [];
        renderCloudControls();
        return;
    }
    await dataManager.loadCampaignMembers(campaignId);
    renderCloudControls();
}

/** @param {import('@supabase/supabase-js').Session|null} session */
async function handleSession(session) {
    if (session?.user) {
        if (!supabaseClient) throw new Error('Cloud client is unavailable.');
        pendingOtpEmail = '';
        const store = new SupabaseCharacterStore(supabaseClient, session.user);
        await dataManager.connectCloud(store);
        renderAll();
        await loadSelectedCampaignMembers();
        return;
    }

    if (dataManager.cloudStore) {
        await dataManager.disconnectCloud();
    } else {
        dataManager.cloudUser = null;
        dataManager.setCloudStatus('signed-out', 'Sign in to use cloud saves and campaigns.');
    }
    renderAll();
}

/** @param {import('../types.js').AppDependencies} deps */
export async function init(deps) {
    dataManager = deps.dataManager;
    const client = deps.supabaseClient;
    supabaseClient = client;
    renderAll = deps.renderAll;

    initPanelToggle();

    if (!client) {
        dataManager.setCloudStatus('local-only', 'Cloud save is not configured.');
        renderCloudControls();
        return;
    }

    dataManager.setCloudStatus('signed-out', 'Sign in to use cloud saves and campaigns.');

    els.btnAuthGoogle?.addEventListener('click', async () => {
        setBusy(els.btnAuthGoogle, true, 'Sign in with Google');
        try {
            const redirectTo = window.location.origin + window.location.pathname;
            const { error } = await client.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo }
            });
            if (error) throw error;
            // On success the browser navigates to Google; the OAuth callback
            // is absorbed by detectSessionInUrl and lands in handleSession.
        } catch (err) {
            dataManager.setCloudStatus('error', err instanceof Error ? err.message : 'Google sign-in failed.');
            setBusy(els.btnAuthGoogle, false, 'Sign in with Google');
            renderCloudControls();
        }
    });

    els.authForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = els.authEmail.value.trim();
        if (!email) return;
        setBusy(els.btnAuthSendLink, true, 'Send magic link');
        try {
            const redirectTo = window.location.origin + window.location.pathname;
            const { error } = await client.auth.signInWithOtp({
                email,
                options: { emailRedirectTo: redirectTo }
            });
            if (error) throw error;
            pendingOtpEmail = email;
            dataManager.setCloudStatus('link-sent', 'Email sent. Click the link, or type the code from it below.');
        } catch (err) {
            dataManager.setCloudStatus('error', err instanceof Error ? err.message : 'Could not send magic link.');
        } finally {
            setBusy(els.btnAuthSendLink, false, 'Send magic link');
            renderCloudControls();
        }
    });

    // Reading the email on a different device than the one signing in (e.g.
    // the GM's phone inbox + desktop browser): the magic link only works
    // where it's clicked, but the OTP code in the same email works anywhere.
    els.authCodeForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = els.authCode.value.trim();
        if (!token || !pendingOtpEmail) return;
        setBusy(els.btnAuthVerifyCode, true, 'Sign in with code');
        try {
            const { error } = await client.auth.verifyOtp({
                email: pendingOtpEmail,
                token,
                type: 'email'
            });
            if (error) throw error;
            els.authCode.value = '';
            // Success lands in onAuthStateChange -> handleSession.
        } catch (err) {
            dataManager.setCloudStatus('error', err instanceof Error ? err.message : 'Code sign-in failed. Codes expire and are single-use; send a fresh email if needed.');
        } finally {
            setBusy(els.btnAuthVerifyCode, false, 'Sign in with code');
            renderCloudControls();
        }
    });

    els.btnAuthSignOut?.addEventListener('click', async () => {
        await client.auth.signOut();
    });

    els.btnUploadLocal?.addEventListener('click', async () => {
        setBusy(els.btnUploadLocal, true, 'Upload local characters');
        try {
            await dataManager.uploadLocalCharacters();
            renderAll();
        } catch (err) {
            dataManager.setCloudStatus('error', err instanceof Error ? err.message : 'Upload failed.');
        } finally {
            setBusy(els.btnUploadLocal, false, 'Upload local characters');
            renderCloudControls();
        }
    });

    els.btnCreateCampaign?.addEventListener('click', async () => {
        const name = els.campaignNameInput.value.trim();
        if (!name) return;
        setBusy(els.btnCreateCampaign, true, 'Create campaign');
        try {
            await dataManager.createCampaign(name);
            els.campaignNameInput.value = '';
            renderAll();
            await loadSelectedCampaignMembers();
        } catch (err) {
            dataManager.setCloudStatus('error', err instanceof Error ? err.message : 'Could not create campaign.');
        } finally {
            setBusy(els.btnCreateCampaign, false, 'Create campaign');
            renderCloudControls();
        }
    });

    els.btnJoinCampaign?.addEventListener('click', async () => {
        const code = els.campaignCodeInput.value.trim();
        if (!code) return;
        setBusy(els.btnJoinCampaign, true, 'Join campaign');
        try {
            await dataManager.joinCampaign(code);
            els.campaignCodeInput.value = '';
            renderAll();
        } catch (err) {
            dataManager.setCloudStatus('error', err instanceof Error ? err.message : 'Could not join campaign.');
        } finally {
            setBusy(els.btnJoinCampaign, false, 'Join campaign');
            renderCloudControls();
        }
    });

    els.characterCampaignSelect?.addEventListener('change', async () => {
        await dataManager.assignActiveCharacterToCampaign(els.characterCampaignSelect.value);
        renderAll();
    });

    els.campaignManageSelect?.addEventListener('change', loadSelectedCampaignMembers);

    window.addEventListener('cloud-status-change', renderCloudControls);
    window.addEventListener('readonly-character-change', renderCloudControls);

    // A guarded save found that another tab or device wrote this character
    // after we loaded it. The snapshot in the event lets "overwrite" work
    // even if the user has switched characters since the save was queued.
    window.addEventListener('cloud-save-conflict', async (event) => {
        const detail = event instanceof CustomEvent ? event.detail : null;
        const { charId, state, draftRevision } = detail || {};
        if (!charId) return;
        const reloadNewer = await showConfirm(
            'This character was changed in another tab or on another device since you loaded it.\n\n' +
            'Choose which copy to keep.',
            {
                title: 'Cloud save conflict',
                confirmLabel: 'Load cloud version',
                cancelLabel: 'Overwrite cloud',
                dismissValue: null
            }
        );
        if (reloadNewer === null) return;
        try {
            if (reloadNewer) {
                await dataManager.resolveCloudConflictByReloading(charId);
            } else {
                await dataManager.resolveCloudConflictByOverwriting(charId, state, draftRevision);
            }
            renderAll();
        } catch (err) {
            dataManager.setCloudStatus('error', err instanceof Error ? err.message : 'Could not resolve the save conflict.');
        }
        renderCloudControls();
    });

    const { data } = await client.auth.getSession();
    await handleSession(data.session);

    client.auth.onAuthStateChange((_event, session) => {
        handleSession(session).catch(err => {
            dataManager.setCloudStatus('error', err instanceof Error ? err.message : 'Cloud session failed.');
            renderCloudControls();
        });
    });
}
