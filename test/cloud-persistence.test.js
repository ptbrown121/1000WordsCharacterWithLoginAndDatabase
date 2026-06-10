import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataManager, LocalCharacterStore, cloneDefaultState } from '../js/data.js';

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
        return JSON.parse(JSON.stringify(this.characters.find(character => character.id === id).state));
    }

    async saveCharacter(id, state) {
        const character = this.characters.find(candidate => candidate.id === id);
        character.state = JSON.parse(JSON.stringify(state));
        character.name = state.name;
    }

    async createCharacter(name, state) {
        const id = `cloud-${this.characters.length + 1}`;
        this.characters.push({ id, name, state: JSON.parse(JSON.stringify(state)) });
        return id;
    }
}

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
});

describe('DataManager cloud behavior', () => {
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

        assert.equal(manager.mergeServerJournalEntries(serverState), true);
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
