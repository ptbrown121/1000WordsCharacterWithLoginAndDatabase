import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../api/_lib/http.js';
import poolAssistantHandler, { createPoolAssistantHandler } from '../api/ai/pool-assistant.js';
import {
    DEFAULT_POOL_ASSISTANT_MAX_OUTPUT_TOKENS,
    getPoolAssistantReasoning
} from '../api/_lib/openaiPoolAssistant.js';
import {
    buildPoolAssistantInput,
    isPoolAssistantEnabled,
    parsePoolAssistantRequest,
    poolAssistantResponseSchema,
    resolvePoolAssistantCallColors,
    transcriptionPrompt,
    validatePoolAssistantAgentResult
} from '../api/_lib/poolAssistant.js';
import {
    buildPoolAssistantCharacter,
    getPoolAssistantSelectionMatch,
    matchesAcceptedPoolAssistantSelection,
    normalizePoolAssistantSuggestion,
    resolvePoolAssistantSelection,
    serializePoolAssistantTile,
    validatePoolAssistantSuggestion
} from '../js/pool-assistant.js';
import { characters, poolAssistantEvalCases } from '../evals/pool-assistant/cases.js';
import { poolAssistantAudioSmokeCases } from '../evals/pool-assistant/audio-smoke.js';

const tile = (id, name, colors, extra = {}) => ({
    id,
    name,
    type: 'Skill',
    colors,
    dice: ['d6'],
    tags: [],
    description: '',
    ...extra
});

describe('pool assistant character boundary', () => {
    it('sends only compact normalized character and tile fields', () => {
        const result = buildPoolAssistantCharacter({
            name: 'Ash',
            stats: { BODY: 'd6', SPEED: 'd8', UNKNOWN: 'd16' },
            tiles: [tile('stealth', 'Stealth', ['Blue', 'Purple'], { description: 'Quiet movement' })],
            journal: [{ title: 'private', content: 'not sent' }]
        });

        assert.equal(result.name, 'Ash');
        assert.deepEqual(Object.keys(result.stats), ['BODY', 'POWER', 'SOUL', 'FOCUS', 'MIND', 'SPEED']);
        assert.equal(result.tiles[0].description, 'Quiet movement');
        assert.equal('journal' in result, false);
    });

    it('marks burnt, buried, and Ammo tiles unavailable', () => {
        assert.equal(serializePoolAssistantTile(tile('a', 'A', ['Red'], { isBurnt: true })).available, false);
        assert.equal(serializePoolAssistantTile(tile('b', 'B', ['Red'], { isBuried: true })).available, false);
        assert.equal(serializePoolAssistantTile(tile('c', 'C', [], { type: 'Gear', gearSubtype: 'Ammo' })).available, false);
    });

    it('rejects character sheets over the hard tile limit', () => {
        const tiles = Array.from({ length: 101 }, (_, index) => tile(String(index), `Tile ${index}`, ['Red']));
        assert.throws(() => buildPoolAssistantCharacter({ tiles }), /at most 100 tiles/);
    });
});

