// @ts-check
import {
    COLOR_HEX,
    DEFAULT_STATE,
    STAT_COLORS,
    VALID_DICE,
    cloneDefaultState,
    getEffectiveMax,
    mergeStateWithDefaults,
    normalizeImportedState,
    normalizeStateForShadowRules,
    normalizeTileMetadata,
    normalizeTileTags,
    reorderTilesByVisibleMove
} from './character-normalizer.js';

export {
    COLOR_HEX,
    DEFAULT_STATE,
    STAT_COLORS,
    VALID_DICE,
    cloneDefaultState,
    getEffectiveMax,
    mergeStateWithDefaults,
    normalizeImportedState,
    normalizeStateForShadowRules,
    normalizeTileMetadata,
    normalizeTileTags,
    reorderTilesByVisibleMove
};

// Caught values are `unknown` under checkJs; this narrows them to a
// readable message without assuming every throw is an Error.
function errorMessage(error, fallback) {
    return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Live-sync policy: should a realtime UPDATE for the active character be
 * applied by reloading remote state? Pure so it can be tested under node
 * (ui/liveSync.js itself needs a DOM).
 *
 * - No stamp, or a stamp matching what we last wrote/read: our own save
 *   echoed back through realtime - ignore.
 * - A queued or in-flight local save means local edits exist: do nothing
 *   and let the optimistic guard turn the rival write into the conflict
 *   dialog instead of silently clobbering the local edits.
 */
export function shouldApplyRemoteCharacterUpdate({ remoteUpdatedAt, ownUpdatedAt, savePending, saveInFlight }) {
    if (!remoteUpdatedAt) return false;
    if (remoteUpdatedAt === ownUpdatedAt) return false;
    if (savePending || saveInFlight) return false;
    return true;
}

function dispatchAppEvent(name, detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

export class LocalCharacterStore {
    constructor(storage = globalThis.localStorage) {
        this.storage = storage;
    }

    loadRoster() {
        const savedRoster = this.storage.getItem('1000words_roster');
        const active = this.storage.getItem('1000words_active_char');
        const legacySave = this.storage.getItem('1000words_state');

        if (savedRoster) {
            let roster = JSON.parse(savedRoster);
            if (!Array.isArray(roster)) roster = [];
            let activeCharId = active || (roster.length > 0 ? roster[0].id : null);
            if (!roster.find(r => r.id === activeCharId) && roster.length > 0) {
                activeCharId = roster[0].id;
            }
            return { roster, activeCharId };
        }

        if (legacySave) {
            const charId = crypto.randomUUID();
            let name = 'Hero Name';
            try { name = JSON.parse(legacySave).name || 'Hero Name'; } catch {
                // Keep the default name if the legacy blob is unreadable.
            }
            this.storage.setItem('1000words_state_' + charId, legacySave);
            this.storage.removeItem('1000words_state');
            const roster = [{ id: charId, name, source: 'local', isMine: true }];
            this.saveRoster(roster, charId);
            return { roster, activeCharId: charId };
        }

        const charId = crypto.randomUUID();
        const roster = [{ id: charId, name: 'Hero Name', source: 'local', isMine: true }];
        this.saveRoster(roster, charId);
        return { roster, activeCharId: charId };
    }

    saveRoster(roster, activeCharId) {
        const localRoster = roster.map(({ id, name }) => ({ id, name }));
        this.storage.setItem('1000words_roster', JSON.stringify(localRoster));
        if (activeCharId) this.storage.setItem('1000words_active_char', activeCharId);
    }

    loadState(charId) {
        if (!charId) return cloneDefaultState();
        const saved = this.storage.getItem('1000words_state_' + charId);
        if (saved) {
            try {
                return mergeStateWithDefaults(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to parse saved state", e);
            }
        }
        return cloneDefaultState();
    }

    saveState(charId, state) {
        this.storage.setItem('1000words_state_' + charId, JSON.stringify(state));
    }

    deleteState(charId) {
        this.storage.removeItem('1000words_state_' + charId);
    }

    cloudDraftKey(userId, charId) {
        return `1000words_cloud_draft_${userId}_${charId}`;
    }

    saveCloudDraft(userId, charId, state, baseUpdatedAt) {
        const draft = {
            userId,
            charId,
            state,
            baseUpdatedAt: baseUpdatedAt || null,
            revision: crypto.randomUUID(),
            savedAt: new Date().toISOString()
        };
        this.storage.setItem(this.cloudDraftKey(userId, charId), JSON.stringify(draft));
        return draft;
    }

    loadCloudDraft(userId, charId) {
        const saved = this.storage.getItem(this.cloudDraftKey(userId, charId));
        if (!saved) return null;
        try {
            const draft = JSON.parse(saved);
            if (draft?.userId !== userId || draft?.charId !== charId || !draft?.state || !draft?.revision) return null;
            return draft;
        } catch (e) {
            console.error('Failed to parse cloud draft', e);
            return null;
        }
    }

    advanceCloudDraftBase(userId, charId, expectedBaseUpdatedAt, newBaseUpdatedAt) {
        const draft = this.loadCloudDraft(userId, charId);
        if (!draft || draft.baseUpdatedAt !== expectedBaseUpdatedAt) return false;
        draft.baseUpdatedAt = newBaseUpdatedAt || null;
        this.storage.setItem(this.cloudDraftKey(userId, charId), JSON.stringify(draft));
        return true;
    }

    // Which local characters were uploaded to this account, as
    // { [localId]: { cloudId, fingerprint } } (see uploadLocalCharacters).
    /** @param {string} userId */
    loadUploadRecords(userId) {
        const saved = this.storage.getItem(`1000words_uploaded_${userId}`);
        if (!saved) return {};
        try {
            const records = JSON.parse(saved);
            return records && typeof records === 'object' && !Array.isArray(records) ? records : {};
        } catch (e) {
            console.error('Failed to parse local upload records', e);
            return {};
        }
    }

    /** @param {string} userId @param {Record<string, { cloudId: string, fingerprint: string }>} records */
    saveUploadRecords(userId, records) {
        this.storage.setItem(`1000words_uploaded_${userId}`, JSON.stringify(records));
    }

    /** @param {string} userId @param {string} charId @param {string | null} [expectedRevision] */
    deleteCloudDraft(userId, charId, expectedRevision = null) {
        if (expectedRevision) {
            const current = this.loadCloudDraft(userId, charId);
            if (!current || current.revision !== expectedRevision) return false;
        }
        this.storage.removeItem(this.cloudDraftKey(userId, charId));
        return true;
    }
}

// Short FNV-1a hash of a character's saved state, used to tell whether a
// local character changed since it was uploaded.
/** @param {unknown} state */
function stateFingerprint(state) {
    const text = JSON.stringify(state);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16);
}

export class DataManager {
    constructor({ localStore = new LocalCharacterStore(), cloudStore = null, saveDebounceMs = 800 } = {}) {
        this.localStore = localStore;
        this.cloudStore = cloudStore;
        this.saveDebounceMs = saveDebounceMs;
        this.cloudUser = null;
        this.cloudRoster = [];
        this.campaigns = [];
        this.campaignMembers = [];
        this.rollLogs = [];
        this.canCreateCampaign = false;
        this.cloudStatus = cloudStore ? 'signed-out' : 'local-only';
        this.cloudMessage = cloudStore ? 'Cloud save is available after sign-in.' : 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable cloud save.';
        this.activeStorage = 'local';
        this.pendingSaveTimer = null;
        // updated_at of the active cloud character as last read from the
        // server; sent with saves as the optimistic-concurrency guard.
        this.cloudUpdatedAt = null;
        // Cloud saves are chained so a debounced save can never race a
        // previous save that is still in flight (the guard value must be
        // read after the previous save has settled).
        this.cloudSaveChain = Promise.resolve();
        this.cloudSaveInFlight = false;
        // Set while switching away from an active character that vanished
        // from the cloud roster (see refreshCloudRoster).
        /** @type {Promise<void> | null} */
        this.missingCharacterRecovery = null;
        this.uploadingLocalCharacters = false;
        this.localRoster = [];
        this.localActiveCharId = null;

        this.loadRoster();
        this.state = this.loadState(this.activeCharId);
    }

    loadRoster() {
        try {
            const { roster, activeCharId } = this.localStore.loadRoster();
            this.localRoster = roster.map(r => ({ ...r, source: 'local', isMine: true, readOnly: false }));
            this.localActiveCharId = activeCharId;
            if (this.activeStorage === 'local') {
                this.roster = this.localRoster;
                this.activeCharId = this.localActiveCharId;
            }
        } catch (e) {
            console.error('Failed to load roster from localStorage', e);
            dispatchAppEvent('storage-error', { error: e, operation: 'loadRoster' });
            this.localRoster = [];
            this.localActiveCharId = null;
            this.roster = [];
            this.activeCharId = null;
        }
    }

    saveRoster() {
        if (this.activeStorage !== 'local') return;
        try {
            this.localRoster = this.roster.map(r => ({ id: r.id, name: r.name, source: 'local', isMine: true, readOnly: false }));
            this.localActiveCharId = this.activeCharId;
            this.localStore.saveRoster(this.localRoster, this.localActiveCharId);
        } catch (e) {
            console.error('Failed to save roster to localStorage', e);
            dispatchAppEvent('storage-error', { error: e, operation: 'saveRoster' });
        }
    }

    loadState(charId) {
        if (this.activeStorage === 'cloud') {
            return this.state || cloneDefaultState();
        }
        return this.localStore.loadState(charId);
    }

    get activeRosterEntry() {
        return (this.roster || []).find(r => r.id === this.activeCharId) || null;
    }

    get isCloudConfigured() {
        return Boolean(this.cloudStore);
    }

    get isSignedIn() {
        return Boolean(this.cloudUser);
    }

    get hasLocalCharacters() {
        return this.localRoster.length > 0;
    }

    canEditActiveCharacter() {
        const entry = this.activeRosterEntry;
        return !entry || !entry.readOnly;
    }

    setCloudStatus(status, message = '') {
        this.cloudStatus = status;
        this.cloudMessage = message;
        dispatchAppEvent('cloud-status-change', { status, message });
    }

    markReadOnlyAttempt() {
        this.setCloudStatus('read-only', 'This campaign character is read-only for GMs in v1.');
        dispatchAppEvent('readonly-character-change');
    }

    saveState() {
        if (!this.activeCharId) return false;
        if (!this.canEditActiveCharacter()) {
            this.markReadOnlyAttempt();
            return false;
        }

        const rosterEntry = this.roster.find(r => r.id === this.activeCharId);
        if (rosterEntry && rosterEntry.name !== this.state.name) rosterEntry.name = this.state.name;

        if (this.activeStorage === 'cloud') {
            this.scheduleCloudSave();
            return true;
        }

        try {
            this.localStore.saveState(this.activeCharId, this.state);
            if (rosterEntry) this.saveRoster();
            return true;
        } catch (e) {
            console.error('Failed to save state to localStorage', e);
            dispatchAppEvent('storage-error', { error: e, operation: 'saveState' });
            return false;
        }
    }

    saveCloudDraft(charId, state) {
        const userId = this.cloudUser?.id;
        if (!userId) return null;
        try {
            return this.localStore.saveCloudDraft(userId, charId, state, this.cloudUpdatedAt);
        } catch (e) {
            console.error('Failed to preserve cloud draft in localStorage', e);
            dispatchAppEvent('storage-error', { error: e, operation: 'saveCloudDraft' });
            return null;
        }
    }

    loadCloudDraft(charId) {
        const userId = this.cloudUser?.id;
        if (!userId) return null;
        try {
            return this.localStore.loadCloudDraft(userId, charId);
        } catch (e) {
            console.error('Failed to load cloud draft from localStorage', e);
            dispatchAppEvent('storage-error', { error: e, operation: 'loadCloudDraft' });
            return null;
        }
    }

    /** @param {string} charId @param {string | null} [expectedRevision] */
    clearCloudDraft(charId, expectedRevision = null) {
        const userId = this.cloudUser?.id;
        if (!userId) return false;
        try {
            return this.localStore.deleteCloudDraft(userId, charId, expectedRevision);
        } catch (e) {
            console.error('Failed to clear cloud draft from localStorage', e);
            dispatchAppEvent('storage-error', { error: e, operation: 'clearCloudDraft' });
            return false;
        }
    }

    advanceCloudDraftBase(charId, expectedBaseUpdatedAt, newBaseUpdatedAt) {
        const userId = this.cloudUser?.id;
        if (!userId) return false;
        try {
            return this.localStore.advanceCloudDraftBase(userId, charId, expectedBaseUpdatedAt, newBaseUpdatedAt);
        } catch (e) {
            console.error('Failed to update cloud draft metadata', e);
            dispatchAppEvent('storage-error', { error: e, operation: 'advanceCloudDraftBase' });
            return false;
        }
    }

    hasCloudDraft(charId = this.activeCharId) {
        return Boolean(charId && this.loadCloudDraft(charId));
    }

    /** @param {string} charId @param {string} [name] */
    syncCloudRosterCharacterName(charId, name) {
        const cleanName = String(name || '').trim() || 'Unnamed';
        const entry = this.cloudRoster.find(r => r.id === charId);
        if (entry && entry.name !== cleanName) {
            entry.name = cleanName;
        }
    }

    // Applies a copy of the active character fetched for live sync. The
    // checks run after the fetch, not before: an edit made while it was in
    // flight must reach the save guard (and the conflict dialog) instead of
    // being replaced by the fetched copy and then saved over it.
    /** @param {string} charId @param {{ state: import('./types.js').CharacterState, updatedAt?: string | null }} loaded */
    applyRemoteCloudCharacter(charId, loaded) {
        if (this.activeStorage !== 'cloud' || this.activeCharId !== charId) return false;
        const apply = shouldApplyRemoteCharacterUpdate({
            remoteUpdatedAt: loaded.updatedAt || null,
            ownUpdatedAt: this.cloudUpdatedAt,
            savePending: Boolean(this.pendingSaveTimer) || this.hasCloudDraft(charId),
            saveInFlight: Boolean(this.cloudSaveInFlight)
        });
        if (!apply) return false;
        this.state = loaded.state;
        this.cloudUpdatedAt = loaded.updatedAt || null;
        this.syncCloudRosterCharacterName(charId, loaded.state?.name);
        return true;
    }

    scheduleCloudSave() {
        if (!this.cloudStore || this.activeStorage !== 'cloud') return;
        clearTimeout(this.pendingSaveTimer ?? undefined);
        this.setCloudStatus('saving', 'Saving to cloud...');
        const charId = this.activeCharId;
        const state = JSON.parse(JSON.stringify(this.state));
        const draft = this.saveCloudDraft(charId, state);
        this.pendingSaveTimer = setTimeout(() => {
            this.pendingSaveTimer = null;
            this.queueCloudSave(charId, state, { draftRevision: draft?.revision || null });
        }, this.saveDebounceMs);
    }

    async flushCloudSave() {
        if (!this.cloudStore || this.activeStorage !== 'cloud') return;
        if (this.pendingSaveTimer) {
            clearTimeout(this.pendingSaveTimer);
            this.pendingSaveTimer = null;
            if (this.canEditActiveCharacter()) {
                const charId = this.activeCharId;
                const state = JSON.parse(JSON.stringify(this.state));
                const draft = this.saveCloudDraft(charId, state);
                await this.queueCloudSave(charId, state, { draftRevision: draft?.revision || null });
            }
        }
        await this.cloudSaveChain;
    }

    // All cloud saves go through this chain so they run one at a time and
    // each reads the guard value left by the previous save. The guard is
    // read at run time (not schedule time) for the same reason.
    /**
     * @param {string} charId
     * @param {import('./types.js').CharacterState} state
     * @param {{ draftRevision?: string | null }} [options]
     */
    queueCloudSave(charId, state, { draftRevision = null } = {}) {
        const run = async () => {
            // cloudSaveInFlight tells live sync to ignore realtime echoes of
            // this write (and rival writes - the guard handles those).
            this.cloudSaveInFlight = true;
            try {
                const guard = this.activeCharId === charId ? this.cloudUpdatedAt : null;
                const newUpdatedAt = await this.cloudStore.saveCharacter(charId, state, { ifUnmodifiedSince: guard });
                if (this.activeCharId === charId && newUpdatedAt) this.cloudUpdatedAt = newUpdatedAt;
                if (draftRevision) {
                    const cleared = this.clearCloudDraft(charId, draftRevision);
                    if (!cleared && newUpdatedAt) this.advanceCloudDraftBase(charId, guard, newUpdatedAt);
                }
                this.syncCloudRosterCharacterName(charId, state?.name);
                this.setCloudStatus('saved', 'Cloud save complete.');
            } finally {
                this.cloudSaveInFlight = false;
            }
        };
        this.cloudSaveChain = this.cloudSaveChain
            .then(run)
            .catch(e => this.handleCloudSaveError(e, charId, state, draftRevision));
        return this.cloudSaveChain;
    }

    /** @param {unknown} e @param {string} charId @param {import('./types.js').CharacterState} state @param {string | null} [draftRevision] */
    handleCloudSaveError(e, charId, state, draftRevision = null) {
        if (e && typeof e === 'object' && 'isCloudSaveConflict' in e && e.isCloudSaveConflict) {
            // The state snapshot rides along so the user can still choose
            // "overwrite" even if they have switched characters meanwhile.
            const currentDraft = this.loadCloudDraft(charId);
            this.setCloudStatus('error', 'This character changed somewhere else.');
            dispatchAppEvent('cloud-save-conflict', {
                charId,
                state: currentDraft?.state || state,
                draftRevision: currentDraft?.revision || draftRevision
            });
            return;
        }
        console.error('Failed to save cloud character', e);
        this.setCloudStatus('error', errorMessage(e, 'Cloud save failed.'));
    }

    // Conflict resolution, driven by the dialog in ui/cloud.js.
    async resolveCloudConflictByReloading(charId) {
        if (!this.cloudStore) return;
        await this.refreshCloudRoster();
        if (this.activeStorage === 'cloud' && this.activeCharId === charId) {
            const loaded = await this.cloudStore.loadCharacter(charId);
            this.state = loaded.state;
            this.cloudUpdatedAt = loaded.updatedAt || null;
        }
        this.clearCloudDraft(charId);
        this.setCloudStatus('saved', 'Loaded the newer cloud version.');
    }

    async resolveCloudConflictByOverwriting(charId, stateSnapshot = null, draftRevision = null) {
        if (!this.cloudStore) return;
        const state = stateSnapshot || (this.activeCharId === charId ? this.state : null);
        if (!state) return;
        // No guard: the user explicitly chose to replace the newer copy.
        const updatedAt = await this.cloudStore.saveCharacter(charId, state);
        if (this.activeCharId === charId && updatedAt) this.cloudUpdatedAt = updatedAt;
        if (draftRevision) this.clearCloudDraft(charId, draftRevision);
        this.syncCloudRosterCharacterName(charId, state?.name);
        this.setCloudStatus('saved', 'Cloud copy replaced with this version.');
    }

    // Folds journal entries a server route appended into the local state without
    // replacing it wholesale, so edits made while the request was in flight
    // survive. The follow-up saveState() re-syncs the merged state to the cloud.
    /** @param {import('./types.js').CharacterState} serverState @param {string|null} [serverUpdatedAt] */
    mergeServerJournalEntries(serverState, serverUpdatedAt = null) {
        if (!this.canEditActiveCharacter()) return false;
        const serverJournal = Array.isArray(serverState?.journal) ? serverState.journal : [];
        if (serverJournal.length === 0) return false;

        const journal = Array.isArray(this.state.journal) ? this.state.journal : [];
        const knownIds = new Set(journal.map(entry => entry?.id).filter(Boolean));
        const added = serverJournal.filter(entry => entry?.id && !knownIds.has(entry.id));
        if (added.length === 0) return false;

        // The server route that produced serverState also wrote the character
        // row. Carry its new stamp into the follow-up save so unrelated writes
        // made after the acceptance cannot be silently overwritten. Older
        // servers omit the stamp, preserving the previous fallback behavior.
        this.cloudUpdatedAt = serverUpdatedAt || null;

        this.state.journal = [...journal, ...added];
        this.saveState();
        return true;
    }

    updateStat(statName, value) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_STATE.stats, statName)) return;
        if (!this.canEditActiveCharacter()) {
            this.markReadOnlyAttempt();
            return;
        }
        this.state.stats[statName] = value;
        this.saveState();
    }

    updateResource(type, value) {
        if (!this.canEditActiveCharacter()) {
            this.markReadOnlyAttempt();
            return;
        }
        this.state[type] = value;
        this.saveState();
    }

    updateName(name) {
        if (!this.canEditActiveCharacter()) {
            this.markReadOnlyAttempt();
            return;
        }
        this.state.name = name;
        this.saveState();
    }

    addTile(tile) {
        if (!this.canEditActiveCharacter()) {
            this.markReadOnlyAttempt();
            return;
        }
        if (!tile.id) tile.id = crypto.randomUUID();
        normalizeTileMetadata(tile);
        this.state.tiles.push(tile);
        this.saveState();
    }

    updateTile(updatedTile) {
        if (!this.canEditActiveCharacter()) {
            this.markReadOnlyAttempt();
            return;
        }
        normalizeTileMetadata(updatedTile);
        const idx = this.state.tiles.findIndex(t => t.id === updatedTile.id);
        if (idx !== -1) {
            this.state.tiles[idx] = updatedTile;
            this.saveState();
        }
    }

    deleteTile(id) {
        if (!this.canEditActiveCharacter()) {
            this.markReadOnlyAttempt();
            return;
        }
        this.state.tiles = this.state.tiles.filter(t => t.id !== id);
        this.saveState();
    }

    reorderTilesByVisibleMove(visibleTileIds, draggedId, targetId) {
        if (!this.canEditActiveCharacter()) {
            this.markReadOnlyAttempt();
            return;
        }
        this.state.tiles = reorderTilesByVisibleMove(this.state.tiles, visibleTileIds, draggedId, targetId);
        this.saveState();
    }

    /** @param {string} id @returns {Promise<boolean>} whether the character is now active */
    async switchCharacter(id) {
        const cloudEntry = this.cloudRoster.find(r => r.id === id);
        if (cloudEntry) {
            await this.flushCloudSave();
            // Load before touching the active id: if the load fails, the
            // previous character must stay fully active, or its state would
            // be saved over this one.
            let loaded;
            try {
                loaded = await this.cloudStore.loadCharacter(id);
            } catch (e) {
                console.error('Failed to load cloud character', e);
                this.setCloudStatus('error', errorMessage(e, 'Could not load that cloud character.'));
                return false;
            }
            this.activeStorage = 'cloud';
            this.roster = this.cloudRoster;
            this.activeCharId = id;
            this.state = loaded.state;
            this.cloudUpdatedAt = loaded.updatedAt || null;
            this.setCloudStatus(cloudEntry.readOnly ? 'read-only' : 'saved', cloudEntry.readOnly ? 'Viewing read-only campaign character.' : 'Cloud character loaded.');
            const draft = cloudEntry.readOnly ? null : this.loadCloudDraft(id);
            if (draft) {
                this.state = mergeStateWithDefaults(draft.state);
                if (draft.baseUpdatedAt === this.cloudUpdatedAt) {
                    this.setCloudStatus('saving', 'Recovered unsaved browser edits. Saving to cloud...');
                    this.queueCloudSave(id, JSON.parse(JSON.stringify(this.state)), { draftRevision: draft.revision });
                } else {
                    this.cloudUpdatedAt = draft.baseUpdatedAt || null;
                    this.setCloudStatus('error', 'Recovered browser edits conflict with a newer cloud copy.');
                    dispatchAppEvent('cloud-save-conflict', {
                        charId: id,
                        state: JSON.parse(JSON.stringify(this.state)),
                        draftRevision: draft.revision
                    });
                }
            }
            dispatchAppEvent('readonly-character-change');
            return true;
        }

        if (this.localRoster.find(r => r.id === id)) {
            await this.flushCloudSave();
            this.activeStorage = 'local';
            this.roster = this.localRoster;
            this.activeCharId = id;
            this.localActiveCharId = id;
            this.cloudUpdatedAt = null;
            this.localStore.saveRoster(this.localRoster, this.localActiveCharId);
            this.state = this.localStore.loadState(this.activeCharId);
            dispatchAppEvent('readonly-character-change');
            return true;
        }
        return false;
    }

    async createNewCharacter(name = "Hero Name") {
        const state = cloneDefaultState();
        state.name = name;

        if (this.isSignedIn && this.cloudStore) {
            await this.flushCloudSave();
            const charId = await this.cloudStore.createCharacter(name, state);
            // Load before the roster refresh re-points the active id, so a
            // failed load can't bind the previous character's state to it.
            const loaded = await this.cloudStore.loadCharacter(charId);
            await this.refreshCloudRoster({ activeCharId: charId });
            this.state = loaded.state;
            this.cloudUpdatedAt = loaded.updatedAt || null;
            this.setCloudStatus('saved', 'Cloud character created.');
            return charId;
        }

        const charId = crypto.randomUUID();
        this.activeStorage = 'local';
        this.roster = this.localRoster;
        this.localRoster.push({ id: charId, name, source: 'local', isMine: true, readOnly: false });
        this.activeCharId = charId;
        this.localActiveCharId = charId;
        this.state = state;
        this.saveState();
        this.saveRoster();
        return charId;
    }

    async deleteCurrentCharacter() {
        if (!this.canEditActiveCharacter()) {
            this.markReadOnlyAttempt();
            return;
        }

        if (this.activeStorage === 'cloud' && this.cloudStore) {
            const archivedId = this.activeCharId;
            // Unsaved edits to a character being deleted are moot; a queued
            // save firing later would write to the archived row.
            clearTimeout(this.pendingSaveTimer ?? undefined);
            this.pendingSaveTimer = null;
            await this.cloudSaveChain;
            await this.cloudStore.archiveCharacter(archivedId);
            this.clearCloudDraft(archivedId);
            await this.refreshCloudRoster();
            const next = this.cloudRoster.find(r => r.id !== archivedId);
            if (!next || !await this.switchCharacter(next.id)) {
                this.state = cloneDefaultState();
                this.activeCharId = null;
                this.cloudUpdatedAt = null;
            }
            return;
        }

        if (this.roster.length === 1) {
            this.clearState();
            return;
        }

        this.localStore.deleteState(this.activeCharId);
        this.roster = this.roster.filter(r => r.id !== this.activeCharId);
        this.localRoster = this.roster;
        this.activeCharId = this.roster[0].id;
        this.localActiveCharId = this.activeCharId;
        this.saveRoster();
        this.state = this.loadState(this.activeCharId);
    }

    exportState() {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.state, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", `1000words_${this.state.name.replace(/\s+/g, '_')}.json`);
        dlAnchorElem.click();
    }

    async importState(jsonString, overwrite = false) {
        try {
            const newState = normalizeImportedState(JSON.parse(jsonString));
            if (newState) {
                if (overwrite) {
                    if (!this.canEditActiveCharacter()) {
                        this.markReadOnlyAttempt();
                        return false;
                    }
                    this.state = newState;
                    this.saveState();
                } else if (this.isSignedIn && this.cloudStore) {
                    const name = newState.name || 'Imported Hero';
                    await this.flushCloudSave();
                    const charId = await this.cloudStore.createCharacter(name, newState);
                    const loaded = await this.cloudStore.loadCharacter(charId);
                    await this.refreshCloudRoster({ activeCharId: charId });
                    this.state = loaded.state;
                    this.cloudUpdatedAt = loaded.updatedAt || null;
                } else {
                    const charId = crypto.randomUUID();
                    const name = newState.name || 'Imported Hero';
                    this.activeStorage = 'local';
                    this.roster = this.localRoster;
                    this.roster.push({ id: charId, name, source: 'local', isMine: true, readOnly: false });
                    this.activeCharId = charId;
                    this.localActiveCharId = charId;
                    this.state = newState;
                    this.saveState();
                    this.saveRoster();
                }
                return true;
            }
        } catch (e) {
            console.error("Invalid JSON format", e);
        }
        return false;
    }

    clearState() {
        if (!this.canEditActiveCharacter()) {
            this.markReadOnlyAttempt();
            return;
        }
        this.state = cloneDefaultState();
        this.saveState();
    }

    // Refreshes the roster lists only. It never re-points the active
    // character by itself: the active id and this.state must change together
    // (switchCharacter), or the next save writes one character's state into
    // another. Pass activeCharId only when the caller loads that character's
    // state right after (create/import).
    async refreshCloudRoster({ activeCharId = null } = {}) {
        if (!this.cloudStore || !this.isSignedIn) return;
        const { roster, campaigns, canCreateCampaign } = await this.cloudStore.listRoster();
        this.cloudRoster = roster;
        this.campaigns = campaigns;
        this.canCreateCampaign = Boolean(canCreateCampaign);

        if (activeCharId) {
            this.activeStorage = 'cloud';
            this.roster = this.cloudRoster;
            this.activeCharId = activeCharId;
            return;
        }
        if (this.activeStorage !== 'cloud') return;
        this.roster = this.cloudRoster;

        if (this.activeCharId && !this.cloudRoster.some(r => r.id === this.activeCharId) && !this.missingCharacterRecovery) {
            // Archived on another device, or campaign access was removed.
            // Switch away on a later tick: this can run inside the save
            // chain, and switchCharacter waits for that chain to drain.
            this.missingCharacterRecovery = new Promise(resolve => setTimeout(resolve, 0))
                .then(() => this.leaveMissingCharacter())
                .catch(e => console.error('Failed to leave a removed cloud character', e))
                .finally(() => { this.missingCharacterRecovery = null; });
        }
    }

    async leaveMissingCharacter() {
        const missingId = this.activeCharId;
        if (this.activeStorage !== 'cloud' || !missingId || this.cloudRoster.some(r => r.id === missingId)) return;
        const next = this.cloudRoster[0];
        if (next && await this.switchCharacter(next.id)) {
            if (this.cloudStatus !== 'error') {
                this.setCloudStatus(this.cloudStatus, `That character is no longer available here; switched to ${next.name}.`);
            }
            return;
        }
        await this.flushCloudSave();
        this.state = cloneDefaultState();
        this.activeCharId = null;
        this.cloudUpdatedAt = null;
        this.setCloudStatus('error', 'That character is no longer available here.');
        dispatchAppEvent('readonly-character-change');
    }

    async connectCloud(cloudStore) {
        this.cloudStore = cloudStore;
        this.cloudUser = cloudStore.user;
        this.setCloudStatus('loading', 'Loading cloud characters...');
        await this.refreshCloudRoster();
        if (this.cloudRoster.length > 0) {
            await this.switchCharacter(this.cloudRoster[0].id);
        } else {
            this.setCloudStatus('signed-in', 'Signed in. Create or upload a character to start cloud saves.');
        }
    }

    async disconnectCloud() {
        await this.flushCloudSave();
        this.cloudUser = null;
        this.cloudUpdatedAt = null;
        this.cloudRoster = [];
        this.campaigns = [];
        this.campaignMembers = [];
        this.rollLogs = [];
        this.canCreateCampaign = false;
        this.activeStorage = 'local';
        this.roster = this.localRoster;
        this.activeCharId = this.localActiveCharId;
        this.state = this.loadState(this.activeCharId);
        this.setCloudStatus(this.cloudStore ? 'signed-out' : 'local-only', this.cloudStore ? 'Signed out. Using browser storage.' : 'Cloud save is not configured.');
    }

    // Safe to re-run (a double click, or a retry after a partial failure):
    // each local character remembers the cloud copy it became and the state
    // it had then, and is skipped while unchanged and that copy still
    // exists. A character edited since its upload goes up as a new copy.
    async uploadLocalCharacters() {
        if (!this.cloudStore || !this.isSignedIn || this.uploadingLocalCharacters) return 0;
        this.uploadingLocalCharacters = true;
        const userId = this.cloudUser.id;
        let count = 0;
        let skipped = 0;
        try {
            await this.flushCloudSave();
            await this.refreshCloudRoster();
            const cloudIds = new Set(this.cloudRoster.map(r => r.id));
            const records = this.localStore.loadUploadRecords(userId);
            for (const entry of this.localRoster) {
                const state = this.localStore.loadState(entry.id);
                const fingerprint = stateFingerprint(state);
                const record = records[entry.id];
                if (record && record.fingerprint === fingerprint && cloudIds.has(record.cloudId)) {
                    skipped += 1;
                    continue;
                }
                const name = state.name || entry.name || 'Imported Hero';
                let cloudId;
                try {
                    cloudId = await this.cloudStore.createCharacter(name, state);
                } catch (e) {
                    throw new Error(`Uploaded ${count} character${count === 1 ? '' : 's'}, then failed on ${name}: ${errorMessage(e, 'upload failed')}. Try again to upload the rest.`);
                }
                records[entry.id] = { cloudId, fingerprint };
                try {
                    this.localStore.saveUploadRecords(userId, records);
                } catch (e) {
                    console.error('Failed to record uploaded local character', e);
                }
                count += 1;
            }
        } finally {
            this.uploadingLocalCharacters = false;
            if (count > 0) await this.refreshCloudRoster();
        }
        if (count > 0 && this.cloudRoster.length > 0) await this.switchCharacter(this.cloudRoster[0].id);
        const note = skipped > 0 ? ` ${skipped} already in the cloud.` : '';
        this.setCloudStatus('saved', `${count} local character${count === 1 ? '' : 's'} uploaded.${note}`);
        return count;
    }

    async createCampaign(name) {
        if (!this.cloudStore || !this.isSignedIn) return null;
        if (!this.canCreateCampaign) {
            this.setCloudStatus('error', 'Your account is not allowed to create campaigns.');
            return null;
        }
        const campaign = await this.cloudStore.createCampaign(name);
        await this.refreshCloudRoster();
        this.setCloudStatus('saved', `Campaign "${campaign.name}" created.`);
        return campaign;
    }

    async joinCampaign(inviteCode) {
        if (!this.cloudStore || !this.isSignedIn) return null;
        const membership = await this.cloudStore.joinCampaign(inviteCode);
        await this.refreshCloudRoster();
        this.setCloudStatus('saved', 'Campaign joined.');
        return membership;
    }

    async assignActiveCharacterToCampaign(campaignId) {
        if (!this.cloudStore || this.activeStorage !== 'cloud' || !this.canEditActiveCharacter()) {
            this.markReadOnlyAttempt();
            return;
        }
        const charId = this.activeCharId;
        const cloudStore = this.cloudStore;
        await this.flushCloudSave();
        // Save errors are reported by the queue instead of rejecting the flush.
        // Never turn an unresolved draft/conflict into an acknowledged version.
        if (this.cloudStatus === 'error' || this.hasCloudDraft(charId)) return;

        const run = async () => {
            if (this.cloudStore !== cloudStore || this.activeStorage !== 'cloud'
                || this.activeCharId !== charId || !this.canEditActiveCharacter()
                || this.cloudStatus === 'error') return;
            const previousUpdatedAt = this.cloudUpdatedAt;
            if (!previousUpdatedAt) throw new Error('Reload the cloud character before changing its campaign.');
            this.cloudSaveInFlight = true;
            try {
                const newUpdatedAt = await cloudStore.assignCharacterToCampaign(charId, campaignId || null, {
                    ifUnmodifiedSince: previousUpdatedAt
                });
                if (this.activeCharId === charId && newUpdatedAt) {
                    this.cloudUpdatedAt = newUpdatedAt;
                    this.advanceCloudDraftBase(charId, previousUpdatedAt, newUpdatedAt);
                }
            } finally {
                this.cloudSaveInFlight = false;
            }
            await this.refreshCloudRoster();
            this.setCloudStatus('saved', campaignId ? 'Character assigned to campaign.' : 'Character removed from campaign.');
        };
        // Edits made while assignment is in flight must wait for its new guard.
        this.cloudSaveChain = this.cloudSaveChain
            .then(run)
            .catch(e => this.handleCloudSaveError(e, charId, this.state));
        await this.cloudSaveChain;
    }

    async loadCampaignMembers(campaignId) {
        if (!this.cloudStore || !campaignId) {
            this.campaignMembers = [];
            this.rollLogs = [];
            return [];
        }
        this.campaignMembers = await this.cloudStore.listCampaignMembers(campaignId);
        this.rollLogs = await this.cloudStore.listRecentRollLogs(campaignId);
        return this.campaignMembers;
    }

    async setCampaignMemberRole(campaignId, userId, role) {
        if (!this.cloudStore) return;
        await this.cloudStore.setCampaignMemberRole(campaignId, userId, role);
        await this.loadCampaignMembers(campaignId);
        await this.refreshCloudRoster();
        this.setCloudStatus('saved', 'Campaign role updated.');
    }

    async recordRollLog(log) {
        if (!this.cloudStore || this.activeStorage !== 'cloud' || !this.canEditActiveCharacter()) return;
        const activeEntry = this.activeRosterEntry;
        if (!activeEntry?.id || log?.isTest) return;

        try {
            await this.cloudStore.recordRollLog({
                character_id: activeEntry.id,
                owner_id: this.cloudUser.id,
                campaign_id: activeEntry.campaignId || null,
                character_name: this.state.name || activeEntry.name || 'Hero Name',
                roll_mode: log.mode,
                call_colors: log.callColors || [],
                called_tile_ids: log.calledTileIds || [],
                called_tiles: log.calledTiles || [],
                burn_tile_ids: log.burnTileIds || [],
                hitch_tile_ids: log.hitchTileIds || [],
                total: log.total || 0,
                adds: log.adds || 0,
                flat_bonus: log.flatBonus || 0,
                haywire: Boolean(log.haywire),
                is_test: false,
                rolled_at: new Date().toISOString()
            });
        } catch (e) {
            console.error('Failed to record roll log', e);
            this.setCloudStatus('error', errorMessage(e, 'Roll tracking failed.'));
        }
    }
}
