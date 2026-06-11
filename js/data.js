import { normalizeActiveCrits } from './status-rules.js';

export const STAT_COLORS = {
    'BODY': 'Red',
    'POWER': 'Orange',
    'SOUL': 'Yellow',
    'FOCUS': 'Green',
    'MIND': 'Blue',
    'SPEED': 'Purple'
};

export const COLOR_HEX = {
    'Red': '#ff3333',
    'Orange': '#ff9933',
    'Yellow': '#ffcc00',
    'Green': '#33cc33',
    'Blue': '#3399ff',
    'Purple': '#9933ff',
    'Qi': '#f7f3d0',
    'Id': '#5a4a69'
};

export const VALID_DICE = new Set(['d3', 'd4', 'd6', 'd8', 'd10', 'd12', 'd14', 'd16']);

const EXOTIC_SKILL_DATA = {
    'arcana-twist': { system: 'Arcana', specialty: 'Twist', label: 'Arcana: Twist', baseXp: 2 },
    'arcana-forge': { system: 'Arcana', specialty: 'Forge', label: 'Arcana: Forge', baseXp: 2 },
    'arcana-augur': { system: 'Arcana', specialty: 'Augur', label: 'Arcana: Augur', baseXp: 2 },
    bestial: { system: 'Stranger', specialty: 'Bestial', label: 'Stranger: Bestial', baseXp: 2 },
    celestial: { system: 'Stranger', specialty: 'Celestial', label: 'Stranger: Celestial', baseXp: 2 },
    cyber: { system: 'Cyber', specialty: 'Cyber', label: 'Cyber', baseXp: 2 }
};

function normalizeStoredExoticSkill(value) {
    if (!value) return null;
    const id = typeof value === 'string' ? value : value.id || value.type || '';
    const option = EXOTIC_SKILL_DATA[id];
    return option ? { id, ...option } : null;
}

/**
 * In-place migration: ensure tile.tags is a string[] of trimmed tag strings.
 * Legacy saves stored it as a comma-separated string; SpellBuilder once
 * stored it as a list of {name, xp} objects. This normalizer is idempotent
 * and is called both when loading from localStorage and when importing JSON.
 *
 * Also strips a known-bad tag pattern: spells saved before the
 * "preview-as-tag" bug fix have the auto-generated description sentence
 * (always starting with "Effect:") incorrectly appended to tile.tags. We
 * detect those by `isSpell && tag.startsWith('Effect:')` and drop them.
 * Real player-authored tags do not begin with "Effect:" - the rulebook's
 * tag taxonomy does not include such a tag.
 */
export function normalizeTileTags(tile) {
    if (!tile || typeof tile !== 'object') return;
    const raw = tile.tags;

    if (raw == null || raw === '') {
        tile.tags = [];
        return;
    }

    const items = Array.isArray(raw) ? raw : String(raw).split(',');
    const isSpell = Boolean(tile.isSpell);
    tile.tags = items
        .map(item => {
            if (item && typeof item === 'object') return String(item.name || '').trim();
            return String(item || '').trim();
        })
        .filter(Boolean)
        .filter(tag => !(isSpell && tag.startsWith('Effect:')));
}

function normalizeNumber(value, fallback = 0) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

const NORMAL_COLORS = new Set(['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple']);
const RESOURCE_KEYS = new Set(['hp', 'en', 'rx']);

function normalizeShadowKind(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'qi' || normalized === 'white') return 'Qi';
    if (normalized === 'id' || normalized === 'black') return 'Id';
    return '';
}

function normalizeResourceKey(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['hp', 'health', 'red', 'orange'].includes(normalized)) return 'hp';
    if (['en', 'energy', 'green', 'yellow'].includes(normalized)) return 'en';
    if (['rx', 'reflex', 'blue', 'purple'].includes(normalized)) return 'rx';
    return RESOURCE_KEYS.has(normalized) ? normalized : '';
}

