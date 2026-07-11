import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCampaignContext,
    buildSceneAgentInput,
    defaultSceneResponse,
    defaultSummary,
    focusedDocumentExcerpt,
    normalizeTileSuggestions,
    parseJsonOutput,
    scoreDocumentForFocus,
    selectFocusedDocuments,
    summarizeDocumentsForPrompt,
    transcriptFromMessages
} from '../api/_lib/aiWorkflow.js';
import { extractBearerToken, safeFileName } from '../api/_lib/supabase.js';
import { describeStructuredFailure, resolveMaxOutputTokens } from '../api/_lib/openaiWorkflow.js';
import { readJson } from '../api/_lib/http.js';
import { enforceAiRateLimit, getAiRateLimitConfig } from '../api/_lib/aiRateLimit.js';

describe('AI workflow prompt helpers', () => {
    it('builds campaign context from settings and documents', () => {
        const context = buildCampaignContext({
            settings: {
                scenario_seed: 'The campaign starts in a city of stained glass. '.repeat(200),
                gm_instructions: 'Ask about prior obligations.'
            },
            documents: [
                { title: 'Factions', content_text: 'The Mirror Court controls the old transit lines.' }
            ],
            focusText: 'Mirror Court obligations'
        });

        assert.match(context, /stained glass/);
        assert.match(context, /prior obligations/);
        assert.match(context, /Mirror Court/);
        assert.ok(context.length < 6000);
    });

    it('summarizes only focused documents within a bounded prompt section', () => {
        const docs = summarizeDocumentsForPrompt([
            { title: 'Mirror Court', content_text: 'mirror transit masks '.repeat(600) },
            { title: 'Desert Kingdom', content_text: 'sand empress oasis '.repeat(600) },
            { title: 'Hidden Archive', content_text: 'library ghosts catalog '.repeat(600) },
            { title: 'Unrelated Sea', content_text: 'sailors reef tide '.repeat(600) }
        ], 'The player owes the Mirror Court for transit through the old lines.');

        assert.ok(docs.length < 6000);
        assert.match(docs, /Mirror Court/);
        assert.doesNotMatch(docs, /Unrelated Sea/);
        assert.match(docs, /excerpt continues/);
    });

    it('scores and selects campaign notes by scene focus text', () => {
        const docs = [
            { title: 'Glass Choir', content_text: 'patron singers stained glass city' },
            { title: 'Dock Strike', content_text: 'workers cranes harbor debt' },
            { title: 'Moon Market', content_text: 'vendors masks night' }
        ];

        assert.ok(scoreDocumentForFocus(docs[1], 'The player owes a debt at the harbor') > 0);
        assert.equal(selectFocusedDocuments(docs, 'harbor debt')[0].title, 'Dock Strike');
    });

    it('scores full document text even when the summary misses the relevant passage', () => {
        const doc = {
            title: 'City Guide',
            content_summary: 'Opening overview with plazas and weather.',
            content_text: `${'opening overview '.repeat(300)} The Argent Key hides beneath the flooded observatory.`
        };

        assert.ok(scoreDocumentForFocus(doc, 'Argent Key observatory') > 0);
        const excerpt = focusedDocumentExcerpt(doc, 'Argent Key observatory', 260);
        assert.match(excerpt, /Argent Key/);
        assert.doesNotMatch(excerpt, /^opening overview opening overview opening overview/);
    });

    it('uses the latest player message as the strongest scene focus signal', () => {
        const input = buildSceneAgentInput({
            character: {
                name: 'Ash',
                state: {
                    tiles: [{ name: 'Old Debt', type: 'Story' }],
                    journal: []
                }
            },
            thread: {
                scene_index: 1,
                current_scene_title: 'Old harbor troubles',
                current_scene_goal: 'Explore Ash and the harbor debt.'
            },
            messages: Array.from({ length: 8 }, (_, index) => ({
                role: index % 2 === 0 ? 'assistant' : 'user',
                content: 'harbor debt cranes dock strike workers '.repeat(20)
            })),
            playerMessage: 'Actually I want this scene to pivot to the Argent Key under the observatory.',
            documents: [
                { title: 'Harbor Strike', content_text: 'harbor debt cranes dock strike workers '.repeat(300) },
                { title: 'Argent Key', content_text: 'The Argent Key waits under the old observatory.' }
            ],
            settings: null
        });

        const joined = input.map(item => item.content).join('\n');
        assert.match(joined, /Argent Key/);
        assert.match(joined, /old observatory/);
    });

    it('builds scene agent input with character and transcript context', () => {
        const input = buildSceneAgentInput({
            character: {
                name: 'Ash',
                state: {
                    tiles: [{ name: 'Old Debt', type: 'Story' }],
                    journal: [{ title: 'Session zero' }]
                }
            },
            thread: { scene_index: 2, current_scene_title: 'The bridge job' },
            messages: [{ role: 'user', content: 'I betrayed a patron.' }],
            playerMessage: 'I still carry their signet.',
            documents: [],
            settings: null
        });

        const joined = input.map(item => item.content).join('\n');
        assert.match(joined, /Ash/);
        assert.match(joined, /Old Debt/);
        assert.match(joined, /bridge job/);
        assert.match(joined, /signet/);
    });

    it('parses structured JSON even when surrounded by model prose', () => {
        const parsed = parseJsonOutput('Draft:\n{"status":"valid","notes":"ok"}\nDone.', null);
        assert.deepEqual(parsed, { status: 'valid', notes: 'ok' });
    });

    it('normalizes optional tile suggestions conservatively', () => {
        const suggestions = normalizeTileSuggestions([
            { name: 'Hidden Knife', type: 'Gear', reason: 'A concealed heirloom.' },
            { name: 'Unclear', type: 'Mystery', reason: 'Bad type becomes Story.' },
            { name: '', type: 'Skill', reason: 'Dropped.' }
        ]);

        assert.equal(suggestions.length, 2);
        assert.equal(suggestions[0].type, 'Gear');
        assert.equal(suggestions[1].type, 'Story');
    });

    it('creates deterministic local fallbacks for missing API keys', () => {
        const scene = defaultSceneResponse('I left home after a duel.');
        const summary = defaultSummary([{ role: 'user', content: 'I left home after a duel.' }]);

        assert.equal(scene.scene_status, 'active');
        assert.match(scene.reply, /duel/);
        assert.match(summary.summary, /duel/);
    });

    it('formats recent transcript messages', () => {
        const transcript = transcriptFromMessages([
            { role: 'assistant', content: 'Where were you?' },
            { role: 'user', content: 'At the station.' }
        ]);

        assert.match(transcript, /Assistant: Where/);
        assert.match(transcript, /Player: At the station/);
    });
});

