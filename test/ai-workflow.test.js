import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCampaignContext,
    buildSceneAgentInput,
    defaultSceneResponse,
    defaultSummary,
    normalizeTileSuggestions,
    parseJsonOutput,
    summarizeDocumentsForPrompt,
    transcriptFromMessages
} from '../api/_lib/aiWorkflow.js';
import { extractBearerToken, safeFileName } from '../api/_lib/supabase.js';

describe('AI workflow prompt helpers', () => {
    it('builds campaign context from settings and documents', () => {
        const context = buildCampaignContext({
            settings: {
                scenario_seed: 'The campaign starts in a city of stained glass.',
                gm_instructions: 'Ask about prior obligations.'
            },
            documents: [
                { title: 'Factions', content_text: 'The Mirror Court controls the old transit lines.' }
            ]
        });

        assert.match(context, /stained glass/);
        assert.match(context, /prior obligations/);
        assert.match(context, /Mirror Court/);
    });

    it('summarizes documents within a bounded prompt section', () => {
        const docs = summarizeDocumentsForPrompt([
            { title: 'Long note', content_text: 'x'.repeat(30000) }
        ]);

        assert.ok(docs.length < 25000);
        assert.match(docs, /Long note/);
        assert.match(docs, /truncated for context/);
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
