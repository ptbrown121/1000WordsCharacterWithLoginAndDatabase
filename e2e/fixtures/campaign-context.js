// Synthetic GM session for campaign UI checks; never imported by the app.
import { init as initCloud, renderCloudControls } from '../../js/ui/cloud.js';
import { init as initFiles, renderCampaignFiles } from '../../js/ui/campaignFiles.js';
import { init as initAi, renderAiCreation } from '../../js/ui/aiCreation.js';
import { init as initTabs } from '../../js/ui/tabs.js';

const session = { user: { id: 'preview-gm', email: 'gm@example.test' }, access_token: 'preview-only' };
const manager = {
    isSignedIn: true,
    cloudUser: session.user,
    campaigns: [
        { id: 'alpha', name: 'TestCampaign', role: 'gm', inviteCode: 'ALPHA' },
        { id: 'beta', name: 'Wormholes Alpha', role: 'gm', inviteCode: 'BETA' },
        { id: 'player', name: 'Player campaign', role: 'player', inviteCode: 'PLAYER' }
    ],
    activeRosterEntry: { name: 'Preview Hero', source: 'local', campaignId: 'player', campaignName: 'Player campaign' },
    state: { name: 'Preview Hero' },
    campaignMembers: [],
    rollLogs: [],
    canCreateCampaign: false,
    hasLocalCharacters: false,
    canEditActiveCharacter: () => true,
    connectCloud: async () => {},
    setCloudStatus(_status, message) {
        this.cloudMessage = message;
        globalThis.dispatchEvent(new Event('cloud-status-change'));
    },
    async loadCampaignMembers() {
        this.campaignMembers = [{ userId: 'preview-gm', email: 'gm@example.test', role: 'gm' }];
    },
    cloudStore: {
        listCampaignFiles: async () => [],
        async uploadCampaignFile(campaignId, file, title) {
            const response = await fetch('/api/preview/files', {
                method: 'POST',
                body: JSON.stringify({ campaignId, title: title || file.name, fileName: file.name })
            });
            return response.json();
        }
    }
};
const client = { auth: { getSession: async () => ({ data: { session } }), onAuthStateChange() {} } };
const renderAll = () => {
    renderCloudControls();
    renderAiCreation();
    renderCampaignFiles();
};
const deps = { dataManager: manager, supabaseClient: client, renderAll };
initTabs();
initAi(deps);
await initCloud(deps);
initFiles(deps);
renderAll();
