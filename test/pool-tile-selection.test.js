import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    getBurnTileChoices,
    getCallTileChoices,
    getCompatibleBurnTiles,
    getSharedTileCallColors
} from '../js/pool-tile-selection.js';

const tile = (id, colors, extra = {}) => ({
    id,
    name: id,
    colors,
    dice: ['d6'],
    tags: '',
    ...extra
});

describe('pool tile picker filtering', () => {
    it('shows available Call tiles matching any selected color', () => {
        const tiles = [
            tile('red', ['Red', 'Orange']),
            tile('blue', ['Blue', 'Green']),
            tile('purple', ['Purple', 'Green']),
            tile('burnt', ['Blue', 'Red'], { isBurnt: true }),
            tile('ammo', ['Red', 'Blue'], { gearSubtype: 'Ammo' })
        ];

        assert.deepEqual(
            getCallTileChoices(tiles, ['Red', 'Blue']).map(choice => choice.id),
            ['red', 'blue']
        );
    });

    it('narrows Burn choices to the color shared by the Call and selected burns', () => {
        const call = tile('call', ['Blue', 'Yellow']);
        const yellowRed = tile('yellow-red', ['Yellow', 'Red']);
        const blueGreen = tile('blue-green', ['Blue', 'Green']);
        const yellowPurple = tile('yellow-purple', ['Yellow', 'Purple']);
        const tiles = [call, yellowRed, blueGreen, yellowPurple];

        assert.deepEqual(getSharedTileCallColors(['Blue', 'Yellow', 'Red'], [call, yellowRed]), ['Yellow']);
        assert.deepEqual(
            getBurnTileChoices(tiles, ['Blue', 'Yellow', 'Red'], call, [yellowRed]).map(choice => choice.id),
            ['yellow-red', 'yellow-purple']
        );
    });

    it('keeps selected burns visible for removal and excludes Hitched tiles', () => {
        const call = tile('call', ['Blue', 'Yellow']);
        const selected = tile('selected', ['Yellow', 'Red']);
        const hitch = tile('hitch', ['Yellow', 'Purple'], { tags: 'Hitch 2' });
        const choices = getBurnTileChoices([call, selected, hitch], ['Blue', 'Yellow'], call, [selected]);

        assert.deepEqual(choices.map(choice => choice.id), ['selected']);
    });

    it('preserves only compatible burns when swapping the Call tile', () => {
        const call = tile('call', ['Yellow', 'Red']);
        const yellow = tile('yellow', ['Yellow', 'Blue']);
        const red = tile('red', ['Red', 'Purple']);

        assert.deepEqual(
            getCompatibleBurnTiles(['Yellow', 'Red'], call, [yellow, red]).map(choice => choice.id),
            ['yellow']
        );
    });
});