describe('pool assistant mechanical validation', () => {
    const tiles = [
        tile('call', 'Lockpicks', ['Blue', 'Purple']),
        tile('burn', 'Catlike Reflexes', ['Red', 'Purple']),
        tile('wrong', 'First Aid', ['Yellow', 'Blue']),
        tile('hitch', 'Oath', ['Blue', 'Purple'], { tags: ['Hitch 3'] }),
        tile('buried', 'Hidden Blade', ['Blue', 'Purple'], { isBuried: true })
    ];

    it('accepts a legal Call and explicitly selected same-color Burn', () => {
        const resolved = resolvePoolAssistantSelection({
            status: 'ready',
            callColors: ['Blue', 'Purple'],
            callTileId: 'call',
            burnTileIds: ['burn'],
            confidence: 'high',
            rationale: 'Pick the lock quickly.',
            warnings: []
        }, tiles);
        assert.equal(resolved.valid, true);
        assert.equal(resolved.callTile.name, 'Lockpicks');
        assert.deepEqual(resolved.burnTiles.map(candidate => candidate.id), ['burn']);
    });

    it('rejects fabricated IDs, unavailable tiles, Hitch burns, and color mismatches', () => {
        const cases = [
            { callTileId: 'missing', burnTileIds: [] },
            { callTileId: 'buried', burnTileIds: [] },
            { callTileId: 'call', burnTileIds: ['hitch'] },
            { callTileId: 'call', burnTileIds: ['wrong'] }
        ];
        cases.forEach(candidate => {
            const suggestion = normalizePoolAssistantSuggestion({
                status: 'ready', callColors: ['Red', 'Purple'], confidence: 'low', rationale: '', warnings: [], ...candidate
            });
            assert.equal(validatePoolAssistantSuggestion(suggestion, tiles).valid, false);
        });
    });

    it('normalizes clarification responses to empty selections', () => {
        const suggestion = normalizePoolAssistantSuggestion({
            status: 'needs_clarification', callColors: ['Red'], callTileId: 'call', burnTileIds: ['burn'], confidence: 'low'
        });
        assert.deepEqual(suggestion.callColors, []);
        assert.equal(suggestion.callTileId, '');
        assert.deepEqual(suggestion.burnTileIds, []);
        assert.equal(validatePoolAssistantSuggestion(suggestion, tiles).valid, true);
    });

    it('matches complete accepted selections without giving partial credit', () => {
        const actual = { status: 'ready', callColors: ['Purple', 'Blue'], callTileId: 'call', burnTileIds: [], confidence: 'high' };
        const accepted = [{ status: 'ready', callColors: ['Blue', 'Purple'], callTileId: 'call', burnTileIds: [], confidence: 'low' }];
        assert.equal(matchesAcceptedPoolAssistantSelection(actual, accepted), true);
        assert.equal(matchesAcceptedPoolAssistantSelection({ ...actual, callTileId: 'wrong' }, accepted), false);
        assert.deepEqual(getPoolAssistantSelectionMatch({ ...actual, callTileId: 'wrong' }, accepted), {
            exact: false,
            status: true,
            callColors: true,
            callTile: false,
            burns: true
        });
    });
});

