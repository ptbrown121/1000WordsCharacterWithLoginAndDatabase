import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataManager, LocalCharacterStore, cloneDefaultState, shouldApplyRemoteCharacterUpdate } from '../js/data.js';
import { CloudSaveConflictError, SupabaseCharacterStore } from '../js/supabaseStore.js';

class MemoryStorage {
    constructor() {
        this.items = new Map();
    }

    getItem(key) {
        return this.items.has(key) ? this.items.get(key) : null;
    }

    setItem(key, value) {
        this.items.set(key, String(value));
    }

    removeItem(key) {
        this.items.delete(key);
    }
}

class FakeCloudStore {
    constructor() {
        this.user = { id: 'user-1', email: 'player@example.com' };
        this.characters = [];
        this.campaigns = [];
    }

    async listRoster() {
        return {
            campaigns: this.campaigns,
            roster: this.characters.map(character => ({
                id: character.id,
                name: character.name,
                source: 'cloud',
                group: 'My Characters',
                isMine: true,
                readOnly: false,
                ownerId: this.user.id,
                campaignId: null,
                campaignName: ''
            }))
        };
    }

    async loadCharacter(id) {
        const character = this.characters.find(candidate => candidate.id === id);
        return {
            state: JSON.parse(JSON.stringify(character.state)),
            updatedAt: character.updatedAt || 't-0'
        };
    }

    async saveCharacter(id, state, { ifUnmodifiedSince = null } = {}) {
        const character = this.characters.find(candidate => candidate.id === id);
        if (ifUnmodifiedSince && (character.updatedAt || 't-0') !== ifUnmodifiedSince) {
            const error = new Error('conflict');
            error.isCloudSaveConflict = true;
            throw error;
        }
        character.state = JSON.parse(JSON.stringify(state));
        character.name = state.name;
        this.saveCount = (this.saveCount || 0) + 1;
        character.updatedAt = `t-${this.saveCount}`;
        return character.updatedAt;
    }

    async createCharacter(name, state) {
        const id = `cloud-${this.characters.length + 1}`;
        this.characters.push({ id, name, state: JSON.parse(JSON.stringify(state)), updatedAt: 't-0' });
        return id;
    }
}

// Minimal chainable stand-in for the supabase-js query builder, recording
// the update payload and filters and resolving select() with `rows`.
function makeUpdateClient(rows) {
    const calls = { update: null, filters: [], selected: null };
    const builder = {
        update(payload) { calls.update = payload; return builder; },
        eq(column, value) { calls.filters.push([column, value]); return builder; },
        select(columns) { calls.selected = columns; return Promise.resolve({ data: rows, error: null }); }
    };
    return { client: { from: () => builder }, calls };
}

describe('SupabaseCharacterStore optimistic concurrency', () => {
    const user = { id: 'user-1', email: 'player@example.com' };

    it('sends the updated_at guard and returns the new server stamp', async () => {
        const { client, calls } = makeUpdateClient([{ updated_at: '2026-06-12T20:00:00+00:00' }]);
        const store = new SupabaseCharacterStore(client, user);

        const newStamp = await store.saveCharacter('char-1', cloneDefaultState(), {
            ifUnmodifiedSince: '2026-06-12T19:00:00+00:00'
        });

        assert.equal(newStamp, '2026-06-12T20:00:00+00:00');
        assert.deepEqual(calls.filters, [
            ['id', 'char-1'],
            ['owner_id', 'user-1'],
            ['updated_at', '2026-06-12T19:00:00+00:00']
        ]);
    });

    it('throws CloudSaveConflictError when the guarded update matches no rows', async () => {
        const { client } = makeUpdateClient([]);
        const store = new SupabaseCharacterStore(client, user);

        await assert.rejects(
            store.saveCharacter('char-1', cloneDefaultState(), { ifUnmodifiedSince: '2026-06-12T19:00:00+00:00' }),
            CloudSaveConflictError
        );
    });

    it('does not treat zero rows as a conflict when saving unguarded (overwrite path)', async () => {
        const { client, calls } = makeUpdateClient([]);
        const store = new SupabaseCharacterStore(client, user);

        const newStamp = await store.saveCharacter('char-1', cloneDefaultState());

        assert.equal(newStamp, null);
        assert.deepEqual(calls.filters, [['id', 'char-1'], ['owner_id', 'user-1']]);
    });

    it('rejects malformed character state before writing it to Supabase', async () => {
        const { client, calls } = makeUpdateClient([{ updated_at: 'unused' }]);
        const store = new SupabaseCharacterStore(client, user);

        await assert.rejects(
            store.saveCharacter('char-1', { name: 'Missing required state fields' }),
            /invalid character state/
        );
        assert.equal(calls.update, null);
    });
});