describe('AI API utility helpers', () => {
    it('extracts bearer tokens case-insensitively', () => {
        assert.equal(extractBearerToken({ authorization: 'Bearer abc.123' }), 'abc.123');
        assert.equal(extractBearerToken({ Authorization: 'bearer token-value' }), 'token-value');
        assert.equal(extractBearerToken({ authorization: 'Basic nope' }), '');
    });

    it('sanitizes uploaded campaign note filenames', () => {
        assert.equal(safeFileName('../A strange: file?.md'), '..-A-strange-file-.md');
        assert.equal(safeFileName(''), 'campaign-note.txt');
    });

    it('rejects malformed JSON bodies with a 400 ApiError', async () => {
        const req = {
            async *[Symbol.asyncIterator]() {
                yield Buffer.from('{not valid json');
            }
        };

        await assert.rejects(readJson(req), error => {
            assert.equal(error.name, 'ApiError');
            assert.equal(error.status, 400);
            return true;
        });

        assert.deepEqual(await readJson({ body: { threadId: 't-1' } }), { threadId: 't-1' });
        await assert.rejects(readJson({ body: '{broken' }), error => error.status === 400);
    });
});

describe('OpenAI agent runtime helpers', () => {
    it('resolves per-agent output token budgets with env overrides', () => {
        delete process.env.TEST_MAX_OUTPUT_TOKENS;
        assert.equal(resolveMaxOutputTokens('TEST_MAX_OUTPUT_TOKENS', 6000), 6000);

        process.env.TEST_MAX_OUTPUT_TOKENS = '9000';
        assert.equal(resolveMaxOutputTokens('TEST_MAX_OUTPUT_TOKENS', 6000), 9000);

        process.env.TEST_MAX_OUTPUT_TOKENS = 'not-a-number';
        assert.equal(resolveMaxOutputTokens('TEST_MAX_OUTPUT_TOKENS', 6000), 6000);

        process.env.TEST_MAX_OUTPUT_TOKENS = '-50';
        assert.equal(resolveMaxOutputTokens('TEST_MAX_OUTPUT_TOKENS', 6000), 6000);
        delete process.env.TEST_MAX_OUTPUT_TOKENS;
    });

    it('describes structured-output failures distinctly', () => {
        assert.match(describeStructuredFailure('max_output_tokens', 2500), /2500 tokens/);
        assert.match(describeStructuredFailure('max_output_tokens', 2500), /reasoning/);
        assert.match(describeStructuredFailure('content_filter', 2500), /incomplete \(content_filter\)/);
        assert.match(describeStructuredFailure('', 2500), /could not be parsed/);
    });
});

describe('optional AI request rate limiting', () => {
    it('is unlimited by default and does not call Supabase', async () => {
        let rpcCalled = false;
        const client = { rpc: async () => { rpcCalled = true; } };

        assert.deepEqual(getAiRateLimitConfig({}), {
            enabled: false,
            requests: 0,
            windowSeconds: 3600
        });
        const result = await enforceAiRateLimit(client, {});
        assert.equal(result.enabled, false);
        assert.equal(rpcCalled, false);
    });

    it('uses the configured request count and window', async () => {
        let call = null;
        const client = {
            rpc: async (name, args) => {
                call = { name, args };
                return {
                    data: [{ allowed: true, remaining: 7, reset_at: '2099-01-01T00:00:00Z' }],
                    error: null
                };
            }
        };

        const result = await enforceAiRateLimit(client, {
            AI_RATE_LIMIT_REQUESTS: '10',
            AI_RATE_LIMIT_WINDOW_SECONDS: '900'
        });
        assert.deepEqual(call, {
            name: 'consume_ai_rate_limit',
            args: { max_requests: 10, window_seconds: 900 }
        });
        assert.equal(result.remaining, 7);
    });

    it('returns a 429 with retry details after the limit is consumed', async () => {
        const client = {
            rpc: async () => ({
                data: [{ allowed: false, remaining: 0, reset_at: '2099-01-01T00:00:00Z' }],
                error: null
            })
        };

        await assert.rejects(
            enforceAiRateLimit(client, { AI_RATE_LIMIT_REQUESTS: '2' }),
            error => error.status === 429 && error.details.retryAfterSeconds > 0
        );
    });

    it('fails closed only when limiting was explicitly enabled', async () => {
        const client = { rpc: async () => ({ data: null, error: { message: 'missing RPC' } }) };
        await assert.rejects(
            enforceAiRateLimit(client, { AI_RATE_LIMIT_REQUESTS: '5' }),
            error => error.status === 503
        );
    });
});
