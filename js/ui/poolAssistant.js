// @ts-check
import { els } from '../els.js';
import { buildPoolAssistantCharacter, resolvePoolAssistantSelection } from '../pool-assistant.js';
import { uiState } from '../state.js';
import { applyPoolAssistantSelection } from './pool.js';

const MAX_RECORDING_MS = 15000;
const MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav'
];

/** @type {import('../data.js').DataManager} */
let dataManager;
/** @type {import('@supabase/supabase-js').SupabaseClient<any>|null} */
let supabaseClient = null;
let busy = false;
/** @type {MediaRecorder|null} */
let mediaRecorder = null;
/** @type {MediaStream|null} */
let mediaStream = null;
/** @type {Blob[]} */
let audioChunks = [];
let recordingTimeout = 0;
/** @type {{transcript: string, suggestion: any}|null} */
let pendingPreview = null;
/** @type {null|(() => Promise<Record<string, string>>)} */
let testAuthHeadersProvider = null;

/** @param {string} message @param {'normal'|'error'|'success'} [kind] */
function setStatus(message, kind = 'normal') {
    els.poolAssistantStatus.textContent = message;
    els.poolAssistantStatus.dataset.kind = kind;
}

function setBusy(nextBusy) {
    busy = nextBusy;
    els.poolAssistantCommand.disabled = busy;
    els.btnPoolAssistantSuggest.disabled = busy;
    if (!mediaRecorder) els.btnPoolAssistantMic.disabled = busy;
}

function closePreview() {
    els.poolAssistantPreviewModal.classList.remove('active');
    pendingPreview = null;
}

/** @param {Blob} blob */
async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