describe('shouldApplyRemoteCharacterUpdate (live sync policy)', () => {
    const base = { remoteUpdatedAt: 't-2', ownUpdatedAt: 't-1', savePending: false, saveInFlight: false };

    it('applies a genuinely newer remote write when idle', () => {
        assert.equal(shouldApplyRemoteCharacterUpdate(base), true);
    });

    it('ignores the realtime echo of our own save', () => {
        assert.equal(shouldApplyRemoteCharacterUpdate({ ...base, remoteUpdatedAt: 't-1' }), false);
    });

    it('ignores events without a stamp', () => {
        assert.equal(shouldApplyRemoteCharacterUpdate({ ...base, remoteUpdatedAt: null }), false);
    });

    it('defers to the conflict guard while a local save is pending or in flight', () => {
        assert.equal(shouldApplyRemoteCharacterUpdate({ ...base, savePending: true }), false);
        assert.equal(shouldApplyRemoteCharacterUpdate({ ...base, saveInFlight: true }), false);
    });
});

describe('LocalCharacterStore', () => {
    it('loads, saves, and preserves local roster state', () => {
        const storage = new MemoryStorage();
        const store = new LocalCharacterStore(storage);
        const { roster, activeCharId } = store.loadRoster();
        const state = cloneDefaultState();
        state.name = 'Saved Hero';

        store.saveState(activeCharId, state);
        store.saveRoster([{ id: activeCharId, name: 'Saved Hero' }], activeCharId);

        assert.equal(roster.length, 1);
        assert.equal(store.loadState(activeCharId).name, 'Saved Hero');
        assert.deepEqual(JSON.parse(storage.getItem('1000words_roster')), [{ id: activeCharId, name: 'Saved Hero' }]);
    });

    it('keeps cloud drafts isolated by user and clears only the acknowledged revision', () => {
        const store = new LocalCharacterStore(new MemoryStorage());
        const first = store.saveCloudDraft('user-1', 'cloud-1', { name: 'First edit' }, 't-0');
        const second = store.saveCloudDraft('user-1', 'cloud-1', { name: 'Newer edit' }, 't-0');

        assert.equal(store.loadCloudDraft('user-2', 'cloud-1'), null);
        assert.equal(store.deleteCloudDraft('user-1', 'cloud-1', first.revision), false);
        assert.equal(store.loadCloudDraft('user-1', 'cloud-1').revision, second.revision);

        assert.equal(store.advanceCloudDraftBase('user-1', 'cloud-1', 't-0', 't-1'), true);
        assert.equal(store.loadCloudDraft('user-1', 'cloud-1').baseUpdatedAt, 't-1');
        assert.equal(store.deleteCloudDraft('user-1', 'cloud-1', second.revision), true);
        assert.equal(store.loadCloudDraft('user-1', 'cloud-1'), null);
    });
});

