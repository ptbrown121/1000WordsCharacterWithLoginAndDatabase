// @ts-check
// Pure rules for character condition tracking (v5.02 pp.37, 42-43).
//
// - Status conditions derived from the three resource pools hitting 0.
// - The Crits Dashboard catalog (fast / sticky / special crits).
// - Press cost math for Pressing the Initiative.
//
// No DOM access; covered by test/status-rules.test.js.

// Crits Dashboard (p.43 / character sheet p.80). Fast crits apply once and
// fade at the end of the turn; sticky crits pile up and stack until healed;
// special crits stick until removed by their listed cure.
export const CRIT_DASHBOARD = [
    { id: 'jolt', label: 'JOLT', kind: 'fast', effect: 'Grit -3 on next defense.' },
    { id: 'slow', label: 'SLOW', kind: 'fast', effect: 'Reflex -3.' },
    { id: 'down', label: 'DOWN', kind: 'fast', effect: 'Lose next action.' },
    { id: 'pain', label: 'PAIN', kind: 'fast', effect: 'Energy -3.' },
    { id: 'bleed', label: 'BLEED', kind: 'sticky', effect: 'Called tiles are burned.' },
    { id: 'wound', label: 'WOUND', kind: 'sticky', effect: 'All checks at -3.' },
    { id: 'break', label: 'BREAK', kind: 'special', effect: 'Gear reduced by its die steps; lasts until repaired.' },
    { id: 'fear', label: 'FEAR', kind: 'special', effect: 'Pools lose a die; lasts until cured or shaken.' },
    { id: 'goad', label: 'GOAD', kind: 'special', effect: 'Must burn for actions; lasts until resisted.' },
    { id: 'hold', label: 'HOLD', kind: 'special', effect: 'Cannot Walk or Run; lasts until resisted.' },
    { id: 'reveal', label: 'REVEAL', kind: 'special', effect: 'Found or exposed; lasts while hidden.' },
    { id: 'vow', label: 'VOW', kind: 'special', effect: 'Cannot oppose the dealer; lasts until shaken.' },
    { id: 'ko', label: 'KO', kind: 'special', effect: 'Unconscious; lasts until cured.' },
    { id: 'poison', label: 'POISON', kind: 'special', effect: 'Burn 3 resources or 1 tile per turn; lasts until cured.' },
    { id: 'afire', label: 'AFIRE', kind: 'special', effect: 'Take 1 HP on the Setting’s action, then each AFIRE spawns another; lasts until smothered.' }
];

const CRIT_IDS = new Set(CRIT_DASHBOARD.map(crit => crit.id));

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

// Normalize a stored activeCrits map to { critId: positiveCount }.
export function normalizeActiveCrits(raw) {
    /** @type {Object<string, number>} */
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;

    Object.entries(raw).forEach(([key, value]) => {
        const id = String(key || '').trim().toLowerCase();
        const count = Math.max(0, toInt(value));
        if (CRIT_IDS.has(id) && count > 0) out[id] = count;
    });

    return out;
}

// Taking Injury - Status (p.43): conditions from resource pools at 0.
// Returns every condition that applies, most severe first, so the UI can
// show e.g. Exhausted alongside the Fatigued and Cornered restrictions.
export const STATUS_CONDITIONS = [
    { id: 'death', label: 'Death Is Near', severity: 'critical', description: 'All three pools at 0. Medical attention within three turns may stabilize; afterward the condition is permanent.' },
    { id: 'unconscious', label: 'Unconscious', severity: 'critical', description: '0 Energy and 0 Health.' },
    { id: 'paralyzed', label: 'Paralyzed', severity: 'critical', description: '0 Reflex and 0 Health.' },
    { id: 'exhausted', label: 'Exhausted', severity: 'critical', description: '0 Energy and 0 Reflex.' },
    { id: 'riven', label: 'Riven', severity: 'major', description: '0 Health: must burn tiles to act.' },
    { id: 'cornered', label: 'Cornered', severity: 'major', description: '0 Reflex: cannot Walk, Run, or Dash; restricted to a Pace (3 m) each turn; acts last each round and cannot Press.' },
    { id: 'fatigued', label: 'Fatigued', severity: 'major', description: '0 Energy: cannot initiate actions except movement; can still defend.' }
];

/**
 * @param {{ hp?: number|string, en?: number|string, rx?: number|string }} [pools]
 */
export function getStatusConditions({ hp, en, rx } = {}) {
    const hp0 = toInt(hp) <= 0;
    const en0 = toInt(en) <= 0;
    const rx0 = toInt(rx) <= 0;

    const active = new Set();
    if (hp0 && en0 && rx0) active.add('death');
    if (en0 && hp0) active.add('unconscious');
    if (rx0 && hp0) active.add('paralyzed');
    if (en0 && rx0) active.add('exhausted');
    if (hp0) active.add('riven');
    if (rx0) active.add('cornered');
    if (en0) active.add('fatigued');

    return STATUS_CONDITIONS.filter(condition => active.has(condition.id));
}

// WOUND (p.38): all checks at -3, per active WOUND.
export function getWoundPenalty(activeCrits) {
    const crits = normalizeActiveCrits(activeCrits);
    return 3 * (crits.wound || 0);
}

// Special Crits that change how the character builds a pool (p.40):
// FEAR "target's pools lose a die"; GOAD "target must burn for actions".
// PoolEngine.compilePool takes these as its `fear` / `goad` options.
export function getCritPoolEffects(activeCrits) {
    const crits = normalizeActiveCrits(activeCrits);
    return {
        fear: (crits.fear || 0) > 0,
        goad: (crits.goad || 0) > 0
    };
}

// Pressing the Initiative (p.37).
//   - 1 RX gains a Move, 2 RX gains an Action.
//   - Repeating the previous action reduces that Press by 1.
//   - Each prior Press or Haywire this fight adds 1.
//   - The Fast weapon Detail tag reduces a Press Action by 1 (that weapon's
//     attacks only); Recoil adds 1 to Press Actions.
// The minimum cost is floored at 1 RX - a Press always spends something.
// (Assumption noted in docs/v5.02-rules-update-plan.md.)
export function calculatePressCost({ kind = 'action', pressCount = 0, repeatPrevious = false, fastWeapon = false, recoilWeapon = false } = {}) {
    const base = kind === 'move' ? 1 : 2;
    let cost = base + Math.max(0, toInt(pressCount));

    if (kind !== 'move') {
        if (repeatPrevious) cost -= 1;
        if (fastWeapon) cost -= 1;
        if (recoilWeapon) cost += 1;
    }

    return Math.max(1, cost);
}