function normalizeTileBox(box) {
    if (!box || typeof box !== 'object') return null;

    const shadowKind = normalizeShadowKind(box.kind || box.shadowKind || box.type);
    if (shadowKind) {
        return {
            type: 'shadow',
            kind: shadowKind,
            resource: normalizeResourceKey(box.resource || box.normalResource || box.contributesTo)
        };
    }

    const color = String(box.color || box.type || '').trim();
    return NORMAL_COLORS.has(color) ? { type: 'color', color } : null;
}

function boxesFromLegacyColors(colors = []) {
    return colors.map(color => {
        const shadowKind = normalizeShadowKind(color);
        if (shadowKind) return { type: 'shadow', kind: shadowKind, resource: '' };
        return NORMAL_COLORS.has(color) ? { type: 'color', color } : null;
    }).filter(Boolean).slice(0, 2);
}

function colorsFromBoxes(boxes = []) {
    return boxes.map(box => box.type === 'shadow' ? box.kind : box.color);
}

function dispatchAppEvent(name, detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

function normalizeTileMetadata(tile) {
    if (!tile || typeof tile !== 'object') return;

    if (tile.isBurnt === undefined) tile.isBurnt = false;
    if (tile.isBuried === undefined) tile.isBuried = false;
    const rawBoxes = Array.isArray(tile.boxes) && tile.boxes.length > 0
        ? tile.boxes.map(normalizeTileBox).filter(Boolean)
        : boxesFromLegacyColors(tile.colors || []);
    tile.boxes = rawBoxes.slice(0, 2);
    tile.colors = colorsFromBoxes(tile.boxes);
    tile.exoticSkill = tile.type === 'Skill' ? normalizeStoredExoticSkill(tile.exoticSkill) : null;
    tile.gearBroken = tile.type === 'Gear' ? Boolean(tile.gearBroken || tile.isGearBroken) : false;
    if (tile.gearSubtype === undefined && tile.type === 'Gear') {
        tile.gearSubtype = tile.ammo ? 'Ammo' : tile.weapon ? 'Weapon' : tile.armorType ? 'Armor' : 'Custom';
    }

    if (tile.type === 'Gear' && tile.gearSubtype === 'Ammo') {
        const ammo = tile.ammo || {};
        const maxSupply = Math.max(0, normalizeNumber(ammo.maxSupply ?? ammo.supplyMax, 1));
        const currentSupply = Math.min(maxSupply, Math.max(0, normalizeNumber(ammo.currentSupply, maxSupply)));
        tile.ammo = {
            targetTileId: String(ammo.targetTileId || ''),
            targetName: String(ammo.targetName || ''),
            currentSupply,
            maxSupply,
            replacesTag: String(ammo.replacesTag || 'Reload').trim()
        };
        tile.dice = [];
        if (!Array.isArray(tile.colors)) tile.colors = [];
        if (!Array.isArray(tile.boxes)) tile.boxes = [];
    }

    normalizeTileTags(tile);
}

/**
 * Effective max for a vital resource: base max + permanent bonus + temporary bonus.
 *
 * `key` is the resource prefix used in state: 'hp' | 'en' | 'rx' | 'sh'.
 * For HP/EN/RX, the base is `${key}Max`. SH has no stored max - its base is
 * derived from the tile mosaic at call time, so callers pass it via the
 * optional `baseOverride` argument.
 *
 * Always returns a finite integer, defaulting any missing/non-numeric piece
 * to 0. This is the single source of truth for the (max + perm + temp) sum
 * that previously appeared inline in render.js, vitals.js Rest, and vitals.js
 * Auto-Calculate Vitals.
 */
export function getEffectiveMax(state, key, baseOverride) {
    const toInt = (v) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : 0;
    };
    const base = baseOverride !== undefined ? toInt(baseOverride) : toInt(state?.[`${key}Max`]);
    const perm = toInt(state?.[`${key}Perm`]);
    const temp = toInt(state?.[`${key}Temp`]);
    return base + perm + temp;
}

