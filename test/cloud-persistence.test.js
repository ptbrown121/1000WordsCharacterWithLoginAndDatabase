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