describe('pool assistant API boundary', () => {
    const character = { name: 'Ash', stats: {}, tiles: [tile('a', 'Athletics', ['Red', 'Orange'])] };

    it('keeps the feature disabled unless explicitly enabled', () => {
        assert.equal(isPoolAssistantEnabled({}), false);
        assert.equal(isPoolAssistantEnabled({ AI_POOL_ASSISTANT_ENABLED: 'true' }), true);
        assert.equal(isPoolAssistantEnabled({ AI_POOL_ASSISTANT_ENABLED: '1' }), true);
    });

    it('accepts exactly one typed or audio command source', () => {
        assert.equal(parsePoolAssistantRequest({ commandText: 'Leap the gap', character }).commandText, 'Leap the gap');
        assert.throws(() => parsePoolAssistantRequest({ character }), error => error instanceof ApiError && error.status === 400);
        assert.throws(() => parsePoolAssistantRequest({ commandText: 'A', audio: {}, character }), /exactly one/);
        assert.throws(
            () => parsePoolAssistantRequest({ commandText: 'x'.repeat(501), character }),
            error => error instanceof ApiError && error.status === 400
        );
        assert.throws(
            () => parsePoolAssistantRequest({ commandText: 'Leap', callColors: ['Red'], character }),
            /exactly two distinct/
        );
    });

    it('extracts authoritative colors from color or stat names and otherwise uses the selected fallback', () => {
        assert.deepEqual(resolvePoolAssistantCallColors('Blue and Purple. I pick the lock.'), ['Blue', 'Purple']);
        assert.deepEqual(resolvePoolAssistantCallColors('The GM calls MIND / SPEED. I sneak.'), ['Blue', 'Purple']);
        assert.deepEqual(resolvePoolAssistantCallColors('I keep my focus under pressure.', ['Red', 'Green']), ['Red', 'Green']);
        assert.deepEqual(resolvePoolAssistantCallColors('Red, Blue, and Purple. I move.'), [], 'ambiguous colors must not be guessed');
        assert.deepEqual(resolvePoolAssistantCallColors('I leap the gap.'), []);
    });

    it('hints the exact spoken color and stat vocabulary to transcription', () => {
        const prompt = transcriptionPrompt(buildPoolAssistantCharacter(character));
        assert.match(prompt, /Red or BODY/);
        assert.match(prompt, /BODY and MIND/);
        assert.match(prompt, /Athletics/);
    });

    it('validates audio type, base64, and decoded size', () => {
        const parsed = parsePoolAssistantRequest({
            audio: { mimeType: 'audio/webm;codecs=opus', base64: Buffer.from('audio').toString('base64') },
            character
        });
        assert.equal(parsed.audio.mimeType, 'audio/webm');
        assert.equal(parsed.audio.buffer.toString(), 'audio');
        assert.throws(() => parsePoolAssistantRequest({ audio: { mimeType: 'audio/ogg', base64: 'YQ==' }, character }), error => error.status === 415);
        assert.throws(() => parsePoolAssistantRequest({ audio: { mimeType: 'audio/webm', base64: 'not base64!' }, character }), /valid base64/);
    });

    it('builds a strict structured-output schema and bounded prompt', () => {
        assert.equal(DEFAULT_POOL_ASSISTANT_MAX_OUTPUT_TOKENS, 1200);
        assert.equal(poolAssistantResponseSchema.additionalProperties, false);
        assert.ok(poolAssistantResponseSchema.required.includes('burnTileIds'));
        assert.equal(poolAssistantResponseSchema.required.includes('callColors'), false);
        const input = buildPoolAssistantInput('Sneak past the guard', buildPoolAssistantCharacter(character), ['Blue', 'Purple']);
        assert.equal(input[0].role, 'developer');
        assert.match(input[0].content, /Only choose Burn tiles if/);
        assert.match(input[0].content, /Never choose an unrelated or merely approximate tile/);
        assert.match(input[0].content, /Never infer, replace, or critique the GM Call colors/);
        assert.match(input[0].content, /explicitly says to burn must be a Burn tile/);
        assert.match(input[1].content, /\["Blue","Purple"\]/);
        assert.match(input[1].content, /Sneak past the guard/);
    });

    it('injects authoritative GM colors into the model tile selection', () => {
        const normalizedCharacter = buildPoolAssistantCharacter(character);
        const result = validatePoolAssistantAgentResult({
            status: 'ready',
            callTileId: 'a',
            burnTileIds: [],
            confidence: 'high',
            rationale: 'Athletics directly supports the leap.',
            warnings: []
        }, normalizedCharacter, ['Red', 'Orange']);
        assert.equal(result.valid, true);
        assert.deepEqual(result.suggestion.callColors, ['Red', 'Orange']);
    });

    it('uses low-cost model-appropriate reasoning defaults with an environment override', () => {
        assert.equal(getPoolAssistantReasoning('gpt-4o-mini-2024-07-18'), null);
        assert.deepEqual(getPoolAssistantReasoning('gpt-5-nano-2025-08-07', {}), { effort: 'minimal' });
        assert.deepEqual(getPoolAssistantReasoning('gpt-5.4-nano-2026-03-17', {}), { effort: 'none' });
        assert.deepEqual(getPoolAssistantReasoning('gpt-5.6-luna', {}), { effort: 'none' });
        assert.deepEqual(getPoolAssistantReasoning('gpt-5.6-luna', {
            OPENAI_POOL_ASSISTANT_REASONING_EFFORT: 'high'
        }), { effort: 'high' });
    });
});

