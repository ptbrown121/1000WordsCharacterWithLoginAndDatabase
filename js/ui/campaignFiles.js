// Campaign files panel (GM-side): PowerPoint battle maps and slide decks
// stored in the private campaign-files bucket so a GM can fetch them from
// any computer. Scoped to the campaign picked in the "Manage members"
// selector, same as the member list.
import { els } from '../els.js';

const POWERPOINT_EXTENSIONS = ['ppt', 'pptx', 'ppsx'];

let dataManager;

const state = {
    campaignId: null,
    files: [],
    status: '',
    busy: false
};

function selectedGmCampaignId() {
    // campaign-manage-select only ever lists campaigns the user GMs.
    return els.campaignManageSelect?.value || null;
}

function setStatus(text) {
    state.status = text || '';
    if (els.campaignFilesStatus) els.campaignFilesStatus.textContent = state.status;
}

function formatSize(bytes) {
    const size = parseInt(bytes, 10) || 0;
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    if (size >= 1024) return `${Math.round(size / 1024)} KB`;
    return `${size} B`;
}

function hasPowerPointExtension(name) {
    const extension = String(name || '').split('.').pop().toLowerCase();
    return POWERPOINT_EXTENSIONS.includes(extension);
}

function renderFileList() {
    const list = els.campaignFileList;
    if (!list) return;
    list.innerHTML = '';

    if (state.files.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'campaign-files-empty';
        empty.textContent = state.busy ? '' : 'No files yet. Upload a PowerPoint (.ppt, .pptx, .ppsx) up to 50 MB.';
        list.appendChild(empty);
        return;
    }

    state.files.forEach(file => {
        const row = document.createElement('div');
        row.className = 'campaign-file-row';

        const main = document.createElement('div');
        main.className = 'campaign-file-main';

        const title = document.createElement('strong');
        title.textContent = file.title;

        const meta = document.createElement('span');
        meta.className = 'campaign-file-meta';
        const when = file.createdAt ? new Date(file.createdAt).toLocaleDateString() : '';
        meta.textContent = `${file.fileName} · ${formatSize(file.sizeBytes)}${when ? ` · ${when}` : ''}`;

        main.append(title, meta);

        const download = document.createElement('button');
        download.type = 'button';
        download.className = 'btn btn-outline';
        download.textContent = 'Download';
        download.addEventListener('click', () => downloadFile(file));

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-outline';
        remove.textContent = 'Delete';
        remove.addEventListener('click', () => deleteFile(file));

        row.append(main, download, remove);
        list.appendChild(row);
    });
}

export function renderCampaignFiles() {
    if (!els.campaignFilesPanel) return;
    const campaignId = selectedGmCampaignId();
    const visible = Boolean(dataManager?.cloudStore && campaignId);
    els.campaignFilesPanel.hidden = !visible;
    if (!visible) return;
    if (els.btnCampaignFileUpload) els.btnCampaignFileUpload.disabled = state.busy;
    setStatus(state.status);
    renderFileList();
}

async function loadFiles(campaignId) {
    state.busy = true;
    state.files = [];
    setStatus('Loading files...');
    renderCampaignFiles();
    try {
        state.files = await dataManager.cloudStore.listCampaignFiles(campaignId);
        setStatus(state.files.length === 0 ? '' : `${state.files.length} file${state.files.length === 1 ? '' : 's'}`);
    } catch (error) {
        setStatus(error.message || 'Could not load campaign files.');
    } finally {
        state.busy = false;
        renderCampaignFiles();
    }
}

// Reload only when the selected GM campaign actually changes; the cloud
// status event fires on every save.
function maybeLoadFiles() {
    const campaignId = dataManager?.cloudStore ? selectedGmCampaignId() : null;
    if (campaignId === state.campaignId) {
        renderCampaignFiles();
        return;
    }
    state.campaignId = campaignId;
    state.files = [];
    setStatus('');
    if (campaignId) {
        loadFiles(campaignId);
    } else {
        renderCampaignFiles();
    }
}

async function uploadFile() {
    const campaignId = selectedGmCampaignId();
    const file = els.campaignFileInput?.files?.[0];
    if (!campaignId || state.busy) return;
    if (!file) {
        setStatus('Choose a PowerPoint file first.');
        return;
    }
    if (!hasPowerPointExtension(file.name)) {
        setStatus('Only PowerPoint files (.ppt, .pptx, .ppsx) are accepted.');
        return;
    }
    if (file.size > 50 * 1024 * 1024) {
        setStatus(`${file.name} is ${formatSize(file.size)}; the limit is 50 MB.`);
        return;
    }

    state.busy = true;
    setStatus(`Uploading ${file.name}...`);
    renderCampaignFiles();
    try {
        const saved = await dataManager.cloudStore.uploadCampaignFile(campaignId, file, els.campaignFileTitle?.value);
        state.files = [saved, ...state.files];
        if (els.campaignFileInput) els.campaignFileInput.value = '';
        if (els.campaignFileTitle) els.campaignFileTitle.value = '';
        setStatus(`${saved.title} uploaded.`);
    } catch (error) {
        setStatus(error.message || 'Upload failed.');
    } finally {
        state.busy = false;
        renderCampaignFiles();
    }
}

async function downloadFile(file) {
    setStatus(`Fetching ${file.fileName}...`);
    try {
        const url = await dataManager.cloudStore.getCampaignFileDownloadUrl(file.storagePath, file.fileName);
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener';
        link.click();
        setStatus('');
    } catch (error) {
        setStatus(error.message || `Could not download ${file.fileName}.`);
    }
}

async function deleteFile(file) {
    if (state.busy) return;
    if (!confirm(`Delete ${file.title} from the campaign?`)) return;
    state.busy = true;
    setStatus(`Deleting ${file.title}...`);
    renderCampaignFiles();
    try {
        await dataManager.cloudStore.deleteCampaignFile(file);
        state.files = state.files.filter(entry => entry.id !== file.id);
        setStatus('');
    } catch (error) {
        setStatus(error.message || `Could not delete ${file.title}.`);
    } finally {
        state.busy = false;
        renderCampaignFiles();
    }
}

export function init(deps) {
    dataManager = deps.dataManager;

    els.btnCampaignFileUpload?.addEventListener('click', uploadFile);
    els.campaignManageSelect?.addEventListener('change', maybeLoadFiles);
    // Campaigns appear after sign-in and vanish on sign-out. cloud.js
    // registers its listener first (init order in app.js), so the campaign
    // select is already repopulated when this one runs.
    window.addEventListener('cloud-status-change', maybeLoadFiles);

    // initCloud may have already restored a session before this module
    // could listen, so check once at startup too.
    maybeLoadFiles();
}
