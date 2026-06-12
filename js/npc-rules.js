// @ts-check
// NPC rules (v5.02 p.71). NPCs are GM-side: a Rank, three stats
// (Might/Charm/Skill), and three resource pools (HP/EN/RX).
//
//   - Rank is used as Soak and Grit, and adds to Attack and Defense.
//   - Might stands in for BODY/POWER and rolls when dealing injury.
//   - Charm stands in for SOUL/FOCUS and rolls for Defense.
//   - Skill stands in for MIND/SPEED and rolls for Attack.
//   - Attack = Rank + Skill; Defense = Rank + Charm (the book suggests
//     rolling these once at the start of combat as static values).
//   - A skill check rolls only the stat dice.
//   - BLEED reduces a die by 1 ▟; a forced burn reduces Rank by 1.
//   - Up to Rank descriptors; each can be spent for a freebie die at R ▟.
//
// Build budgets (derived from the printed example rows, which all conform):
//   resource points = 15 + 6 x Rank, split across HP/EN/RX
//   stat die steps  = 3 (three starting d4s) + 2 x Rank
//
// No DOM access; covered by test/npc-rules.test.js.

const DIE_STEPS = { d3: 0, d4: 1, d6: 2, d8: 3, d10: 4, d12: 5, d14: 6, d16: 7 };
const DICE_BY_STEP = Object.fromEntries(Object.entries(DIE_STEPS).map(([die, step]) => [step, die]));

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

// Example stat blocks from the Rank table (p.71).
export const NPC_RANK_EXAMPLES = {
    1: { hp: 8, en: 5, rx: 8, might: 'd6', charm: 'd4', skill: 'd6' },
    2: { hp: 6, en: 10, rx: 11, might: 'd6', charm: 'd6', skill: 'd8' },
    3: { hp: 10, en: 10, rx: 13, might: 'd8', charm: 'd8', skill: 'd8' },
    4: { hp: 16, en: 11, rx: 12, might: 'd10', charm: 'd8', skill: 'd6, d6' },
    5: { hp: 16, en: 12, rx: 17, might: 'd12', charm: 'd8', skill: 'd6, d8' }
};

export function getNpcBudgets(rank) {
    const r = Math.max(1, toInt(rank));
    return {
        resourcePoints: 15 + 6 * r,
        statSteps: 3 + 2 * r,
        descriptors: r
    };
}

export function parseNpcDice(value) {
    return String(value || '')
        .split(',')
        .map(token => token.trim().toLowerCase())
        .filter(token => DIE_STEPS[token] !== undefined);
}

export function countNpcDiceSteps(value) {
    return parseNpcDice(value).reduce((sum, die) => sum + DIE_STEPS[die], 0);
}

// Spending a descriptor grants a freebie die at Rank ▟ (R steps).
export function getDescriptorDie(rank) {
    const step = Math.min(7, Math.max(1, toInt(rank)));
    return DICE_BY_STEP[step];
}

// Advisory budget check against 15+6R resource points, 3+2R die steps, and
// up to Rank descriptors.
export function reviewNpcBuild(npc = {}) {
    const budgets = getNpcBudgets(npc.rank);
    const poolTotal = toInt(npc.hpMax) + toInt(npc.enMax) + toInt(npc.rxMax);
    const statSteps = countNpcDiceSteps(npc.might) + countNpcDiceSteps(npc.charm) + countNpcDiceSteps(npc.skill);
    const descriptorCount = Array.isArray(npc.descriptors) ? npc.descriptors.length : 0;
    return {
        budgets,
        poolTotal,
        statSteps,
        descriptorCount,
        poolDelta: poolTotal - budgets.resourcePoints,
        stepDelta: statSteps - budgets.statSteps,
        descriptorDelta: descriptorCount - budgets.descriptors
    };
}

// NPC rolls sum the stat dice (plus Rank for Attack/Defense). `rollFn` is
// injectable for tests.
export function rollNpcStat(diceValue, rollFn) {
    const dice = parseNpcDice(diceValue);
    const rolls = dice.map(die => ({ die, val: rollFn(die) }));
    return { rolls, total: rolls.reduce((sum, roll) => sum + roll.val, 0) };
}

export function rollNpcAttack(npc, rollFn) {
    const result = rollNpcStat(npc.skill, rollFn);
    return { ...result, total: result.total + Math.max(0, toInt(npc.rank)) };
}

export function rollNpcDefense(npc, rollFn) {
    const result = rollNpcStat(npc.charm, rollFn);
    return { ...result, total: result.total + Math.max(0, toInt(npc.rank)) };
}

export function normalizeNpc(raw = {}) {
    const rank = Math.max(1, toInt(raw.rank) || 1);
    // Up to Rank descriptors is the rule, but extras are kept and flagged
    // (advisory, like the build budgets) rather than silently dropped.
    const descriptors = Array.isArray(raw.descriptors)
        ? raw.descriptors
            .map(entry => typeof entry === 'string' ? { text: entry, spent: false } : { text: String(entry?.text || '').trim(), spent: Boolean(entry?.spent) })
            .filter(entry => entry.text)
        : [];

    return {
        id: String(raw.id || (typeof globalThis.crypto?.randomUUID === 'function' ? crypto.randomUUID() : `npc-${Date.now()}-${Math.random()}`)),
        name: String(raw.name || 'NPC').trim() || 'NPC',
        rank,
        might: parseNpcDice(raw.might).join(', ') || 'd4',
        charm: parseNpcDice(raw.charm).join(', ') || 'd4',
        skill: parseNpcDice(raw.skill).join(', ') || 'd4',
        hp: Math.max(0, toInt(raw.hp ?? raw.hpMax)),
        hpMax: Math.max(0, toInt(raw.hpMax)),
        en: Math.max(0, toInt(raw.en ?? raw.enMax)),
        enMax: Math.max(0, toInt(raw.enMax)),
        rx: Math.max(0, toInt(raw.rx ?? raw.rxMax)),
        rxMax: Math.max(0, toInt(raw.rxMax)),
        descriptors,
        attackStatic: raw.attackStatic === null || raw.attackStatic === undefined ? null : toInt(raw.attackStatic),
        defenseStatic: raw.defenseStatic === null || raw.defenseStatic === undefined ? null : toInt(raw.defenseStatic),
        notes: String(raw.notes || '')
    };
}

export function normalizeNpcList(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(entry => entry && typeof entry === 'object').map(normalizeNpc);
}
