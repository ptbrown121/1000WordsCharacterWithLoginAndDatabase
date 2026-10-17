// Synthetic account with the real persistence manager; no Supabase requests.
import { DataManager } from '../../js/data.js';
import { els } from '../../js/els.js';
import { init as initCloud, renderCloudControls } from '../../js/ui/cloud.js';
import { init as initRoster, renderRosterSelect } from '../../js/ui/roster.js';
import { init as initTabs } from '../../js/ui/tabs.js';

export const manager = new DataManager({ saveDebounceMs: 10 });
const user = { id: 'save-status-player', email: 'player@example.test' };
const rows = new Map();
let campaigns = [];
let revision = 0;
let uploadFailure = false;
let saveFailure = false;
let releaseSave = null;
let saveGate = Promise.resolve();
const timestamp = () => new Date(1_800_000_000_000 + revision++).toISOString();

const store = {
    user,
    async listRoster() {
        return {
            roster: [...rows].map(([id, row]) => ({
                id, name: row.state.name, source: 'cloud', isMine: true, readOnly: false,
                campaignId: row.campaignId,
                campaignName: campaigns.find(campaign => campaign.id === row.campaignId)?.name || ''
            })),
            campaigns,
            canCreateCampaign: false
        };
    },
    async createCharacter(_name, state) {
        if (uploadFailure) throw new Error('Upload unavailable');
        const id = `cloud-${rows.size}`;
        rows.set(id, { state: structuredClone(state), updatedAt: timestamp(), campaignId: null });
        return id;
    },
    async loadCharacter(id) {
        return structuredClone(rows.get(id));
    },
    async saveCharacter(id, state) {
        await saveGate;
        if (saveFailure) throw new Error('Connection lost');
        const row = rows.get(id);
        row.state = structuredClone(state);
        row.updatedAt = timestamp();
        return row.updatedAt;
    },
    async joinCampaign() {
        campaigns = [{ id: 'wormholes', name: 'Wormholes Alpha', role: 'player' }];
        return campaigns[0];
    },
    async assignCharacterToCampaign(id, campaignId) {
        const row = rows.get(id);
        row.campaignId = campaignId;
        row.updatedAt = timestamp();
        return row.updatedAt;
    }
};

const connectCloud = manager.connectCloud.bind(manager);
manager.connectCloud = () => connectCloud(store);
const renderAll = () => {
    els.charName.value = manager.state.name;
    renderRosterSelect();
    renderCloudControls();
};
const client = {
    auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange() {}
    }
};
initTabs();
initRoster({ dataManager: manager, renderAll });
await initCloud({ dataManager: manager, supabaseClient: client, renderAll });
renderAll();

export async function signIn() {
    await manager.connectCloud(store);
    renderAll();
}

export function failUpload(value) {
    uploadFailure = value;
}

export function holdSave() {
    saveGate = new Promise(resolve => { releaseSave = resolve; });
}

export function finishSave(fail = false) {
    saveFailure = fail;
    releaseSave?.();
    saveGate = Promise.resolve();
}

export async function retrySave() {
    saveFailure = false;
    manager.saveState();
    await manager.flushCloudSave();
    renderAll();
}
