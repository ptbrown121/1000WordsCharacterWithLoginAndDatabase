import { DataManager } from './data.js';
import { PoolEngine } from './pool.js';
import { SpellBuilder } from './spellBuilder.js';
import { renderAll, setDataManager } from './render.js';
import { init as initCards, renderCards } from './ui/cards.js';
import { init as initPool } from './ui/pool.js';
import { init as initResolution } from './ui/resolution.js';
import { init as initModals, openModal as openTileModal } from './ui/modals.js';
import { init as initJournal } from './ui/journal.js';
import { init as initRoster } from './ui/roster.js';
import { init as initStats } from './ui/stats.js';
import { init as initVitals } from './ui/vitals.js';
import { init as initCondition } from './ui/condition.js';
import { init as initCore } from './ui/core.js';
import { init as initTitan } from './ui/titan.js';
import { init as initStranger } from './ui/stranger.js';
import { init as initNpcs } from './ui/npcs.js';
import { init as initNotifications } from './ui/notifications.js';
import { init as initRulesReview } from './ui/rulesReview.js';
import { init as initCloud } from './ui/cloud.js';
import { init as initCampaignFiles } from './ui/campaignFiles.js';
import { init as initLiveSync } from './ui/liveSync.js';
import { init as initAiCreation } from './ui/aiCreation.js';
import { init as initTabs } from './ui/tabs.js';
import { initModalAccessibility } from './ui/modalAccessibility.js';
import { createSupabaseBrowserClient } from './supabaseClient.js';

const dataManager = new DataManager();
const poolEngine = new PoolEngine();
const spellBuilder = new SpellBuilder(dataManager, renderAll);
const supabaseClient = await createSupabaseBrowserClient();

setDataManager(dataManager);

const deps = { dataManager, poolEngine, spellBuilder, renderAll, renderCards, openTileModal, supabaseClient };

initCards(deps);
initPool(deps);
initResolution(deps);
initModals(deps);
initJournal(deps);
initRoster(deps);
initStats(deps);
initVitals(deps);
initCondition(deps);
initCore(deps);
initTitan(deps);
initStranger(deps);
initNpcs(deps);
initNotifications(deps);
initRulesReview(deps);
initAiCreation(deps);
initTabs();
initModalAccessibility();
await initCloud(deps);
initCampaignFiles(deps);
initLiveSync(deps);

renderAll();
