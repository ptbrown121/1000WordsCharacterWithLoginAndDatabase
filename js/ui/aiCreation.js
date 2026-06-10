import { els } from '../els.js';
import { renderJournal } from './journal.js';

let dataManager;
let supabaseClient;

const aiState = {
    activeCharacterId: null,
    activeBundle: null,
    loadingThread: false,
    busyThread: false,
    threadStatus: '',
    docsCampaignId: null,
    documents: [],
    settings: null,
    loadingDocs: false,
    docsStatus: ''
};

function activeCampaignEntry() {
    const entry = dataManager?.activeRosterEntry;
    if (!dataManager?.isSignedIn || entry?.source !== 'cloud' || !entry.campaignId) return null;
    return entry;
}

function selectedGmCampaignId() {
    return els.campaignManageSelect && !els.campaignManageSelect.disabled ? els.campaignManageSelect.value : '';
}

async function apiFetch(path, options = {}) {
    if (!supabaseClient) throw new Error('Cloud sign-in is required.');
    const { data } = await supabaseClient.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error('Sign in again to use campaign AI.');

    const response = await fetch(path, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Campaign AI request failed.');
    return payload;
}

function setThreadStatus(message) {
    aiState.threadStatus = message;
    if (els.aiCreationStatus) els.aiCreationStatus.textContent = message;
}

function setDocsStatus(message) {
    aiState.docsStatus = message;
    if (els.campaignAiDocsStatus) els.campaignAiDocsStatus.textContent = message;
}

function applyBundle(bundle) {
    aiState.activeBundle = bundle || null;
    renderAiCreation();
}

function isClosedThread(thread = aiState.activeBundle?.thread) {
    return ['completed', 'cancelled'].includes(thread?.status);
}

function statusForBundle(bundle) {
    const status = bundle?.thread?.status;
    if (!bundle) return 'Start a guided creation chat for this campaign character.';
    if (status === 'cancelled') return 'Previous scene was cancelled. Start a new guided scene when ready.';
    if (status === 'completed') return 'Previous scene was accepted. Start a new guided scene when ready.';
    if (status === 'summary_pending') return 'A scene summary is ready for review.';
    if (status === 'ready_for_summary') return 'This scene is ready to summarize, or you can keep chatting.';
    return 'Continue guided character creation.';
}

async function loadActiveThread(characterId) {
    if (!characterId || aiState.loadingThread) return;
    aiState.loadingThread = true;
    renderAiCreation();
    try {
        const payload = await apiFetch(`/api/ai/threads?characterId=${encodeURIComponent(characterId)}`);
        applyBundle(payload.bundle);
        setThreadStatus(statusForBundle(payload.bundle));
    } catch (error) {
        applyBundle(null);
        setThreadStatus(error.message);
    } finally {
        aiState.loadingThread = false;
        renderAiCreation();
    }
}

function maybeLoadActiveThread() {
    const entry = activeCampaignEntry();
    const characterId = entry?.id || null;
    if (characterId === aiState.activeCharacterId) return;

    aiState.activeCharacterId = characterId;
    aiState.activeBundle = null;
    aiState.threadStatus = '';
    if (characterId) loadActiveThread(characterId);
}

async function startThread() {
    const entry = activeCampaignEntry();
    if (!entry || aiState.busyThread) return;
    aiState.busyThread = true;
    setThreadStatus('Starting AI creation chat...');
    renderAiCreation();
    try {
        const payload = await apiFetch('/api/ai/threads', {
            method: 'POST',
            body: JSON.stringify({ characterId: entry.id, campaignId: entry.campaignId })
        });
        applyBundle(payload.bundle);
        setThreadStatus('AI creation chat is ready.');
    } catch (error) {
        setThreadStatus(error.message);
    } finally {
        aiState.busyThread = false;
        renderAiCreation();
    }
}

async function sendMessage(event) {
    event.preventDefault();
    if (aiState.busyThread || !aiState.activeBundle?.thread) return;
    const message = els.aiCreationInput.value.trim();
    if (!message) return;
    aiState.busyThread = true;
    els.aiCreationInput.value = '';
    setThreadStatus('Thinking through the scene...');
    renderAiCreation();
    try {
        const payload = await apiFetch('/api/ai/messages', {
            method: 'POST',
            body: JSON.stringify({ threadId: aiState.activeBundle.thread.id, message })
        });
        applyBundle(payload.bundle);
        setThreadStatus('Scene chat updated.');
    } catch (error) {
        setThreadStatus(error.message);
    } finally {
        aiState.busyThread = false;
        renderAiCreation();
    }
}

async function finalizeScene() {
    if (aiState.busyThread || !aiState.activeBundle?.thread || isClosedThread()) return;
    aiState.busyThread = true;
    setThreadStatus('Orchestrator and validator are drafting the scene summary...');
    renderAiCreation();
    try {
        const payload = await apiFetch('/api/ai/finalize-scene', {
            method: 'POST',
            body: JSON.stringify({ threadId: aiState.activeBundle.thread.id })
        });
        applyBundle(payload.bundle);
        setThreadStatus('Scene summary is ready for review.');
    } catch (error) {
        setThreadStatus(error.message);
    } finally {
        aiState.busyThread = false;
        renderAiCreation();
    }
}

async function cancelScene() {
    if (aiState.busyThread || !aiState.activeBundle?.thread || isClosedThread()) return;
    if (!confirm('Cancel this AI scene? The chat will stay visible for reference, but it will not be finalized or saved to the journal.')) return;
    aiState.busyThread = true;
    setThreadStatus('Cancelling this scene...');
    renderAiCreation();
    try {
        const payload = await apiFetch('/api/ai/cancel-scene', {
            method: 'POST',
            body: JSON.stringify({ threadId: aiState.activeBundle.thread.id })
        });
        applyBundle(payload.bundle);
        setThreadStatus('Scene cancelled. You can start a new guided scene.');
    } catch (error) {
        setThreadStatus(error.message);
    } finally {
        aiState.busyThread = false;
        renderAiCreation();
    }
}

async function acceptSummary(summaryId) {
    if (aiState.busyThread) return;
    aiState.busyThread = true;
    setThreadStatus('Saving accepted scene to the character journal...');
    renderAiCreation();
    try {
        // Push any debounced local edits first so the server appends the journal
        // entry onto current state instead of a stale snapshot, and a pending
        // autosave can no longer fire afterwards and wipe the new entry.
        await dataManager.flushCloudSave();
        const payload = await apiFetch('/api/ai/accept-summary', {
            method: 'POST',
            body: JSON.stringify({ summaryId, appendToJournal: true })
        });
        if (payload.characterState && payload.bundle?.thread?.character_id === dataManager.activeCharId) {
            if (dataManager.mergeServerJournalEntries(payload.characterState)) renderJournal();
        }
        applyBundle(payload.bundle);
        setThreadStatus('Scene accepted and saved.');
    } catch (error) {
        setThreadStatus(error.message);
    } finally {
        aiState.busyThread = false;
        renderAiCreation();
    }
}

async function editMessage(message) {
    if (aiState.busyThread || !message?.id || isClosedThread()) return;
    const edited = prompt('Edit your response:', message.content || '');
    if (edited === null) return;
    const content = edited.trim();
    if (!content || content === message.content) return;

    aiState.busyThread = true;
    setThreadStatus('Rewinding the scene from your edited response...');
    renderAiCreation();
    try {
        const payload = await apiFetch('/api/ai/edit-message', {
            method: 'POST',
            body: JSON.stringify({ messageId: message.id, content })
        });
        applyBundle(payload.bundle);
        setThreadStatus('Response edited and scene chat regenerated.');
    } catch (error) {
        setThreadStatus(error.message);
    } finally {
        aiState.busyThread = false;
        renderAiCreation();
    }
}

async function loadCampaignAiDocs(campaignId) {
    if (!campaignId || aiState.loadingDocs) return;
    aiState.loadingDocs = true;
    renderCampaignAiDocs();
    try {
        const [docsPayload, settingsPayload] = await Promise.all([
            apiFetch(`/api/ai/campaign-documents?campaignId=${encodeURIComponent(campaignId)}`),
            apiFetch(`/api/ai/campaign-settings?campaignId=${encodeURIComponent(campaignId)}`)
        ]);
        aiState.documents = docsPayload.documents || [];
        aiState.settings = settingsPayload.settings || null;
        setDocsStatus('AI guidance loaded.');
    } catch (error) {
        aiState.documents = [];
        aiState.settings = null;
        setDocsStatus(error.message);
    } finally {
        aiState.loadingDocs = false;
        renderCampaignAiDocs();
    }
}

function maybeLoadCampaignAiDocs() {
    const campaignId = selectedGmCampaignId();
    if (campaignId === aiState.docsCampaignId) return;
    aiState.docsCampaignId = campaignId || null;
    aiState.documents = [];
    aiState.settings = null;
    aiState.docsStatus = '';
    if (campaignId && dataManager?.isSignedIn) loadCampaignAiDocs(campaignId);
}

async function saveCampaignAiSettings() {
    const campaignId = selectedGmCampaignId();
    if (!campaignId || aiState.loadingDocs) return;
    aiState.loadingDocs = true;
    setDocsStatus('Saving AI guidance...');
    renderCampaignAiDocs();
    try {
        const payload = await apiFetch('/api/ai/campaign-settings', {
            method: 'POST',
            body: JSON.stringify({
                campaignId,
                scenarioSeed: els.campaignAiScenarioSeed.value,
                gmInstructions: els.campaignAiGmInstructions.value
            })
        });
        aiState.settings = payload.settings;
        setDocsStatus('AI guidance saved.');
    } catch (error) {
        setDocsStatus(error.message);
    } finally {
        aiState.loadingDocs = false;
        renderCampaignAiDocs();
    }
}

async function uploadCampaignAiDoc() {
    const campaignId = selectedGmCampaignId();
    if (!campaignId || aiState.loadingDocs) return;
    aiState.loadingDocs = true;
    setDocsStatus('Saving campaign note...');
    renderCampaignAiDocs();
    try {
        const file = els.campaignAiDocFile.files?.[0] || null;
        const fileText = file ? await file.text() : '';
        const content = fileText || els.campaignAiDocText.value.trim();
        const title = els.campaignAiDocTitle.value.trim() || file?.name || 'Campaign note';
        const payload = await apiFetch('/api/ai/campaign-documents', {
            method: 'POST',
            body: JSON.stringify({
                campaignId,
                title,
                fileName: file?.name || `${title}.txt`,
                content,
                source: file ? 'text-file' : 'pasted-text'
            })
        });
        aiState.documents = [payload.document, ...aiState.documents];
        els.campaignAiDocTitle.value = '';
        els.campaignAiDocText.value = '';
        els.campaignAiDocFile.value = '';
        setDocsStatus('Campaign note saved.');
    } catch (error) {
        setDocsStatus(error.message);
    } finally {
        aiState.loadingDocs = false;
        renderCampaignAiDocs();
    }
}

function appendEmptyState(container, text) {
    const empty = document.createElement('p');
    empty.className = 'ai-empty-state';
    empty.textContent = text;
    container.appendChild(empty);
}

function renderMessages() {
    const container = els.aiCreationMessages;
    if (!container) return;
    container.innerHTML = '';
    const messages = aiState.activeBundle?.messages || [];
    if (!messages.length) {
        appendEmptyState(container, 'No AI creation messages yet.');
        return;
    }

    messages.forEach(message => {
        const row = document.createElement('div');
        row.className = `ai-message ai-message-${message.role}`;

        const header = document.createElement('div');
        header.className = 'ai-message-header';

        const role = document.createElement('strong');
        role.textContent = message.role === 'assistant' ? 'AI' : 'Player';
        header.appendChild(role);

        if (message.metadata?.edited || message.edited_at) {
            const edited = document.createElement('span');
            edited.className = 'ai-message-edited';
            edited.textContent = 'edited';
            header.appendChild(edited);
        }

        if (message.role === 'user' && activeCampaignEntry()?.isMine && !isClosedThread()) {
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'btn btn-outline ai-message-edit';
            edit.textContent = 'Edit';
            edit.disabled = aiState.busyThread;
            edit.addEventListener('click', () => editMessage(message));
            header.appendChild(edit);
        }

        const content = document.createElement('p');
        content.textContent = message.content;

        row.append(header, content);
        container.appendChild(row);
    });
    container.scrollTop = container.scrollHeight;
}

function renderSummaries() {
    const container = els.aiSceneSummaryList;
    if (!container) return;
    container.innerHTML = '';
    const summaries = aiState.activeBundle?.summaries || [];
    if (!summaries.length) return;

    const heading = document.createElement('h3');
    heading.textContent = 'Scene summaries';
    container.appendChild(heading);

    summaries.forEach(summary => {
        const card = document.createElement('article');
        card.className = 'ai-summary-card';

        const title = document.createElement('h4');
        title.textContent = summary.title || 'Backstory scene';

        const meta = document.createElement('span');
        meta.className = `ai-summary-status ai-summary-status-${summary.status}`;
        meta.textContent = `${summary.status || 'draft'} · validation ${summary.validation_status || 'pending'}`;

        const body = document.createElement('p');
        body.textContent = summary.summary || '';

        card.append(title, meta, body);

        if (summary.validation_notes) {
            const notes = document.createElement('p');
            notes.className = 'ai-summary-notes';
            notes.textContent = summary.validation_notes;
            card.appendChild(notes);
        }

        if (Array.isArray(summary.tile_suggestions) && summary.tile_suggestions.length) {
            const list = document.createElement('ul');
            list.className = 'ai-tile-suggestions';
            summary.tile_suggestions.forEach(tile => {
                const item = document.createElement('li');
                item.textContent = `${tile.name} (${tile.type}): ${tile.reason}`;
                list.appendChild(item);
            });
            card.appendChild(list);
        }

        if (summary.status === 'pending_player' && activeCampaignEntry()?.isMine) {
            const accept = document.createElement('button');
            accept.type = 'button';
            accept.className = 'btn btn-primary';
            accept.textContent = 'Accept to journal';
            accept.disabled = aiState.busyThread;
            accept.addEventListener('click', () => acceptSummary(summary.id));
            card.appendChild(accept);
        }

        container.appendChild(card);
    });
}

export function renderCampaignAiDocs() {
    if (!els.campaignAiDocsPanel) return;
    maybeLoadCampaignAiDocs();
    const campaignId = selectedGmCampaignId();
    els.campaignAiDocsPanel.hidden = !dataManager?.isSignedIn || !campaignId;
    if (!campaignId) return;

    if (els.campaignAiDocsStatus) {
        els.campaignAiDocsStatus.textContent = aiState.loadingDocs ? 'Working...' : (aiState.docsStatus || 'Add notes the AI can use for this campaign.');
    }
    if (els.campaignAiScenarioSeed && document.activeElement !== els.campaignAiScenarioSeed) {
        els.campaignAiScenarioSeed.value = aiState.settings?.scenario_seed || '';
    }
    if (els.campaignAiGmInstructions && document.activeElement !== els.campaignAiGmInstructions) {
        els.campaignAiGmInstructions.value = aiState.settings?.gm_instructions || '';
    }
    if (els.btnCampaignAiSettingsSave) els.btnCampaignAiSettingsSave.disabled = aiState.loadingDocs;
    if (els.btnCampaignAiDocUpload) els.btnCampaignAiDocUpload.disabled = aiState.loadingDocs;

    const list = els.campaignAiDocList;
    if (!list) return;
    list.innerHTML = '';
    if (!aiState.documents.length) {
        appendEmptyState(list, 'No campaign AI notes saved yet.');
        return;
    }
    aiState.documents.forEach(doc => {
        const row = document.createElement('div');
        row.className = 'campaign-ai-doc-row';
        const title = document.createElement('strong');
        title.textContent = doc.title || doc.file_name || 'Campaign note';
        const summary = document.createElement('span');
        summary.textContent = doc.content_summary || '';
        row.append(title, summary);
        list.appendChild(row);
    });
}

export function renderAiCreation() {
    if (!els.aiCreationSection) return;
    maybeLoadActiveThread();
    renderCampaignAiDocs();

    const entry = activeCampaignEntry();
    els.aiCreationSection.hidden = !entry;
    if (!entry) return;

    const canChat = Boolean(entry.isMine && !entry.readOnly);
    const hasThread = Boolean(aiState.activeBundle?.thread);
    const hasOpenThread = hasThread && !isClosedThread();
    const status = aiState.loadingThread
        ? 'Loading AI creation chat...'
        : aiState.threadStatus || statusForBundle(aiState.activeBundle);

    if (els.aiCreationStatus) els.aiCreationStatus.textContent = status;
    if (els.btnAiThreadStart) {
        els.btnAiThreadStart.hidden = hasOpenThread;
        els.btnAiThreadStart.textContent = hasThread ? 'Start new scene' : 'Start chat';
        els.btnAiThreadStart.disabled = !canChat || aiState.busyThread || aiState.loadingThread;
    }
    if (els.btnAiSceneFinalize) {
        els.btnAiSceneFinalize.hidden = !hasOpenThread;
        els.btnAiSceneFinalize.disabled = !canChat || !hasOpenThread || aiState.busyThread || aiState.loadingThread;
    }
    if (els.btnAiSceneCancel) {
        els.btnAiSceneCancel.hidden = !hasOpenThread;
        els.btnAiSceneCancel.disabled = !canChat || !hasOpenThread || aiState.busyThread || aiState.loadingThread;
    }
    if (els.aiCreationInput) {
        els.aiCreationInput.disabled = !canChat || !hasOpenThread || aiState.busyThread || aiState.loadingThread;
    }
    if (els.btnAiMessageSend) {
        els.btnAiMessageSend.disabled = !canChat || !hasOpenThread || aiState.busyThread || aiState.loadingThread;
    }

    renderMessages();
    renderSummaries();
}

export function init(deps) {
    dataManager = deps.dataManager;
    supabaseClient = deps.supabaseClient;

    els.btnAiThreadStart?.addEventListener('click', startThread);
    els.aiCreationForm?.addEventListener('submit', sendMessage);
    els.btnAiSceneFinalize?.addEventListener('click', finalizeScene);
    els.btnAiSceneCancel?.addEventListener('click', cancelScene);
    els.btnCampaignAiSettingsSave?.addEventListener('click', saveCampaignAiSettings);
    els.btnCampaignAiDocUpload?.addEventListener('click', uploadCampaignAiDoc);
    els.campaignManageSelect?.addEventListener('change', () => {
        aiState.docsCampaignId = null;
        renderCampaignAiDocs();
    });
    window.addEventListener('cloud-status-change', renderAiCreation);
    window.addEventListener('readonly-character-change', renderAiCreation);
}
