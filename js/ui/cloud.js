import { els } from '../els.js';
import { SupabaseCharacterStore } from '../supabaseStore.js';

let dataManager;
let supabaseClient;
let renderAll;

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
        tiles.textContent = `Called: ${(log.calledTiles || []).map(tile => tile.name).filter(Boolean).join(', ') || 'No tiles'}`;

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
        'char-roster-select',
        'btn-export',
        'btn-info',
        'btn-auth-send-link',
        'btn-auth-sign-out',
        'auth-email',
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
            node.disabled = readOnly;
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

    if (els.authEmail) {
        els.authEmail.hidden = Boolean(dataManager.isSignedIn);
        els.authEmail.disabled = !supabaseClient;
    }
    if (els.btnAuthSendLink) {
        els.btnAuthSendLink.hidden = Boolean(dataManager.isSignedIn);
        els.btnAuthSendLink.disabled = !supabaseClient;
    }
    if (els.btnAuthSignOut) els.btnAuthSignOut.hidden = !dataManager.isSignedIn;
    if (els.cloudActions) els.cloudActions.hidden = !dataManager.isSignedIn;
    if (els.campaignPanel) els.campaignPanel.hidden = !dataManager.isSignedIn;
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

async function handleSession(session) {
    if (session?.user) {
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

export async function init(deps) {
    dataManager = deps.dataManager;
    supabaseClient = deps.supabaseClient;
    renderAll = deps.renderAll;

    if (!supabaseClient) {
        dataManager.setCloudStatus('local-only', 'Cloud save is not configured.');
        renderCloudControls();
        return;
    }

    dataManager.setCloudStatus('signed-out', 'Sign in to use cloud saves and campaigns.');

    els.authForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = els.authEmail.value.trim();
        if (!email) return;
        setBusy(els.btnAuthSendLink, true, 'Send magic link');
        try {
            const redirectTo = window.location.origin + window.location.pathname;
            const { error } = await supabaseClient.auth.signInWithOtp({
                email,
                options: { emailRedirectTo: redirectTo }
            });
            if (error) throw error;
            dataManager.setCloudStatus('link-sent', 'Magic link sent. Check your email.');
        } catch (err) {
            dataManager.setCloudStatus('error', err.message || 'Could not send magic link.');
        } finally {
            setBusy(els.btnAuthSendLink, false, 'Send magic link');
            renderCloudControls();
        }
    });

    els.btnAuthSignOut?.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
    });

    els.btnUploadLocal?.addEventListener('click', async () => {
        setBusy(els.btnUploadLocal, true, 'Upload local characters');
        try {
            await dataManager.uploadLocalCharacters();
            renderAll();
        } catch (err) {
            dataManager.setCloudStatus('error', err.message || 'Upload failed.');
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
            dataManager.setCloudStatus('error', err.message || 'Could not create campaign.');
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
            dataManager.setCloudStatus('error', err.message || 'Could not join campaign.');
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

    const { data } = await supabaseClient.auth.getSession();
    await handleSession(data.session);

    supabaseClient.auth.onAuthStateChange((_event, session) => {
        handleSession(session).catch(err => {
            dataManager.setCloudStatus('error', err.message || 'Cloud session failed.');
            renderCloudControls();
        });
    });
}