function inferShowOptionalStats(state) {
    return Boolean((state?.tiles || []).some(tile =>
        (tile.colors || []).some(color => ['Qi', 'Id', 'Black', 'White'].includes(color))
    ));
}

export const DEFAULT_STATE = {
    name: 'Hero Name',
    xpEarned: 75,
    xpSpentAdjustment: 0,
    storyPoints: 0,
    storyPointsSpent: 0,
    storyPointsEarned: 0,
    hp: 0,
    hpMax: 0,
    hpTemp: 0,
    hpPerm: 0,
    en: 0,
    enMax: 0,
    enTemp: 0,
    enPerm: 0,
    rx: 0,
    rxMax: 0,
    rxTemp: 0,
    rxPerm: 0,
    sh: 0,
    shTemp: 0,
    shPerm: 0,
    core: 0,     // current Cyber Core; max derives from Cyber-tagged tiles
    coreTemp: 0,
    corePerm: 0,
    aberration: 0,
    legacyShadowWarning: false,
    gmOverride: false,
    showOptionalStats: false,
    activeCrits: {}, // { critId: count } - see CRIT_DASHBOARD in status-rules.js
    pressCount: 0,   // per-fight Press/Haywire counter (p.37); reset when the fight ends
    stats: {
        'BODY': '',
        'POWER': '',
        'SOUL': '',
        'FOCUS': '',
        'MIND': '',
        'SPEED': ''
    },
    tiles: [], // { id, name, colors: [], dice: [], tags: '', xpCost: 0 }
    journal: [] // { id, title, content }
};

