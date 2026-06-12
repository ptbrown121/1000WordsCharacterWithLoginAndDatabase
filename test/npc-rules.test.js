import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    NPC_RANK_EXAMPLES,
    countNpcDiceSteps,
    getDescriptorDie,
    getNpcBudgets,
    normalizeNpc,
    normalizeNpcList,
    parseNpcDice,
    reviewNpcBuild,
    rollNpcAttack,
    rollNpcDefense,
    rollNpcStat
} from '../js/npc-rules.js';

describe('NPC budgets (v5.02 p.71)', () => {
    it('grants 15 + 6/Rank resource points, 3 + 2/Rank stat steps, and Rank descriptors', () => {
        assert.deepEqual(getNpcBudgets(1), { resourcePoints: 21, statSteps: 5, descriptors: 1 });
        assert.deepEqual(getNpcBudgets(5), { resourcePoints: 45, statSteps: 13, descriptors: 5 });
    });

    it('every printed Rank example conforms to both budgets', () => {
        Object.entries(NPC_RANK_EXAMPLES).forEach(([rank, example]) => {
            const budgets = getNpcBudgets(rank);
            const pools = example.hp + example.en + example.rx;
            const steps = countNpcDiceSteps(example.might) + countNpcDiceSteps(example.charm) + countNpcDiceSteps(example.skill);
            assert.equal(pools, budgets.resourcePoints, `Rank ${rank} pools`);
            assert.equal(steps, budgets.statSteps, `Rank ${rank} steps`);
        });
    });

    it('reviewNpcBuild reports deltas against the budgets', () => {
        const review = reviewNpcBuild({ rank: 1, might: 'd6', charm: 'd4', skill: 'd6', hpMax: 8, enMax: 5, rxMax: 8 });
        assert.equal(review.poolDelta, 0);
        assert.equal(review.stepDelta, 0);
        const over = reviewNpcBuild({ rank: 1, might: 'd12', charm: 'd4', skill: 'd6', hpMax: 30, enMax: 5, rxMax: 8 });
        assert.equal(over.poolDelta, 22);
        assert.equal(over.stepDelta, 3);
    });
});

describe('NPC dice and rolls', () => {
    it('parses comma-separated dice and counts steps', () => {
        assert.deepEqual(parseNpcDice('d6, d8, junk'), ['d6', 'd8']);
        assert.equal(countNpcDiceSteps('d6, d8'), 5);
        assert.equal(countNpcDiceSteps(''), 0);
    });

    it('sums stat dice; Attack and Defense add Rank', () => {
        const fixedRoll = () => 4;
        const npc = { rank: 3, might: 'd8', charm: 'd8', skill: 'd6, d6' };
        assert.equal(rollNpcStat(npc.might, fixedRoll).total, 4);
        assert.equal(rollNpcAttack(npc, fixedRoll).total, 11); // 4+4 skill + rank 3
        assert.equal(rollNpcDefense(npc, fixedRoll).total, 7); // 4 charm + rank 3
        assert.deepEqual(rollNpcAttack(npc, fixedRoll).rolls.map(r => r.die), ['d6', 'd6']);
    });

    it('grants a descriptor freebie die at Rank steps', () => {
        assert.equal(getDescriptorDie(1), 'd4');
        assert.equal(getDescriptorDie(3), 'd8');
        assert.equal(getDescriptorDie(5), 'd12');
        assert.equal(getDescriptorDie(9), 'd16'); // clamped
    });
});

describe('NPC normalization', () => {
    it('fills defaults, floors pools, and keeps descriptors past Rank (flagged, not dropped)', () => {
        const npc = normalizeNpc({
            name: '  Gargoyle  ',
            rank: '2',
            might: 'd8',
            hpMax: '13',
            descriptors: ['Stony hide', 'Vicious', 'Greedy']
        });
        assert.equal(npc.name, 'Gargoyle');
        assert.equal(npc.rank, 2);
        assert.equal(npc.charm, 'd4'); // default
        assert.equal(npc.hp, 13);      // current defaults to max
        assert.equal(npc.hpMax, 13);
        assert.equal(npc.descriptors.length, 3); // kept; review flags the overage
        assert.equal(npc.descriptors[0].spent, false);
        assert.equal(npc.attackStatic, null);

        const review = reviewNpcBuild(npc);
        assert.equal(review.descriptorCount, 3);
        assert.equal(review.budgets.descriptors, 2);
        assert.equal(review.descriptorDelta, 1);
    });

    it('normalizes lists and drops junk entries', () => {
        const list = normalizeNpcList([{ name: 'A', rank: 1 }, null, 'junk']);
        assert.equal(list.length, 1);
        assert.equal(list[0].name, 'A');
        assert.deepEqual(normalizeNpcList('nope'), []);
    });

    it('preserves stored descriptor spent state and static values', () => {
        const npc = normalizeNpc({
            name: 'Boss', rank: 4,
            descriptors: [{ text: 'Huge', spent: true }],
            attackStatic: 12, defenseStatic: 9
        });
        assert.equal(npc.descriptors[0].spent, true);
        assert.equal(npc.attackStatic, 12);
        assert.equal(npc.defenseStatic, 9);
    });
});