describe('DataManager cloud behavior', () => {
    it('writes cloud edits to a browser draft immediately and recovers them after a reload', async () => {
        const storage = new MemoryStorage();
        const cloud = new FakeCloudStore();
        const state = cloneDefaultState();
        state.name = 'Cloud Hero';
        cloud.characters.push({ id: 'cloud-1', name: state.name, state: JSON.parse(JSON.stringify(state)), updatedAt: 't-0' });

        const firstManager = new DataManager({
            localStore: new LocalCharacterStore(storage),
            saveDebounceMs: 60_000
        });
        await firstManager.connectCloud(cloud);
        firstManager.updateName('Recovered Hero');

        const storedDraft = firstManager.loadCloudDraft('cloud-1');
        assert.equal(storedDraft.state.name, 'Recovered Hero');
        assert.equal(cloud.characters[0].state.name, 'Cloud Hero');

        // Simulate the page disappearing before its debounce timer fires.
        clearTimeout(firstManager.pendingSaveTimer);
        firstManager.pendingSaveTimer = null;

        const reloadedManager = new DataManager({
            localStore: new LocalCharacterStore(storage),
            saveDebounceMs: 60_000
        });
        await reloadedManager.connectCloud(cloud);
        assert.equal(reloadedManager.state.name, 'Recovered Hero');
        await reloadedManager.cloudSaveChain;

        assert.equal(cloud.characters[0].state.name, 'Recovered Hero');
        assert.equal(reloadedManager.loadCloudDraft('cloud-1'), null);
    });

    it('keeps a failed cloud save as a recoverable browser draft', async () => {
        const storage = new MemoryStorage();
        const cloud = new FakeCloudStore();
        const state = cloneDefaultState();
        cloud.characters.push({ id: 'cloud-1', name: state.name, state, updatedAt: 't-0' });
        cloud.saveCharacter = async () => { throw new Error('offline'); };

        const manager = new DataManager({
            localStore: new LocalCharacterStore(storage),
            saveDebounceMs: 0
        });
        await manager.connectCloud(cloud);
        manager.updateName('Offline Edit');
        await new Promise(resolve => setTimeout(resolve, 10));
        await manager.cloudSaveChain;

        assert.equal(manager.cloudStatus, 'error');
        assert.equal(manager.loadCloudDraft('cloud-1').state.name, 'Offline Edit');
    });

    it('surfaces recovered drafts as conflicts when the cloud changed meanwhile', async () => {
        const events = [];
        const previousWindow = globalThis.window;
        globalThis.window = {
            dispatchEvent(event) { events.push(event); return true; },
            addEventListener() {},
            removeEventListener() {}
        };

        try {
            const storage = new MemoryStorage();
            const localStore = new LocalCharacterStore(storage);
            const draftState = cloneDefaultState();
            draftState.name = 'Unsaved Browser Edit';
            localStore.saveCloudDraft('user-1', 'cloud-1', draftState, 't-0');

            const cloud = new FakeCloudStore();
            const remoteState = cloneDefaultState();
            remoteState.name = 'Newer Cloud Edit';
            cloud.characters.push({ id: 'cloud-1', name: remoteState.name, state: remoteState, updatedAt: 't-1' });

            const manager = new DataManager({ localStore });
            await manager.connectCloud(cloud);

            assert.equal(manager.state.name, 'Unsaved Browser Edit');
            assert.equal(cloud.characters[0].state.name, 'Newer Cloud Edit');
            assert.equal(manager.cloudStatus, 'error');
            const conflict = events.find(event => event.type === 'cloud-save-conflict');
            assert.equal(conflict.detail.state.name, 'Unsaved Browser Edit');

            await manager.resolveCloudConflictByReloading('cloud-1');
            assert.equal(manager.state.name, 'Newer Cloud Edit');
            assert.equal(manager.loadCloudDraft('cloud-1'), null);
        } finally {
            globalThis.window = previousWindow;
        }
    });

    it('blocks writes while viewing a read-only campaign character', () => {
        const manager = new DataManager({ localStore: new LocalCharacterStore(new MemoryStorage()) });
        manager.activeStorage = 'cloud';
        manager.cloudRoster = [{
            id: 'campaign-character',
            name: 'Other Player',
            source: 'cloud',
            readOnly: true,
            isMine: false
        }];
        manager.roster = manager.cloudRoster;
        manager.activeCharId = 'campaign-character';
        manager.state = cloneDefaultState();
        manager.state.name = 'Other Player';

        manager.updateName('Changed');
        manager.addTile({ name: 'Should Not Save', colors: ['Red'], dice: ['d4'], tags: [] });

        assert.equal(manager.state.name, 'Other Player');
        assert.equal(manager.state.tiles.length, 0);
    });

    it('merges server-appended journal entries without dropping in-flight local edits', async () => {
        const cloud = new FakeCloudStore();
        const manager = new DataManager({
            localStore: new LocalCharacterStore(new MemoryStorage()),
            cloudStore: cloud,
            saveDebounceMs: 0
        });
        const state = cloneDefaultState();
        state.name = 'Cloud Hero';
        state.journal = [{ id: 'local-entry', title: 'Session 1', content: 'notes' }];
        cloud.characters.push({ id: 'cloud-1', name: 'Cloud Hero', state: JSON.parse(JSON.stringify(state)) });

        manager.activeStorage = 'cloud';
        manager.cloudRoster = [{ id: 'cloud-1', name: 'Cloud Hero', source: 'cloud', readOnly: false, isMine: true }];
        manager.roster = manager.cloudRoster;
        manager.activeCharId = 'cloud-1';
        manager.state = state;

        // Local edit made while the accept-summary request was in flight: the
        // server's returned state does not contain this tile.
        manager.state.tiles.push({ id: 'tile-1', name: 'New Tile', colors: ['Red'], dice: ['d4'], tags: [] });

        const serverState = JSON.parse(JSON.stringify(state));
        serverState.tiles = [];
        serverState.journal = [
            { id: 'local-entry', title: 'Session 1', content: 'notes' },
            { id: 'ai-entry', title: 'AI Scene: Origin', content: 'The scene summary.' }
        ];
        cloud.characters[0].state = JSON.parse(JSON.stringify(serverState));
        cloud.characters[0].updatedAt = 't-server-accept';

        assert.equal(manager.mergeServerJournalEntries(serverState, 't-server-accept'), true);
        assert.equal(manager.cloudUpdatedAt, 't-server-accept');
        assert.deepEqual(manager.state.journal.map(entry => entry.id), ['local-entry', 'ai-entry']);
        assert.equal(manager.state.tiles.length, 1);

        // The merge schedules a cloud save, so the merged state converges server-side.
        await new Promise(resolve => setTimeout(resolve, 10));
        const saved = cloud.characters.find(character => character.id === 'cloud-1').state;
        assert.deepEqual(saved.journal.map(entry => entry.id), ['local-entry', 'ai-entry']);
        assert.equal(saved.tiles.length, 1);

        // Re-merging the same server state is a no-op.
        assert.equal(manager.mergeServerJournalEntries(serverState), false);
        assert.equal(manager.state.journal.length, 2);
    });

    it('does not merge server journal entries into read-only characters', () => {
        const manager = new DataManager({ localStore: new LocalCharacterStore(new MemoryStorage()) });
        manager.activeStorage = 'cloud';
        manager.cloudRoster = [{ id: 'campaign-character', name: 'Other Player', source: 'cloud', readOnly: true, isMine: false }];
        manager.roster = manager.cloudRoster;
        manager.activeCharId = 'campaign-character';
        manager.state = cloneDefaultState();

        const merged = manager.mergeServerJournalEntries({
            journal: [{ id: 'ai-entry', title: 'AI Scene', content: 'text' }]
        });

        assert.equal(merged, false);
        assert.equal((manager.state.journal || []).length, 0);
    });

    it('detects a concurrent edit, keeps the remote copy, and supports both resolutions', async () => {
        const events = [];
        const previousWindow = globalThis.window;
        globalThis.window = {
            dispatchEvent(event) { events.push(event); return true; },
            addEventListener() {},
            removeEventListener() {}
        };

        try {
            const cloud = new FakeCloudStore();
            const manager = new DataManager({
                localStore: new LocalCharacterStore(new MemoryStorage()),
                cloudStore: cloud,
                saveDebounceMs: 0
            });
            const state = cloneDefaultState();
            state.name = 'Cloud Hero';
            cloud.characters.push({ id: 'cloud-1', name: 'Cloud Hero', state: JSON.parse(JSON.stringify(state)), updatedAt: 't-0' });

            manager.activeStorage = 'cloud';
            manager.cloudRoster = [{ id: 'cloud-1', name: 'Cloud Hero', source: 'cloud', readOnly: false, isMine: true }];
            manager.roster = manager.cloudRoster;
            manager.activeCharId = 'cloud-1';
            manager.state = JSON.parse(JSON.stringify(state));
            manager.cloudUpdatedAt = 't-0';

            // Another device saves first: the server moves past our t-0.
            await cloud.saveCharacter('cloud-1', { ...state, name: 'Renamed Elsewhere' });

            // Our guarded save must NOT clobber it, and must raise the event.
            manager.state.name = 'Local Edit';
            await manager.queueCloudSave('cloud-1', JSON.parse(JSON.stringify(manager.state)));

            assert.equal(cloud.characters[0].state.name, 'Renamed Elsewhere');
            const conflict = events.find(event => event.type === 'cloud-save-conflict');
            assert.ok(conflict, 'expected a cloud-save-conflict event');
            assert.equal(conflict.detail.charId, 'cloud-1');
            assert.equal(conflict.detail.state.name, 'Local Edit');

            // Resolution A: reload the newer version.
            await manager.resolveCloudConflictByReloading('cloud-1');
            assert.equal(manager.state.name, 'Renamed Elsewhere');
            assert.equal(manager.cloudUpdatedAt, cloud.characters[0].updatedAt);

            // After reloading, a normal guarded save works again.
            manager.state.name = 'Post-Reload Edit';
            await manager.queueCloudSave('cloud-1', JSON.parse(JSON.stringify(manager.state)));
            assert.equal(cloud.characters[0].state.name, 'Post-Reload Edit');

            // Resolution B: deliberate overwrite ignores the guard.
            await cloud.saveCharacter('cloud-1', { ...state, name: 'Renamed Again Elsewhere' });
            await manager.resolveCloudConflictByOverwriting('cloud-1', { ...state, name: 'Forced Local Copy' });
            assert.equal(cloud.characters[0].state.name, 'Forced Local Copy');
            assert.equal(manager.cloudUpdatedAt, cloud.characters[0].updatedAt);
        } finally {
            globalThis.window = previousWindow;
        }
    });

    it('uploads local characters to cloud without deleting browser saves', async () => {
        const storage = new MemoryStorage();
        const manager = new DataManager({ localStore: new LocalCharacterStore(storage) });
        await manager.createNewCharacter('Second Local');

        const cloud = new FakeCloudStore();
        await manager.connectCloud(cloud);
        const uploaded = await manager.uploadLocalCharacters();

        assert.equal(uploaded, 2);
        assert.equal(cloud.characters.length, 2);
        assert.ok(storage.getItem('1000words_roster'));
        const savedLocal = manager.localRoster.find(character => character.name === 'Second Local');
        assert.ok(storage.getItem(`1000words_state_${savedLocal.id}`));
    });
});
