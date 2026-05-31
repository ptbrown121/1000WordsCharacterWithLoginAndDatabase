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
});