describe('pool assistant route feature and authentication gates', () => {
    async function invoke(method, body = null, handler = poolAssistantHandler) {
        let responseBody = '';
        const headers = {};
        const req = { method, headers: {}, body };
        const res = {
            statusCode: 0,
            setHeader(name, value) { headers[name] = value; },
            end(value) { responseBody = value; }
        };
        await handler(req, res);
        return { status: res.statusCode, headers, body: JSON.parse(responseBody) };
    }

    it('reports the disabled flag and rejects disabled POST requests', async () => {
        const previous = process.env.AI_POOL_ASSISTANT_ENABLED;
        delete process.env.AI_POOL_ASSISTANT_ENABLED;
        try {
            const config = await invoke('GET');
            assert.equal(config.status, 200);
            assert.equal(config.body.enabled, false);

            const request = await invoke('POST', {});
            assert.equal(request.status, 404);
        } finally {
            if (previous === undefined) delete process.env.AI_POOL_ASSISTANT_ENABLED;
            else process.env.AI_POOL_ASSISTANT_ENABLED = previous;
        }
    });

    it('requires a signed-in user when enabled', async () => {
        const previous = process.env.AI_POOL_ASSISTANT_ENABLED;
        process.env.AI_POOL_ASSISTANT_ENABLED = 'true';
        try {
            const request = await invoke('POST', {});
            assert.equal(request.status, 401);
            assert.match(request.body.error, /sign in/i);
        } finally {
            if (previous === undefined) delete process.env.AI_POOL_ASSISTANT_ENABLED;
            else process.env.AI_POOL_ASSISTANT_ENABLED = previous;
        }
    });

    it('maps selector and transcription provider failures without changing data', async () => {
        const previous = process.env.AI_POOL_ASSISTANT_ENABLED;
        process.env.AI_POOL_ASSISTANT_ENABLED = 'true';
        const character = { name: 'Ash', stats: {}, tiles: [tile('a', 'Athletics', ['Red', 'Orange'])] };
        try {
            let selectorArgs = null;
            const selectorFailure = createPoolAssistantHandler({
                requireUserFn: async () => ({ client: {} }),
                enforceRateLimitFn: async () => {},
                selectFn: async args => {
                    selectorArgs = args;
                    return { failed: true, errorMessage: 'Selector provider failed.' };
                }
            });
            const selectorResponse = await invoke('POST', { commandText: 'Red and Orange. Leap', character }, selectorFailure);
            assert.equal(selectorResponse.status, 502);
            assert.match(selectorResponse.body.error, /selector provider failed/i);
            assert.deepEqual(selectorArgs.callColors, ['Red', 'Orange']);

            const missingColorsResponse = await invoke('POST', { commandText: 'Leap', character }, selectorFailure);
            assert.equal(missingColorsResponse.status, 400);
            assert.match(missingColorsResponse.body.error, /both GM Call colors/i);

            let audioSelectorArgs = null;
            const spokenColorHandler = createPoolAssistantHandler({
                requireUserFn: async () => ({ client: {} }),
                enforceRateLimitFn: async () => {},
                transcribeFn: async () => ({
                    failed: false,
                    transcript: 'MIND and SPEED. I sneak past the guard.',
                    usage: null
                }),
                selectFn: async args => {
                    audioSelectorArgs = args;
                    return { failed: true, errorMessage: 'Expected test stop.' };
                }
            });
            await invoke('POST', {
                audio: { mimeType: 'audio/wav', base64: 'YQ==' },
                character
            }, spokenColorHandler);
            assert.deepEqual(audioSelectorArgs.callColors, ['Blue', 'Purple']);

            let selectionCalled = false;
            const transcriptionFailure = createPoolAssistantHandler({
                requireUserFn: async () => ({ client: {} }),
                enforceRateLimitFn: async () => {},
                transcribeFn: async () => ({ failed: true, errorMessage: 'Transcription provider failed.' }),
                selectFn: async () => { selectionCalled = true; }
            });
            const transcriptionResponse = await invoke('POST', {
                audio: { mimeType: 'audio/wav', base64: 'YQ==' },
                character
            }, transcriptionFailure);
            assert.equal(transcriptionResponse.status, 502);
            assert.match(transcriptionResponse.body.error, /transcription provider failed/i);
            assert.equal(selectionCalled, false);
        } finally {
            if (previous === undefined) delete process.env.AI_POOL_ASSISTANT_ENABLED;
            else process.env.AI_POOL_ASSISTANT_ENABLED = previous;
        }
    });
});

describe('pool assistant live-eval corpus', () => {
    it('contains 100 mechanically valid accepted answers', () => {
        assert.equal(poolAssistantEvalCases.length, 100);
        const ids = new Set();
        poolAssistantEvalCases.forEach(testCase => {
            assert.equal(ids.has(testCase.id), false, `duplicate id ${testCase.id}`);
            ids.add(testCase.id);
            assert.ok(testCase.command.length > 0);
            assert.deepEqual(
                [...resolvePoolAssistantCallColors(testCase.command)].sort(),
                [...testCase.callColors].sort()
            );
            assert.ok(testCase.acceptedSelections.length > 0);
            const character = buildPoolAssistantCharacter(characters[testCase.characterId]);
            testCase.acceptedSelections.forEach(selection => {
                const validation = validatePoolAssistantSuggestion(normalizePoolAssistantSuggestion(selection), character.tiles);
                assert.equal(validation.valid, true, `${testCase.id}: ${validation.errors.join(' ')}`);
            });
        });
    });

    it('includes dedicated spoken-color audio fixtures', () => {
        assert.equal(poolAssistantAudioSmokeCases.length, 16);
        assert.equal(poolAssistantAudioSmokeCases.filter(testCase => testCase.expectsSpokenColors).length, 4);
    });
});