export function cloneDefaultState() {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

export function normalizeStateForShadowRules(state) {
    if (!state || typeof state !== 'object') return state;

    if (state.storyPointsEarned === undefined) {
        state.storyPointsEarned = normalizeNumber(state.storyPoints, 0);
    } else {
        state.storyPointsEarned = normalizeNumber(state.storyPointsEarned, 0);
    }
    state.storyPointsSpent = normalizeNumber(state.storyPointsSpent, 0);
    state.storyPoints = state.storyPointsEarned;
    state.xpSpentAdjustment = normalizeNumber(state.xpSpentAdjustment, 0);

    const stats = state.stats || {};
    const hasLegacyStatData = Boolean(stats.Id || stats.Qi);
    state.legacyShadowWarning = Boolean(state.legacyShadowWarning || hasLegacyStatData);
    state.stats = {
        BODY: stats.BODY || '',
        POWER: stats.POWER || '',
        SOUL: stats.SOUL || '',
        FOCUS: stats.FOCUS || '',
        MIND: stats.MIND || '',
        SPEED: stats.SPEED || ''
    };
    state.aberration = normalizeNumber(state.aberration, 0);
    state.activeCrits = normalizeActiveCrits(state.activeCrits);
    state.pressCount = Math.max(0, normalizeNumber(state.pressCount, 0));
    if (state.sh === undefined) state.sh = 0;
    if (state.shTemp === undefined) state.shTemp = 0;
    if (state.shPerm === undefined) state.shPerm = 0;
    state.core = Math.max(0, normalizeNumber(state.core, 0));
    state.coreTemp = normalizeNumber(state.coreTemp, 0);
    state.corePerm = normalizeNumber(state.corePerm, 0);
    if (!Array.isArray(state.tiles)) state.tiles = [];
    state.tiles.forEach(normalizeTileMetadata);
    return state;
}

export function reorderTilesByVisibleMove(allTiles = [], visibleTileIds = [], draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return allTiles;
    const visibleIdSet = new Set(visibleTileIds);
    if (!visibleIdSet.has(draggedId) || !visibleIdSet.has(targetId)) return allTiles;

    const visibleOrder = visibleTileIds.filter(id => allTiles.some(tile => tile.id === id));
    const fromIndex = visibleOrder.indexOf(draggedId);
    const toIndex = visibleOrder.indexOf(targetId);
    if (fromIndex === -1 || toIndex === -1) return allTiles;

    const [dragged] = visibleOrder.splice(fromIndex, 1);
    visibleOrder.splice(toIndex, 0, dragged);

    const tileById = new Map(allTiles.map(tile => [tile.id, tile]));
    const reorderedVisibleTiles = visibleOrder
        .map(id => tileById.get(id))
        .filter(Boolean);
    let visibleIndex = 0;

    return allTiles.map(tile => {
        if (!visibleIdSet.has(tile.id)) return tile;
        return reorderedVisibleTiles[visibleIndex++] || tile;
    });
}

function mergeStateWithDefaults(state) {
    const merged = state && typeof state === 'object' ? state : {};
    const hadShowOptionalStats = merged.showOptionalStats !== undefined;
    for (const key of Object.keys(DEFAULT_STATE)) {
        if (merged[key] === undefined) {
            merged[key] = JSON.parse(JSON.stringify(DEFAULT_STATE[key]));
        }
    }
    if (!hadShowOptionalStats) merged.showOptionalStats = inferShowOptionalStats(merged);
    return normalizeStateForShadowRules(merged);
}

export function normalizeImportedState(newState) {
    if (!newState || typeof newState !== 'object' || !newState.stats || !newState.tiles) return null;
    return mergeStateWithDefaults(newState);
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

    scheduleCloudSave() {
        if (!this.cloudStore || this.activeStorage !== 'cloud') return;
        clearTimeout(this.pendingSaveTimer);
        this.setCloudStatus('saving', 'Saving to cloud...');
        const charId = this.activeCharId;
        const state = JSON.parse(JSON.stringify(this.state));
        this.pendingSaveTimer = setTimeout(async () => {
            try {
                await this.cloudStore.saveCharacter(charId, state);
                await this.refreshCloudRoster({ keepActive: true });
                this.setCloudStatus('saved', 'Cloud save complete.');
            } catch (e) {
                console.error('Failed to save cloud character', e);
                this.setCloudStatus('error', e.message || 'Cloud save failed.');
            }
        }, this.saveDebounceMs);
    }

    async flushCloudSave() {
        if (!this.pendingSaveTimer || !this.cloudStore || this.activeStorage !== 'cloud') return;
        clearTimeout(this.pendingSaveTimer);
        this.pendingSaveTimer = null;
        if (!this.canEditActiveCharacter()) return;
        await this.cloudStore.saveCharacter(this.activeCharId, this.state);
        await this.refreshCloudRoster({ keepActive: true });
        this.setCloudStatus('saved', 'Cloud save complete.');
    }

    // Folds journal entries a server route appended into the local state without
    // replacing it wholesale, so edits made while the request was in flight
    // survive. The follow-up saveState() re-syncs the merged state to the cloud.
    mergeServerJournalEntries(serverState) {
        if (!this.canEditActiveCharacter()) return false;
        const serverJournal = Array.isArray(serverState?.journal) ? serverState.journal : [];
        if (serverJournal.length === 0) return false;

        const journal = Array.isArray(this.state.journal) ? this.state.journal : [];
        const knownIds = new Set(journal.map(entry => entry?.id).filter(Boolean));
        const added = serverJournal.filter(entry => entry?.id && !knownIds.has(entry.id));
        if (added.length === 0) return false;

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

    async switchCharacter(id) {
        const cloudEntry = this.cloudRoster.find(r => r.id === id);
        if (cloudEntry) {
            await this.flushCloudSave();
            this.activeStorage = 'cloud';
            this.roster = this.cloudRoster;
            this.activeCharId = id;
            this.state = await this.cloudStore.loadCharacter(id);
            this.setCloudStatus(cloudEntry.readOnly ? 'read-only' : 'saved', cloudEntry.readOnly ? 'Viewing read-only campaign character.' : 'Cloud character loaded.');
            dispatchAppEvent('readonly-character-change');
            return;
        }

        if (this.localRoster.find(r => r.id === id)) {
            await this.flushCloudSave();
            this.activeStorage = 'local';
            this.roster = this.localRoster;
            this.activeCharId = id;
            this.localActiveCharId = id;
            this.localStore.saveRoster(this.localRoster, this.localActiveCharId);
            this.state = this.localStore.loadState(this.activeCharId);
            dispatchAppEvent('readonly-character-change');
        }
    }

    async createNewCharacter(name = "Hero Name") {
        const state = cloneDefaultState();
        state.name = name;

        if (this.isSignedIn && this.cloudStore) {
            const charId = await this.cloudStore.createCharacter(name, state);
            await this.refreshCloudRoster({ activeCharId: charId });
            this.state = await this.cloudStore.loadCharacter(charId);
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
            await this.cloudStore.archiveCharacter(this.activeCharId);
            await this.refreshCloudRoster();
            if (this.roster.length > 0) {
                await this.switchCharacter(this.roster[0].id);
            } else {
                this.state = cloneDefaultState();
                this.activeCharId = null;
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
                    const charId = await this.cloudStore.createCharacter(name, newState);
                    await this.refreshCloudRoster({ activeCharId: charId });
                    this.state = await this.cloudStore.loadCharacter(charId);
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

    async refreshCloudRoster({ activeCharId = null, keepActive = false } = {}) {
        if (!this.cloudStore || !this.isSignedIn) return;
        const { roster, campaigns, canCreateCampaign } = await this.cloudStore.listRoster();
        this.cloudRoster = roster;
        this.campaigns = campaigns;
        this.canCreateCampaign = Boolean(canCreateCampaign);

        if (this.activeStorage !== 'cloud' && !activeCharId) return;

        this.activeStorage = 'cloud';
        this.roster = this.cloudRoster;
        const preferredId = activeCharId || (keepActive ? this.activeCharId : null);
        this.activeCharId = this.roster.find(r => r.id === preferredId)?.id || this.roster[0]?.id || null;
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

    async uploadLocalCharacters() {
        if (!this.cloudStore || !this.isSignedIn) return 0;
        await this.flushCloudSave();
        let count = 0;
        for (const entry of this.localRoster) {
            const state = this.localStore.loadState(entry.id);
            const name = state.name || entry.name || 'Imported Hero';
            await this.cloudStore.createCharacter(name, state);
            count += 1;
        }
        await this.refreshCloudRoster();
        if (this.cloudRoster.length > 0) await this.switchCharacter(this.cloudRoster[0].id);
        this.setCloudStatus('saved', `${count} local character${count === 1 ? '' : 's'} uploaded.`);
        return count;
    }

    async createCampaign(name) {
        if (!this.cloudStore || !this.isSignedIn) return null;
        if (!this.canCreateCampaign) {
            this.setCloudStatus('error', 'Your account is not allowed to create campaigns.');
            return null;
        }
        const campaign = await this.cloudStore.createCampaign(name);
        await this.refreshCloudRoster({ keepActive: true });
        this.setCloudStatus('saved', `Campaign "${campaign.name}" created.`);
        return campaign;
    }

    async joinCampaign(inviteCode) {
        if (!this.cloudStore || !this.isSignedIn) return null;
        const membership = await this.cloudStore.joinCampaign(inviteCode);
        await this.refreshCloudRoster({ keepActive: true });
        this.setCloudStatus('saved', 'Campaign joined.');
        return membership;
    }

    async assignActiveCharacterToCampaign(campaignId) {
        if (!this.cloudStore || this.activeStorage !== 'cloud' || !this.canEditActiveCharacter()) {
            this.markReadOnlyAttempt();
            return;
        }
        await this.cloudStore.assignCharacterToCampaign(this.activeCharId, campaignId || null);
        await this.refreshCloudRoster({ keepActive: true });
        this.setCloudStatus('saved', campaignId ? 'Character assigned to campaign.' : 'Character removed from campaign.');
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
        await this.refreshCloudRoster({ keepActive: true });
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
            this.setCloudStatus('error', e.message || 'Roll tracking failed.');
        }
    }
}