async function authHeaders() {
    if (testAuthHeadersProvider) return testAuthHeadersProvider();
    if (!supabaseClient) throw new Error('Sign in is required to use the pool assistant.');
    const { data } = await supabaseClient.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error('Sign in is required to use the pool assistant.');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function currentCharacterPayload() {
    return buildPoolAssistantCharacter(dataManager.state);
}

/** @param {Record<string, unknown>} body */
async function requestSuggestion(body) {
    if (busy) return;
    setBusy(true);
    setStatus('The assistant is extracting the GM colors and choosing matching tiles…');
    try {
        const response = await fetch('/api/ai/pool-assistant', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({
                ...body,
                callColors: uiState.callColors.length === 2 ? [...uiState.callColors] : [],
                character: currentCharacterPayload()
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'The pool assistant request failed.');
        showPreview(String(payload.transcript || ''), payload.suggestion);
        setStatus('Suggestion ready for review.', 'success');
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'The pool assistant request failed.', 'error');
    } finally {
        setBusy(false);
    }
}

/** @param {string} transcript @param {unknown} rawSuggestion */
function showPreview(transcript, rawSuggestion) {
    const resolved = resolvePoolAssistantSelection(rawSuggestion, dataManager.state.tiles || []);
    if (!resolved.valid) throw new Error(resolved.errors[0] || 'The assistant returned an invalid suggestion.');

    const suggestion = resolved.suggestion;
    pendingPreview = { transcript, suggestion };
    els.poolAssistantPreviewTranscript.textContent = transcript || 'No transcript was returned.';
    els.poolAssistantPreviewRationale.textContent = suggestion.rationale || 'No explanation was provided.';
    els.poolAssistantPreviewConfidence.textContent = `Confidence: ${suggestion.confidence}`;

    if (suggestion.status === 'ready' && resolved.callTile) {
        els.poolAssistantPreviewSelection.hidden = false;
        els.poolAssistantPreviewClarification.hidden = true;
        els.poolAssistantPreviewColors.textContent = suggestion.callColors.join(' + ');
        els.poolAssistantPreviewCallTile.textContent = resolved.callTile.name;
        els.poolAssistantPreviewBurnTiles.textContent = resolved.burnTiles.length > 0
            ? resolved.burnTiles.map(tile => tile.name).join(', ')
            : 'None';
        els.btnPoolAssistantApply.hidden = false;
    } else {
        els.poolAssistantPreviewSelection.hidden = true;
        els.poolAssistantPreviewClarification.hidden = false;
        els.poolAssistantPreviewClarification.textContent = suggestion.rationale || 'Please describe the action more specifically.';
        els.btnPoolAssistantApply.hidden = true;
    }

    els.poolAssistantPreviewWarnings.innerHTML = '';
    suggestion.warnings.forEach(warning => {
        const item = document.createElement('li');
        item.textContent = warning;
        els.poolAssistantPreviewWarnings.appendChild(item);
    });
    els.poolAssistantPreviewWarnings.hidden = suggestion.warnings.length === 0;
    els.poolAssistantPreviewModal.classList.add('active');
}

// Exported as a narrow integration seam for browser tests and future callers
// that already possess a server-validated suggestion.
/** @param {string} transcript @param {unknown} rawSuggestion */
export function previewPoolAssistantSuggestion(transcript, rawSuggestion) {
    showPreview(transcript, rawSuggestion);
}

// Browser tests can inject a harmless bearer value; the API still performs
// real server-side authentication, so this cannot bypass production auth.
/** @param {null|(() => Promise<Record<string, string>>)} provider */
export function setPoolAssistantAuthHeadersProviderForTest(provider) {
    testAuthHeadersProvider = provider;
}

function submitTypedCommand() {
    const commandText = els.poolAssistantCommand.value.trim();
    if (!commandText) {
        setStatus('Describe the action first.', 'error');
        els.poolAssistantCommand.focus();
        return;
    }
    requestSuggestion({ commandText });
}

function preferredMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    return MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function resetRecording() {
    if (recordingTimeout) window.clearTimeout(recordingTimeout);
    recordingTimeout = 0;
    mediaStream?.getTracks().forEach(track => track.stop());
    mediaStream = null;
    mediaRecorder = null;
    audioChunks = [];
    els.btnPoolAssistantMic.textContent = '🎙️';
    els.btnPoolAssistantMic.setAttribute('aria-label', 'Dictate Call');
    els.btnPoolAssistantMic.title = 'Dictate Call';
    els.btnPoolAssistantMic.setAttribute('aria-pressed', 'false');
    els.btnPoolAssistantMic.disabled = busy;
}

async function finishRecording() {
    const mimeType = String(mediaRecorder?.mimeType || preferredMimeType()).split(';')[0];
    const blob = new Blob(audioChunks, { type: mimeType });
    resetRecording();
    if (blob.size === 0) {
        setStatus('No audio was captured. Try again or type the action.', 'error');
        return;
    }
    setStatus('Uploading the recording…');
    await requestSuggestion({ audio: { mimeType, base64: await blobToBase64(blob) } });
}

async function startRecording() {
    if (busy) return;
    if (mediaRecorder?.state === 'recording') {
        mediaRecorder.stop();
        return;
    }
    const mimeType = preferredMimeType();
    if (!navigator.mediaDevices?.getUserMedia || !mimeType) {
        setStatus('Voice recording is not supported in this browser. Type the action instead.', 'error');
        return;
    }
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
        mediaRecorder.addEventListener('dataavailable', event => {
            if (event.data.size > 0) audioChunks.push(event.data);
        });
        mediaRecorder.addEventListener('stop', () => finishRecording(), { once: true });
        mediaRecorder.start();
        els.btnPoolAssistantMic.textContent = '⏹';
        els.btnPoolAssistantMic.setAttribute('aria-label', 'Stop Listening');
        els.btnPoolAssistantMic.title = 'Stop Listening';
        els.btnPoolAssistantMic.setAttribute('aria-pressed', 'true');
        els.poolAssistantCommand.disabled = true;
        els.btnPoolAssistantSuggest.disabled = true;
        setStatus('Listening… recording stops after 15 seconds.');
        recordingTimeout = window.setTimeout(() => {
            if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
        }, MAX_RECORDING_MS);
    } catch (error) {
        resetRecording();
        setStatus(error instanceof Error ? `Microphone unavailable: ${error.message}` : 'Microphone access was denied.', 'error');
    }
}

function applyPreview() {
    if (!pendingPreview) return;
    try {
        applyPoolAssistantSelection(pendingPreview.suggestion);
        els.poolAssistantCommand.value = pendingPreview.transcript;
        closePreview();
        setStatus('The GM colors and tile suggestion were applied.', 'success');
    } catch (error) {
        closePreview();
        setStatus(error instanceof Error ? error.message : 'The suggestion is no longer valid.', 'error');
    }
}

async function loadFeatureConfig() {
    try {
        const response = await fetch('/api/ai/pool-assistant', { headers: { Accept: 'application/json' } });
        const payload = await response.json().catch(() => ({}));
        const enabled = response.ok && payload.enabled === true;
        els.poolAssistantPanel.hidden = !enabled;
        els.btnPoolAssistantMic.hidden = !enabled;
        if (enabled) setStatus('Say the two GM colors and the action, or select both colors first.');
    } catch {
        els.poolAssistantPanel.hidden = true;
        els.btnPoolAssistantMic.hidden = true;
    }
}

/** @param {import('../types.js').AppDependencies} deps */
export function init(deps) {
    dataManager = deps.dataManager;
    supabaseClient = deps.supabaseClient;
    els.poolAssistantForm.addEventListener('submit', event => {
        event.preventDefault();
        submitTypedCommand();
    });
    els.btnPoolAssistantMic.addEventListener('click', startRecording);
    els.btnPoolAssistantApply.addEventListener('click', applyPreview);
    els.btnPoolAssistantCancel.addEventListener('click', closePreview);
    els.btnPoolAssistantPreviewClose.addEventListener('click', closePreview);
    els.poolAssistantPreviewModal.addEventListener('click', event => {
        if (event.target === els.poolAssistantPreviewModal) closePreview();
    });
    loadFeatureConfig();
}
